/**
 * Film Lab writes, as Astro Actions (called from the lab's Vue islands as
 * `actions.lab.*`). Each one runs for the signed-in user only (the middleware
 * resolves the session for /_actions/*) and checks that every id it touches
 * belongs to them.
 */
import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import labels from '../data/film-labels.json';
import { nextCode, STAGES, type RollStatus } from '../lib/lab/inventory';
import { labConfig } from '../lib/lab/server/config';
import { getDb, type LabDb } from '../lib/lab/server/db/client';
import { camera, filmStock, frame, lab, lens, publish, roll, rollEvent, serviceLog } from '../lib/lab/server/db/schema';
import {
	deskRolls,
	guessCamera,
	guessStock,
	listCameras,
	listFrames,
	listLabs,
	listLenses,
	listStocks,
	rollViews,
	sameName,
} from '../lib/lab/server/inventory';
import { getFilmRolls, isMonochrome } from '../utils/film';

/* ---------- plumbing ---------- */

type Ctx = { locals: App.Locals };

async function session(context: Ctx) {
	const user = context.locals.user;
	if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Your session ended. Sign in again.' });
	const config = labConfig();
	if (!config.ok) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Film Lab isn’t configured here.' });
	return { d: await getDb(config.config), userId: user.id };
}

const notFound = (what: string) => new ActionError({ code: 'NOT_FOUND', message: `That ${what} isn’t in your logbook.` });
const bad = (message: string) => new ActionError({ code: 'BAD_REQUEST', message });

/** Throws unless `id` is a row of `table` that belongs to `userId`. */
async function mine(
	d: LabDb,
	table: typeof filmStock | typeof camera | typeof lens | typeof lab | typeof roll,
	userId: string,
	id: string | null | undefined,
	what: string
) {
	if (!id) return;
	const [row] = await d
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.id, id), eq(table.userId, userId)));
	if (!row) throw notFound(what);
}

const uid = () => crypto.randomUUID();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a full date.');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2027-06.');
const text = (max = 200) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v || null)
		.nullable();
const cents = z.number().int().min(0).max(10_000_000).nullable();
const id = z.string().min(1).max(64);

/** Drops keys the caller didn't send, so partial edits leave other columns alone. */
const defined = <T extends Record<string, unknown>>(o: T) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/* ---------- rolls ---------- */

const rollFields = {
	title: text(120).optional(),
	exposures: z.number().int().min(1).max(100).optional(),
	expires: month.nullable().optional(),
	purchasedOn: day.nullable().optional(),
	priceCents: cents.optional(),
	purchasedFrom: text(120).optional(),
	storageSpot: text(60).optional(),
	cameraId: id.nullable().optional(),
	shotAtIso: z.number().int().min(1).max(12800).nullable().optional(),
	labId: id.nullable().optional(),
	labOrder: text(60).optional(),
	devCostCents: cents.optional(),
	devNotes: text(300).optional(),
	negativesAt: text(80).optional(),
	notes: text(2000).optional(),
};

async function checkRefs(d: LabDb, userId: string, f: { cameraId?: string | null; labId?: string | null; stockId?: string | null }) {
	await mine(d, camera, userId, f.cameraId, 'camera');
	await mine(d, lab, userId, f.labId, 'lab');
	await mine(d, filmStock, userId, f.stockId, 'film stock');
}

async function loadRoll(d: LabDb, userId: string, rollId: string) {
	const [r] = await d.select().from(roll).where(and(eq(roll.id, rollId), eq(roll.userId, userId)));
	if (!r) throw notFound('roll');
	return r;
}

const oneView = async (d: LabDb, userId: string, rollId: string) => (await rollViews(d, userId, [rollId]))[0];

const stageIndex = (s: string) => (s === 'lost' ? 99 : STAGES.indexOf(s as (typeof STAGES)[number]));

/**
 * What it takes to give the logbook every camera, stock and lab that
 * film-labels.json names (plus `extra` tokens). Rows match by token, or by
 * name when they were added by hand, in which case they adopt the token
 * instead of getting a duplicate. Returns token → id maps and the writes.
 */
