/**
 * The phone's outbox: frames and roll moves made while shooting are written
 * here first (IndexedDB, survives reloads and a dead signal), then flushed to
 * the server whenever it answers. Each item belongs to one user, so a
 * different account signing in on the same phone never sends someone else's
 * frames.
 */
import { actions } from 'astro:actions';

import { run } from './client';
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

let lastAt = 0;
/** Strictly increasing timestamps, so the outbox replays in the exact order things happened. */
const stamp = () => (lastAt = Math.max(Date.now(), lastAt + 1));

/**
 * Queue a roll move (loaded, finished, rewound, sent, scans in, filed) to
 * replay once online. Each move is its own entry: a roll loaded and finished
 * with no signal is two moves, replayed in that order.
 */
export const queueCall = (userId: string, action: CallAction, payload: Record<string, unknown>) => {
	const at = stamp();
	return tx('readwrite', (s) => s.put({ key: `call:${at}:${action}:${payload.rollId}`, userId, kind: 'call', action, at, payload } satisfies OutboxItem));
};

/** The signed-in person on this page (LabLayout writes it into a meta tag), for queueing from any island. */
export const labUserId = () => (typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="lab-user"]')?.content || null);

/** Today on this device, as 'YYYY-MM-DD' (Durham time, like the server): a page saved days ago mustn't date moves with its own day. */
export const deviceToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export interface MoveLookups {
	cameras: Record<string, { name: string }>;
	labs?: Record<string, { name: string; home?: boolean }>;
	lenses?: Record<string, { name: string }>;
}

/**
 * A roll as it will be once a queued move reaches the server: the same change
 * the server makes, made here so a page opened with no signal shows the truth.
 */
export function applyMove(r: RollView, action: CallAction, p: Record<string, unknown>, look: MoveLookups): RollView {
	if (action === 'rewindRoll') {
		return { ...r, status: 'storage', statusOn: String(p.on), rewoundAtFrame: Number(p.afterFrame) || 0, storageSpot: (p.storageSpot as string) || r.storageSpot, camera: r.camera };
	}
	const to = p.to as RollView['status'];
	const next: RollView = { ...r, status: to, statusOn: String(p.on) };
	const cam = p.cameraId as string | undefined;
	if (cam) next.camera = { id: cam, name: look.cameras[cam]?.name ?? r.camera?.name ?? 'Camera' };
	const lab = p.labId as string | undefined;
	if (lab) next.lab = { id: lab, name: look.labs?.[lab]?.name ?? r.lab?.name ?? 'Lab', home: look.labs?.[lab]?.home ?? false };
	const lensId = p.lensId as string | null | undefined;
	if (lensId !== undefined) next.lens = lensId ? { id: lensId, name: look.lenses?.[lensId]?.name ?? r.lens?.name ?? 'Lens' } : null;
	for (const k of ['shotAtIso', 'exposureComp', 'labOrder', 'labDelivery', 'trackingOut', 'trackingBack', 'devCostCents', 'printsIncluded', 'printsCostCents', 'devNotes', 'negativesAt'] as const) {
		if (k in p && p[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = p[k];
	}
	return next;
}

/** Every queued move applied, in order, to a list of rolls (moves for rolls not in the list are skipped). */
export function applyPending(rolls: RollView[], items: OutboxItem[], look: MoveLookups): RollView[] {
	let out = rolls;
	for (const i of items) {
		if (i.kind !== 'call') continue;
		const idx = out.findIndex((r) => r.id === i.payload.rollId);
		if (idx === -1) continue;
		out = out.slice();
		out[idx] = applyMove(out[idx], i.action, i.payload, look);
	}
	return out;
}

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

	// Replayed in the order they happened: a roll loaded offline is loaded before its frames
	// arrive (they take its camera), and finished after them. Runs of frames go in one request.
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
	const runFrames = async (batch: Extract<OutboxItem, { kind: 'frame' }>[]) => {
		for (let i = 0; i < batch.length; i += 100) await send(batch.slice(i, i + 100));
	};
	let run: Extract<OutboxItem, { kind: 'frame' }>[] = [];
	for (const item of [...items, null]) {
		if (item?.kind === 'frame') {
			run.push(item);
			continue;
		}
		try {
			if (run.length) await runFrames(run);
		} catch (e) {
			if (isNetworkError(e)) return { ...result, offline: true, left: (await pending(userId)).length };
			throw e;
		}
		run = [];
		if (!item) break;
		const call = item;
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

/** A roll changed on this phone with no signal: the move is queued and will sync. */
export type MaybeQueued = RollView & { queued?: boolean };

/**
 * Move a roll forward: straight to the server when there's signal; with none,
 * into the outbox (it syncs later, in order) and back comes the roll as it
 * will be. Refusals from the server (a bad date, say) still throw.
 */
export async function advanceOrQueue(roll: RollView, payload: Record<string, unknown>, look: MoveLookups): Promise<MaybeQueued> {
	try {
		return await run(actions.lab.advanceRoll(payload as Parameters<typeof actions.lab.advanceRoll>[0]));
	} catch (e) {
		const userId = labUserId();
		if (!userId || !(isNetworkError(e) || navigator.onLine === false)) throw e;
		await queueCall(userId, 'advanceRoll', payload);
		return { ...applyMove(roll, 'advanceRoll', payload, look), queued: true };
	}
}

/** On sign-out: forget cached lab pages (they hold your logbook) on this device. */
export async function clearLabCaches() {
	if (!('caches' in window)) return;
	const keys = await caches.keys();
	await Promise.all(keys.filter((k) => k.startsWith('film-lab')).map((k) => caches.delete(k)));
}
