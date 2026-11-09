/**
 * The phone's outbox: frames and roll moves made while shooting are written
 * here first (IndexedDB, survives reloads and a dead signal), then flushed to
 * the server whenever it answers. Each item belongs to one user, so a
 * different account signing in on the same phone never sends someone else's
 * frames.
 */
import { actions } from 'astro:actions';

import type { FrameInput, FrameView, RollView } from './inventory';

const DB_NAME = 'film-lab';
const STORE = 'outbox';

type CallAction = 'advanceRoll' | 'rewindRoll';

export type OutboxItem =
	| { key: string; userId: string; kind: 'frame'; at: number; payload: FrameInput }
	| { key: string; userId: string; kind: 'call'; at: number; action: CallAction; payload: Record<string, unknown> };

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
	opening ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			opening = null;
			reject(req.error);
		};
	});
	return opening;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
	return db().then(
		(d) =>
			new Promise((resolve, reject) => {
				const t = d.transaction(STORE, mode);
				const req = run(t.objectStore(STORE));
				t.oncomplete = () => resolve(req ? req.result : undefined);
				t.onerror = () => reject(t.error);
				t.onabort = () => reject(t.error);
			})
	);
}

/** Queue a frame (new, edited or deleted). A later edit of the same frame replaces the queued one. */
export const queueFrame = (userId: string, frame: FrameInput) =>
	tx('readwrite', (s) => s.put({ key: `frame:${frame.clientId}`, userId, kind: 'frame', at: Date.now(), payload: frame } satisfies OutboxItem));

/** Queue a roll move (finished, rewound) to replay once online. */
export const queueCall = (userId: string, action: CallAction, payload: Record<string, unknown>) =>
	tx('readwrite', (s) =>
		s.put({ key: `call:${action}:${payload.rollId}`, userId, kind: 'call', action, at: Date.now(), payload } satisfies OutboxItem)
	);

export async function pending(userId: string): Promise<OutboxItem[]> {
	const all = ((await tx('readonly', (s) => s.getAll())) ?? []) as OutboxItem[];
	return all.filter((i) => i.userId === userId).sort((a, b) => a.at - b.at);
}

const remove = (keys: string[]) => tx('readwrite', (s) => void keys.forEach((k) => s.delete(k)));

/** Anything still waiting from any account (checked before signing out). */
export async function pendingCount(): Promise<number> {
	return ((await tx('readonly', (s) => s.count())) as number | undefined) ?? 0;
}

/** A fetch that never reached the server (no signal) rather than one the server refused. */
const isNetworkError = (e: unknown) => e instanceof TypeError;

export interface FlushResult {
	/** Server copies of the frames on every roll that was synced. */
	frames: FrameView[];
	/** Rolls whose frames were synced: `frames` is now the whole truth for them (even when empty). */
	syncedRolls: string[];
	/** Rolls changed by replayed moves. */
	rolls: RollView[];
	sent: number;
	left: number;
	offline: boolean;
	/** Items the server refused for good (removed from the queue). */
	refused: string[];
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Send everything queued for this user. Calls run one after another, so a
 * frame logged while a sync is in flight goes out in the next run instead of
 * waiting for the retry timer. (An empty queue costs nothing.)
 */
export function flush(userId: string): Promise<FlushResult> {
	const run = chain.then(() => doFlush(userId));
	chain = run.catch(() => {});
	return run;
}

async function doFlush(userId: string): Promise<FlushResult> {
	const items = await pending(userId);
	const result: FlushResult = { frames: [], syncedRolls: [], rolls: [], sent: 0, left: items.length, offline: false, refused: [] };
	if (!items.length) return result;

	const frames = items.filter((i): i is Extract<OutboxItem, { kind: 'frame' }> => i.kind === 'frame');
	const calls = items.filter((i): i is Extract<OutboxItem, { kind: 'call' }> => i.kind === 'call');

	// Frames go first, in one request (moves like "finished" come after the frames they close out).
	const send = async (batch: typeof frames): Promise<void> => {
		const { data, error } = await actions.lab.syncFrames({ frames: batch.map((b) => b.payload) });
		if (!error) {
			const rolls = new Set(batch.map((b) => b.payload.rollId));
			result.frames = [...result.frames.filter((f) => !rolls.has(f.rollId)), ...data];
			result.syncedRolls = [...new Set([...result.syncedRolls, ...rolls])];
			result.sent += batch.length;
			await remove(batch.map((b) => b.key));
		} else if (batch.length > 1) {
			// One bad frame (say its roll was deleted) shouldn't sink the rest: retry one by one.
			for (const one of batch) await send([one]);
		} else {
			// Refused for good: drop it rather than retry forever, and say so.
			result.refused.push(`Frame ${batch[0].payload.number}: ${error.message}`);
			await remove([batch[0].key]);
		}
	};
	try {
		for (let i = 0; i < frames.length; i += 100) await send(frames.slice(i, i + 100));
	} catch (e) {
		if (isNetworkError(e)) return { ...result, offline: true, left: (await pending(userId)).length };
		throw e;
	}

	for (const call of calls) {
		try {
			const { data, error } =
				call.action === 'advanceRoll'
					? await actions.lab.advanceRoll(call.payload as Parameters<typeof actions.lab.advanceRoll>[0])
					: await actions.lab.rewindRoll(call.payload as Parameters<typeof actions.lab.rewindRoll>[0]);
			if (error) result.refused.push(error.message);
			else {
				result.rolls.push(data as RollView);
				result.sent++;
			}
			await remove([call.key]);
		} catch (e) {
			if (isNetworkError(e)) return { ...result, offline: true, left: (await pending(userId)).length };
			throw e;
		}
	}
	return { ...result, left: (await pending(userId)).length };
}

/** On sign-out: forget cached lab pages (they hold your logbook) on this device. */
export async function clearLabCaches() {
	if (!('caches' in window)) return;
	const keys = await caches.keys();
	await Promise.all(keys.filter((k) => k.startsWith('film-lab')).map((k) => caches.delete(k)));
}