async function planCatalogue(d: LabDb, userId: string, extra: { stocks: string[]; cameras: string[]; labs: string[] }) {
	const [stocks, cams, labsHave] = await Promise.all([
		d.select({ id: filmStock.id, token: filmStock.token, name: filmStock.name, brand: filmStock.brand }).from(filmStock).where(eq(filmStock.userId, userId)),
		d.select({ id: camera.id, token: camera.token, name: camera.name, brand: camera.brand }).from(camera).where(eq(camera.userId, userId)),
		d.select({ id: lab.id, token: lab.token, name: lab.name }).from(lab).where(eq(lab.userId, userId)),
	]);
	const writes: unknown[] = [];
	const counts = { stocks: 0, cameras: 0, labs: 0, adopted: 0 };

	function plan<R>(
		kind: 'stocks' | 'cameras' | 'labs',
		rows: { id: string; token: string | null; name: string; brand?: string | null }[],
		table: typeof filmStock | typeof camera | typeof lab,
		make: (token: string) => R & { name: string; brand?: string }
	) {
		const ids = new Map<string, string>();
		for (const r of rows) if (r.token) ids.set(r.token, r.id);
		const tokens = new Set([...Object.keys(labels[kind]), ...extra[kind]]);
		const fresh: (R & { id: string; userId: string })[] = [];
		for (const token of tokens) {
			if (ids.has(token)) continue;
			const row = make(token);
			const handMade = rows.find((r) => !r.token && sameName(r.name, row.name, r.brand, row.brand));
			if (handMade) {
				ids.set(token, handMade.id);
				handMade.token = token;
				writes.push(d.update(table).set({ token }).where(eq(table.id, handMade.id)));
				counts.adopted++;
			} else {
				const id = uid();
				ids.set(token, id);
				fresh.push({ ...row, id, userId });
				counts[kind]++;
			}
		}
		if (fresh.length) writes.push(d.insert(table).values(fresh as never));
		return ids;
	}

	const stockIds = plan('stocks', stocks, filmStock, (t) => guessStock(t, isMonochrome));
	const cameraIds = plan('cameras', cams, camera, (t) => guessCamera(t));
	const labIds = plan('labs', labsHave, lab, (t) => ({ token: t, name: (labels.labs as Record<string, string>)[t] ?? t }));
	return { stockIds, cameraIds, labIds, writes: writes as Parameters<LabDb['batch']>[0][number][], counts };
}

export const server = {
	lab: {
		/** Buy film: N new rolls of one stock, straight into storage. */
		addRolls: defineAction({
			input: z.object({
				stockId: id,
				quantity: z.number().int().min(1).max(100),
				expires: month.nullable(),
				purchasedOn: day.nullable(),
				priceCents: cents,
				purchasedFrom: text(120),
				storageSpot: text(60),
				today: day,
			}),
			handler: async (input, context) => {
				const { d, userId } = await session(context);
				const [stock] = await d
					.select()
					.from(filmStock)
					.where(and(eq(filmStock.id, input.stockId), eq(filmStock.userId, userId)));
				if (!stock) throw notFound('film stock');
				const codes = (await d.select({ code: roll.code }).from(roll).where(eq(roll.userId, userId))).map((r) => r.code);
				const on = input.purchasedOn ?? input.today;
				const rows = Array.from({ length: input.quantity }, (_, i) => ({
					id: uid(),
					userId,
					code: nextCode(codes, i),
					stockId: stock.id,
					exposures: stock.exposures,
					status: 'storage',
					statusOn: on,
					expires: input.expires,
					purchasedOn: input.purchasedOn,
					priceCents: input.priceCents,
					purchasedFrom: input.purchasedFrom,
					storageSpot: input.storageSpot,
				}));
				await d.batch([
					d.insert(roll).values(rows),
					d.insert(rollEvent).values(rows.map((r) => ({ id: uid(), userId, rollId: r.id, status: 'storage', on }))),
				]);
				if (stock.wishlist) await d.update(filmStock).set({ wishlist: false }).where(eq(filmStock.id, stock.id));
				return rollViews(d, userId, rows.map((r) => r.id));
			},
		}),

		/** Move a roll forward (or to lost), with whatever that step records. */
		advanceRoll: defineAction({
			input: z.object({
				rollId: id,
				to: z.enum([...STAGES, 'lost']),
				on: day,
				note: text(300).optional(),
				...rollFields,
			}),
			handler: async ({ rollId, to, on, note, ...fields }, context) => {
				const { d, userId } = await session(context);
				const r = await loadRoll(d, userId, rollId);
				if (r.status === 'lost') throw bad('This roll is marked lost. Undo that first.');
				if (stageIndex(to) <= stageIndex(r.status)) throw bad('Rolls only move forward. Use “Undo last step” to go back.');
				if (to === 'camera' && !fields.cameraId) throw bad('Pick the camera it’s going into.');
				await checkRefs(d, userId, fields);
				await d.batch([
					d
						.update(roll)
						.set({ ...defined(fields), status: to, statusOn: on })
						.where(eq(roll.id, rollId)),
					d.insert(rollEvent).values({ id: uid(), userId, rollId, status: to, on, note: note ?? null }),
				]);
				return oneView(d, userId, rollId);
			},
		}),

		/** Send several shot rolls to one lab at once. */
		sendBatch: defineAction({
			input: z.object({
				rollIds: z.array(id).min(1).max(50),
				labId: id,
				on: day,
				labOrder: text(60),
				devCostCents: cents,
			}),
			handler: async ({ rollIds, labId, on, labOrder, devCostCents }, context) => {
				const { d, userId } = await session(context);
				await mine(d, lab, userId, labId, 'lab');
				const rolls = await d
					.select({ id: roll.id, status: roll.status })
					.from(roll)
					.where(and(eq(roll.userId, userId), inArray(roll.id, rollIds)));
				const ready = rolls.filter((r) => stageIndex(r.status) < stageIndex('lab') && r.status !== 'storage');
				if (!ready.length) throw bad('None of those rolls are waiting to be sent.');
				const ids = ready.map((r) => r.id);
				await d.batch([
					d
						.update(roll)
						.set({ status: 'lab', statusOn: on, labId, labOrder, ...(devCostCents != null ? { devCostCents } : {}) })
						.where(and(eq(roll.userId, userId), inArray(roll.id, ids))),
					d.insert(rollEvent).values(ids.map((rollId) => ({ id: uid(), userId, rollId, status: 'lab', on }))),
				]);
				return rollViews(d, userId, ids);
			},
		}),

		/** Take back the most recent move. */
		undoRollStep: defineAction({
			input: z.object({ rollId: id }),
			handler: async ({ rollId }, context) => {
				const { d, userId } = await session(context);
				const r = await loadRoll(d, userId, rollId);
				const events = await d
					.select()
					.from(rollEvent)
					.where(and(eq(rollEvent.rollId, rollId), eq(rollEvent.userId, userId)))
					.orderBy(desc(rollEvent.createdAt));
				if (events.length < 2) throw bad('There’s no earlier step to go back to.');
				const [latest, previous] = events;
				await d.batch([
					d.delete(rollEvent).where(eq(rollEvent.id, latest.id)),
					d
						.update(roll)
						.set({ status: previous.status, statusOn: previous.on })
						.where(eq(roll.id, r.id)),
				]);
				return oneView(d, userId, rollId);
			},
		}),

		updateRoll: defineAction({
			input: z.object({ rollId: id, stockId: id.optional(), ...rollFields }),
			handler: async ({ rollId, ...fields }, context) => {
				const { d, userId } = await session(context);
				await loadRoll(d, userId, rollId);
				await checkRefs(d, userId, fields);
				const set = defined(fields);
				if (Object.keys(set).length) await d.update(roll).set(set).where(eq(roll.id, rollId));
				return oneView(d, userId, rollId);
			},
		}),

		/** Move rolls to another fridge shelf, drawer or box. */
		moveRolls: defineAction({
			input: z.object({ rollIds: z.array(id).min(1).max(200), storageSpot: text(60) }),
			handler: async ({ rollIds, storageSpot }, context) => {
				const { d, userId } = await session(context);
				await d
					.update(roll)
					.set({ storageSpot })
					.where(and(eq(roll.userId, userId), inArray(roll.id, rollIds)));
				return rollViews(d, userId, rollIds);
			},
		}),

		/** Change when a step happened, or its note. */
		editEvent: defineAction({
			input: z.object({ eventId: id, on: day, note: text(300) }),
			handler: async ({ eventId, on, note }, context) => {
				const { d, userId } = await session(context);
				const [ev] = await d
					.select()
					.from(rollEvent)
					.where(and(eq(rollEvent.id, eventId), eq(rollEvent.userId, userId)));
				if (!ev) throw notFound('step');
				await d.update(rollEvent).set({ on, note }).where(eq(rollEvent.id, eventId));
				const [latest] = await d
					.select({ id: rollEvent.id })
					.from(rollEvent)
					.where(eq(rollEvent.rollId, ev.rollId))
					.orderBy(desc(rollEvent.createdAt))
					.limit(1);
				if (latest?.id === eventId) await d.update(roll).set({ statusOn: on }).where(eq(roll.id, ev.rollId));
				return { id: eventId, status: ev.status as RollStatus, on, note };
			},
		}),

		/** Tie a roll to its scans on the public film desk (or untie it). */
		linkDeskRoll: defineAction({
			input: z.object({ rollId: id, publicRollId: z.string().max(200).nullable() }),
			handler: async ({ rollId, publicRollId }, context) => {
				const { d, userId } = await session(context);
				await loadRoll(d, userId, rollId);
				if (publicRollId) {
					const desk = await deskRolls();
					if (!desk.some((r) => r.id === publicRollId)) throw bad('That roll isn’t on the film desk.');
					const [taken] = await d
						.select({ code: roll.code })
						.from(roll)
						.where(and(eq(roll.userId, userId), eq(roll.publicRollId, publicRollId)));
					if (taken) throw bad(`Those scans are already linked to ${taken.code}.`);
				}
				await d.update(roll).set({ publicRollId }).where(eq(roll.id, rollId));
				return oneView(d, userId, rollId);
			},
		}),

		deleteRoll: defineAction({
			input: z.object({ rollId: id }),
			handler: async ({ rollId }, context) => {
				const { d, userId } = await session(context);
				await loadRoll(d, userId, rollId);
				await d.batch([
					d.delete(frame).where(eq(frame.rollId, rollId)),
					d.delete(rollEvent).where(eq(rollEvent.rollId, rollId)),
					d.delete(roll).where(eq(roll.id, rollId)),
				]);
				return { ok: true };
			},
		}),

		/* ---------- frames ---------- */

		/**
		 * Save frames from the phone (new, edited or deleted), matched by the
		 * client id the phone gave each one. Safe to send twice: the offline
		 * queue retries until it hears back. Returns every frame on those rolls.
		 */
		syncFrames: defineAction({
			input: z.object({
				frames: z
					.array(
						z.object({
							clientId: z.string().min(8).max(64),
							rollId: id,
							number: z.number().int().min(-1).max(200),
							shotAt: z.number().int().min(0),
							tzOffset: z.number().int().min(-840).max(840),
							cameraId: id.nullable(),
							lensId: id.nullable(),
							focalLength: z.number().int().min(1).max(2000).nullable(),
							aperture: z.number().min(0.7).max(128).nullable(),
							shutter: z.string().trim().max(12).nullable(),
							flash: z.boolean(),
							lat: z.number().min(-90).max(90).nullable(),
							lng: z.number().min(-180).max(180).nullable(),
							accuracy: z.number().int().min(0).max(100_000).nullable(),
							note: text(500),
							deleted: z.boolean().optional(),
						})
					)
					.min(1)
					.max(200),
			}),
			handler: async ({ frames }, context) => {
				const { d, userId } = await session(context);
				const rollIds = [...new Set(frames.map((f) => f.rollId))];
				const owned = await d
					.select({ id: roll.id, cameraId: roll.cameraId })
					.from(roll)
					.where(and(eq(roll.userId, userId), inArray(roll.id, rollIds)));
				if (owned.length !== rollIds.length) throw notFound('roll');
				for (const lensId of new Set(frames.map((f) => f.lensId).filter(Boolean))) await mine(d, lens, userId, lensId, 'lens');
				for (const cameraId of new Set(frames.map((f) => f.cameraId).filter(Boolean))) await mine(d, camera, userId, cameraId, 'camera');
				const rollCamera = new Map(owned.map((r) => [r.id, r.cameraId]));

				const writes = frames.map(({ deleted, ...f }) => {
					if (deleted) return d.delete(frame).where(and(eq(frame.userId, userId), eq(frame.clientId, f.clientId)));
					const row = { ...f, cameraId: f.cameraId ?? rollCamera.get(f.rollId) ?? null, updatedAt: new Date() };
					return d
						.insert(frame)
						.values({ id: uid(), userId, ...row })
						.onConflictDoUpdate({ target: [frame.userId, frame.clientId], set: row });
				});
				await d.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
				return listFrames(d, userId, rollIds);
			},
		}),

		/**
		 * Rewound part-way (an SLR roll pulled to swap film): back to storage,
		 * remembering the last frame so reloading can wind past it.
		 */
		rewindRoll: defineAction({
			input: z.object({ rollId: id, afterFrame: z.number().int().min(0).max(200), on: day, storageSpot: text(60) }),
			handler: async ({ rollId, afterFrame, on, storageSpot }, context) => {
				const { d, userId } = await session(context);
				const r = await loadRoll(d, userId, rollId);
				if (r.status !== 'camera') throw bad('Only a roll that’s in a camera can be rewound.');
				await d.batch([
					d
						.update(roll)
						.set({ status: 'storage', statusOn: on, rewoundAtFrame: afterFrame, ...(storageSpot ? { storageSpot } : {}) })
						.where(eq(roll.id, rollId)),
					d.insert(rollEvent).values({ id: uid(), userId, rollId, status: 'storage', on, note: `Rewound after frame ${afterFrame}` }),
				]);
				return oneView(d, userId, rollId);
			},
		}),

		/* ---------- the public film desk (phase 4) ---------- */

		/** What this roll shows in the public lightbox. */
		updateSharing: defineAction({
			input: z.object({ rollId: id, shareExposure: z.boolean(), sharePlace: text(80), shareNotes: z.boolean() }),
			handler: async ({ rollId, ...set }, context) => {
				const { d, userId } = await session(context);
				await loadRoll(d, userId, rollId);
				await d.update(roll).set(set).where(eq(roll.id, rollId));
				return oneView(d, userId, rollId);
			},
		}),

		/** Which frame the lab's first scan shows (0 when it scanned a frame 0 or 00). */
		setFirstScanFrame: defineAction({
			input: z.object({ rollId: id, firstScanFrame: z.number().int().min(-1).max(10) }),
			handler: async ({ rollId, firstScanFrame }, context) => {
				const { d, userId } = await session(context);
				await loadRoll(d, userId, rollId);
				await d.update(roll).set({ firstScanFrame }).where(eq(roll.id, rollId));
				return oneView(d, userId, rollId);
			},
		}),

		/** Pin a frame to a specific scan (or unpin it with null). */
		pinFrameScan: defineAction({
			input: z.object({ frameId: id, scanFilename: z.string().min(1).max(300).nullable() }),
			handler: async ({ frameId, scanFilename }, context) => {
				const { d, userId } = await session(context);
				const [f] = await d
					.select({ id: frame.id, rollId: frame.rollId })
					.from(frame)
					.where(and(eq(frame.id, frameId), eq(frame.userId, userId)));
				if (!f) throw notFound('frame');
				// One frame per scan: pinning here unpins whichever frame had it.
				const writes = [
					...(scanFilename
						? [d.update(frame).set({ scanFilename: null }).where(and(eq(frame.rollId, f.rollId), eq(frame.scanFilename, scanFilename)))]
						: []),
					d.update(frame).set({ scanFilename }).where(eq(frame.id, frameId)),
				];
				await d.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
				return listFrames(d, userId, [f.rollId]);
			},
		}),

		/**
		 * Rebuild the public site so it picks up what the lab now shares, via
		 * the Vercel deploy hook. Owner only, at most once a minute.
		 */
		publishSite: defineAction({
			handler: async (_input, context) => {
				const { d, userId } = await session(context);
				if ((context.locals.user as { role?: string } | null)?.role !== 'owner') {
					throw new ActionError({ code: 'FORBIDDEN', message: 'Only the owner can publish the portfolio.' });
				}
				const config = labConfig();
				const hook = config.ok ? config.config.deployHook : undefined;
				if (!hook) {
					throw bad(
						import.meta.env.PROD
							? 'Publishing isn’t set up: add VERCEL_DEPLOY_HOOK_URL in Vercel and redeploy.'
							: 'In local development the film desk reads the logbook live: just reload /photography/.'
					);
				}
				const [last] = await d.select({ at: publish.at }).from(publish).where(eq(publish.userId, userId)).orderBy(desc(publish.at)).limit(1);
				if (last && Date.now() - last.at.getTime() < 60_000) throw bad('Published less than a minute ago. The site is still rebuilding.');
				const res = await fetch(hook, { method: 'POST' }).catch(() => null);
				const ok = !!res?.ok;
				const at = new Date();
				await d.insert(publish).values({ id: uid(), userId, at, status: ok ? 'started' : 'failed', note: res ? `HTTP ${res.status}` : 'no response' });
				if (!ok) throw new ActionError({ code: 'BAD_GATEWAY', message: 'Vercel didn’t accept the deploy hook. Check the URL in its settings.' });
				return { at: at.toISOString() };
			},
		}),

		/* ---------- catalogue ---------- */

		saveStock: defineAction({
			input: z.object({
				id: id.optional(),
				brand: z.string().trim().min(1).max(60),
				name: z.string().trim().min(1).max(120),
				iso: z.number().int().min(1).max(12800).nullable(),
				process: z.string().trim().min(1).max(20),
				format: z.string().trim().min(1).max(20),
				exposures: z.number().int().min(1).max(100),
				wishlist: z.boolean(),
				notes: text(1000),
			}),
			handler: async ({ id: stockId, ...fields }, context) => {
				const { d, userId } = await session(context);
				if (stockId) {
					await mine(d, filmStock, userId, stockId, 'film stock');
					await d.update(filmStock).set(fields).where(eq(filmStock.id, stockId));
				} else {
					await d.insert(filmStock).values({ id: (stockId = uid()), userId, ...fields });
				}
				return (await listStocks(d, userId)).find((s) => s.id === stockId)!;
			},
		}),

		deleteStock: defineAction({
			input: z.object({ id }),
			handler: async ({ id: stockId }, context) => {
				const { d, userId } = await session(context);
				await mine(d, filmStock, userId, stockId, 'film stock');
				const [used] = await d.select({ id: roll.id }).from(roll).where(eq(roll.stockId, stockId)).limit(1);
				if (used) throw bad('Rolls of this stock are in your logbook. Remove them first.');
				await d.delete(filmStock).where(eq(filmStock.id, stockId));
				return { ok: true };
			},
		}),

		saveCamera: defineAction({
			input: z.object({
				id: id.optional(),
				brand: z.string().trim().min(1).max(60),
				name: z.string().trim().min(1).max(120),
				kind: z.string().trim().min(1).max(30),
				format: z.string().trim().min(1).max(20),
				mount: text(60),
				fixedLens: text(80),
				battery: text(60),
				batteryChangedOn: day.nullable(),
				serial: text(60),
				acquiredOn: day.nullable(),
				priceCents: cents,
				acquiredFrom: text(120),
				status: z.string().trim().min(1).max(20),
				notes: text(2000),
			}),
			handler: async ({ id: cameraId, ...fields }, context) => {
				const { d, userId } = await session(context);
				if (cameraId) {
					await mine(d, camera, userId, cameraId, 'camera');
					await d.update(camera).set(fields).where(eq(camera.id, cameraId));
				} else {
					await d.insert(camera).values({ id: (cameraId = uid()), userId, ...fields });
				}
				return (await listCameras(d, userId)).find((c) => c.id === cameraId)!;
			},
		}),

		deleteCamera: defineAction({
			input: z.object({ id }),
			handler: async ({ id: cameraId }, context) => {
				const { d, userId } = await session(context);
				await mine(d, camera, userId, cameraId, 'camera');
				const [loaded] = await d
					.select({ code: roll.code })
					.from(roll)
					.where(and(eq(roll.cameraId, cameraId), eq(roll.status, 'camera')));
				if (loaded) throw bad(`${loaded.code} is loaded in this camera. Finish or unload it first.`);
				await d.batch([
					d.update(roll).set({ cameraId: null }).where(eq(roll.cameraId, cameraId)),
					d.delete(serviceLog).where(eq(serviceLog.cameraId, cameraId)),
					d.delete(camera).where(eq(camera.id, cameraId)),
				]);
				return { ok: true };
			},
		}),

		saveLens: defineAction({
			input: z.object({
				id: id.optional(),
				brand: z.string().trim().min(1).max(60),
				name: z.string().trim().min(1).max(120),
				mount: z.string().trim().min(1).max(60),
				focalMin: z.number().int().min(1).max(2000).nullable(),
				focalMax: z.number().int().min(1).max(2000).nullable(),
				maxAperture: z.number().min(0.7).max(64).nullable(),
				serial: text(60),
				acquiredOn: day.nullable(),
				priceCents: cents,
				acquiredFrom: text(120),
				status: z.string().trim().min(1).max(20),
				notes: text(2000),
			}),
			handler: async ({ id: lensId, ...fields }, context) => {
				const { d, userId } = await session(context);
				if (lensId) {
					await mine(d, lens, userId, lensId, 'lens');
					await d.update(lens).set(fields).where(eq(lens.id, lensId));
				} else {
					await d.insert(lens).values({ id: (lensId = uid()), userId, ...fields });
				}
				return (await listLenses(d, userId)).find((l) => l.id === lensId)!;
			},
		}),

		deleteLens: defineAction({
			input: z.object({ id }),
			handler: async ({ id: lensId }, context) => {
				const { d, userId } = await session(context);
				await mine(d, lens, userId, lensId, 'lens');
				await d.batch([d.delete(serviceLog).where(eq(serviceLog.lensId, lensId)), d.delete(lens).where(eq(lens.id, lensId))]);
				return { ok: true };
			},
		}),

		addService: defineAction({
			input: z.object({
				cameraId: id.nullable(),
				lensId: id.nullable(),
				on: day,
				kind: z.string().trim().min(1).max(20),
				costCents: cents,
				note: text(300),
			}),
			handler: async (input, context) => {
				const { d, userId } = await session(context);
				if (!input.cameraId && !input.lensId) throw bad('Pick a camera or lens.');
				await mine(d, camera, userId, input.cameraId, 'camera');
				await mine(d, lens, userId, input.lensId, 'lens');
				const entry = { id: uid(), userId, ...input };
				await d.insert(serviceLog).values(entry);
				// A battery swap also updates the camera's "last battery" date.
				if (input.kind === 'battery' && input.cameraId) {
					await d.update(camera).set({ batteryChangedOn: input.on }).where(eq(camera.id, input.cameraId));
				}
				const { userId: _u, ...view } = entry;
				return view;
			},
		}),

		deleteService: defineAction({
			input: z.object({ id }),
			handler: async ({ id: entryId }, context) => {
				const { d, userId } = await session(context);
				await d.delete(serviceLog).where(and(eq(serviceLog.id, entryId), eq(serviceLog.userId, userId)));
				return { ok: true };
			},
		}),

		saveLab: defineAction({
			input: z.object({
				id: id.optional(),
				name: z.string().trim().min(1).max(120),
				location: text(120),
				url: z
					.string()
					.trim()
					.max(300)
					.transform((v) => v || null)
					.refine((v) => !v || /^https?:\/\//.test(v), 'Links start with https://')
					.nullable(),
				costCents: cents,
				notes: text(1000),
			}),
			handler: async ({ id: labId, ...fields }, context) => {
				const { d, userId } = await session(context);
				if (labId) {
					await mine(d, lab, userId, labId, 'lab');
					await d.update(lab).set(fields).where(eq(lab.id, labId));
				} else {
					await d.insert(lab).values({ id: (labId = uid()), userId, ...fields });
				}
				return (await listLabs(d, userId)).find((l) => l.id === labId)!;
			},
		}),

		deleteLab: defineAction({
			input: z.object({ id }),
			handler: async ({ id: labId }, context) => {
				const { d, userId } = await session(context);
				await mine(d, lab, userId, labId, 'lab');
				await d.batch([d.update(roll).set({ labId: null }).where(eq(roll.labId, labId)), d.delete(lab).where(eq(lab.id, labId))]);
				return { ok: true };
			},
		}),

		/* ---------- backfill ---------- */

		/**
		 * Bring the public film desk into the logbook: every camera, stock and lab
		 * named in film-labels.json, then one roll per desk roll ("Negatives
		 * home", linked to its scans). Safe to run again: it skips what exists.
		 */
		/** Add the cameras, stocks and labs named in film-labels.json that the logbook lacks. */
		syncCatalogue: defineAction({
			handler: async (_input, context) => {
				const { d, userId } = await session(context);
				const plan = await planCatalogue(d, userId, { stocks: [], cameras: [], labs: [] });
				if (plan.writes.length) await d.batch(plan.writes as [(typeof plan.writes)[number], ...(typeof plan.writes)[number][]]);
				return { ...plan.counts, stocksList: await listStocks(d, userId) };
			},
		}),

		importFromDesk: defineAction({
			handler: async (_input, context) => {
				const { d, userId } = await session(context);
				const [linked, codes] = await Promise.all([
					d.select({ id: roll.publicRollId }).from(roll).where(and(eq(roll.userId, userId), isNotNull(roll.publicRollId))),
					d.select({ code: roll.code }).from(roll).where(eq(roll.userId, userId)),
				]);
				const desk = (await getFilmRolls()).filter((r) => !linked.some((l) => l.id === r.id));
				// Every token the labels name, plus any a desk roll uses without a label.
				const plan = await planCatalogue(d, userId, {
					stocks: desk.map((r) => r.data.stock),
					cameras: desk.map((r) => r.data.camera),
					labs: desk.map((r) => r.data.lab),
				});
				const { stockIds, cameraIds, labIds } = plan;

				const ordered = [...desk].sort(
					(a, b) => a.data.developed.valueOf() - b.data.developed.valueOf() || a.id.localeCompare(b.id)
				);
				const rolls = ordered.map((r, i) => {
					const developed = r.data.developed.toISOString().slice(0, 10);
					return {
						id: uid(),
						userId,
						code: nextCode(codes.map((c) => c.code), i),
						stockId: stockIds.get(r.data.stock)!,
						exposures: 36,
						title: r.data.title,
						status: 'negatives',
						statusOn: developed,
						cameraId: cameraIds.get(r.data.camera) ?? null,
						labId: labIds.get(r.data.lab) ?? null,
						publicRollId: r.id,
					};
				});
				const events = rolls.flatMap((r) => [
					{ id: uid(), userId, rollId: r.id, status: 'scanned', on: r.statusOn, note: 'Imported from the film desk' },
					{ id: uid(), userId, rollId: r.id, status: 'negatives', on: r.statusOn, note: null },
				]);

				const writes = [
					...plan.writes,
					...(rolls.length ? [d.insert(roll).values(rolls), d.insert(rollEvent).values(events)] : []),
				];
				if (writes.length) await d.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
				return { stocks: plan.counts.stocks, cameras: plan.counts.cameras, labs: plan.counts.labs, rolls: rolls.length };
			},
		}),
	},
};
