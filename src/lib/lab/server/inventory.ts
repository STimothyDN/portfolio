/**
 * Logbook reads for server-rendered lab pages and the actions. Every query is
 * scoped to one user.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { frameExposure, negativeProfileKey, type NegativeProfileKey } from '../../../components/film/negative';
import { filmBrand, filmLabel, getFilmRolls, isMonochrome, rollFolder } from '../../../utils/film';
import type {
	CameraView,
	DeskRollOption,
	FrameView,
	LabView,
	LensView,
	RollEventView,
	RollStatus,
	RollView,
	StepChoices,
	StockView,
} from '../inventory';
import type { LabDb } from './db/client';
import { camera, filmStock, frame, lab, labSetting, lens, roll, rollEvent, serviceLog } from './db/schema';

/* ---------- rolls ---------- */

const rollSelect = {
	roll,
	stock: {
		id: filmStock.id,
		token: filmStock.token,
		brand: filmStock.brand,
		name: filmStock.name,
		iso: filmStock.iso,
		process: filmStock.process,
		format: filmStock.format,
	},
	cameraId: camera.id,
	cameraName: camera.name,
	labId: lab.id,
	labName: lab.name,
	frameCount: sql<number>`(select count(*) from ${frame} where ${frame.rollId} = ${roll.id})`,
};

type RollRow = {
	roll: typeof roll.$inferSelect;
	stock: RollView['stock'];
	cameraId: string | null;
	cameraName: string | null;
	labId: string | null;
	labName: string | null;
	frameCount: number;
};

function toRollView({ roll: r, stock, cameraId, cameraName, labId, labName, frameCount }: RollRow): RollView {
	return {
		id: r.id,
		code: r.code,
		title: r.title,
		status: r.status as RollStatus,
		statusOn: r.statusOn,
		exposures: r.exposures,
		stock,
		camera: cameraId && cameraName ? { id: cameraId, name: cameraName } : null,
		lab: labId && labName ? { id: labId, name: labName } : null,
		shotAtIso: r.shotAtIso,
		expires: r.expires,
		purchasedOn: r.purchasedOn,
		priceCents: r.priceCents,
		purchasedFrom: r.purchasedFrom,
		storageSpot: r.storageSpot,
		labOrder: r.labOrder,
		devCostCents: r.devCostCents,
		devNotes: r.devNotes,
		negativesAt: r.negativesAt,
		publicRollId: r.publicRollId,
		notes: r.notes,
		rewoundAtFrame: r.rewoundAtFrame,
		frameCount: Number(frameCount ?? 0),
		shareExposure: r.shareExposure,
		sharePlace: r.sharePlace,
		shareNotes: r.shareNotes,
		firstScanFrame: r.firstScanFrame,
	};
}

/* ---------- frames ---------- */

const frameSelect = {
	id: frame.id,
	clientId: frame.clientId,
	rollId: frame.rollId,
	number: frame.number,
	shotAt: frame.shotAt,
	tzOffset: frame.tzOffset,
	cameraId: frame.cameraId,
	lensId: frame.lensId,
	focalLength: frame.focalLength,
	aperture: frame.aperture,
	shutter: frame.shutter,
	flash: frame.flash,
	lat: frame.lat,
	lng: frame.lng,
	accuracy: frame.accuracy,
	note: frame.note,
	scanFilename: frame.scanFilename,
};

export async function listFrames(d: LabDb, userId: string, rollIds: string[]): Promise<FrameView[]> {
	if (!rollIds.length) return [];
	return d
		.select(frameSelect)
		.from(frame)
		.where(and(eq(frame.userId, userId), inArray(frame.rollId, rollIds)))
		.orderBy(asc(frame.number), asc(frame.shotAt));
}

/** Every frame someone has logged, on any roll. */
export async function allFrames(d: LabDb, userId: string): Promise<FrameView[]> {
	return d.select(frameSelect).from(frame).where(eq(frame.userId, userId)).orderBy(asc(frame.number), asc(frame.shotAt));
}

export async function rollViews(d: LabDb, userId: string, ids?: string[]): Promise<RollView[]> {
	if (ids && !ids.length) return [];
	const rows = await d
		.select(rollSelect)
		.from(roll)
		.innerJoin(filmStock, eq(filmStock.id, roll.stockId))
		.leftJoin(camera, eq(camera.id, roll.cameraId))
		.leftJoin(lab, eq(lab.id, roll.labId))
		.where(ids ? and(eq(roll.userId, userId), inArray(roll.id, ids)) : eq(roll.userId, userId))
		.orderBy(desc(roll.code));
	return rows.map(toRollView);
}

export async function rollByCode(d: LabDb, userId: string, code: string) {
	const byCode = and(eq(roll.userId, userId), eq(roll.code, code.toUpperCase()));
	// The roll and its history together: one round trip to the database, not two.
	const [[row], events] = await Promise.all([
		d
			.select(rollSelect)
			.from(roll)
			.innerJoin(filmStock, eq(filmStock.id, roll.stockId))
			.leftJoin(camera, eq(camera.id, roll.cameraId))
			.leftJoin(lab, eq(lab.id, roll.labId))
			.where(byCode),
		d
			.select({ id: rollEvent.id, status: rollEvent.status, on: rollEvent.on, note: rollEvent.note })
			.from(rollEvent)
			.where(and(eq(rollEvent.userId, userId), inArray(rollEvent.rollId, d.select({ id: roll.id }).from(roll).where(byCode))))
			.orderBy(asc(rollEvent.on), asc(rollEvent.createdAt)),
	]);
	if (!row) return null;
	return { roll: toRollView(row), events: events as RollEventView[] };
}

/* ---------- almanac ---------- */

/** The latest date each roll reached each stage: roll id → stage → 'YYYY-MM-DD'. */
export async function rollMilestones(d: LabDb, userId: string): Promise<Record<string, Partial<Record<RollStatus, string>>>> {
	const rows = await d
		.select({ rollId: rollEvent.rollId, status: rollEvent.status, on: rollEvent.on })
		.from(rollEvent)
		.where(eq(rollEvent.userId, userId))
		.orderBy(asc(rollEvent.on), asc(rollEvent.createdAt));
	const out: Record<string, Partial<Record<RollStatus, string>>> = {};
	for (const r of rows) (out[r.rollId] ??= {})[r.status as RollStatus] = r.on;
	return out;
}

/**
 * Every logged frame, compactly: [aperture, shutter, hour of day where it was
 * taken (or null), roll id]. Enough for the exposure map and the clock.
 */
export async function frameDigest(d: LabDb, userId: string): Promise<[number | null, string | null, number | null, string][]> {
	const rows = await d
		.select({ aperture: frame.aperture, shutter: frame.shutter, shotAt: frame.shotAt, tzOffset: frame.tzOffset, rollId: frame.rollId })
		.from(frame)
		.where(eq(frame.userId, userId));
	return rows.map((f) => [
		f.aperture,
		f.shutter,
		f.shotAt ? new Date(f.shotAt + f.tzOffset * 60_000).getUTCHours() : null,
		f.rollId,
	]);
}

/* ---------- catalogue ---------- */

/** Someone's lab settings (defaults until they change one). */
export async function labSettings(d: LabDb, userId: string): Promise<{ shareLoaded: boolean }> {
	const [row] = await d.select({ shareLoaded: labSetting.shareLoaded }).from(labSetting).where(eq(labSetting.userId, userId));
	return { shareLoaded: row?.shareLoaded ?? false };
}

export async function listStocks(d: LabDb, userId: string): Promise<StockView[]> {
	const rows = await d.select().from(filmStock).where(eq(filmStock.userId, userId)).orderBy(asc(filmStock.brand), asc(filmStock.name));
	return rows.map(({ userId: _u, createdAt: _c, updatedAt: _m, ...s }) => s);
}

export async function listCameras(d: LabDb, userId: string): Promise<CameraView[]> {
	const rows = await d.select().from(camera).where(eq(camera.userId, userId)).orderBy(asc(camera.name));
	return rows.map(({ userId: _u, createdAt: _c, updatedAt: _m, ...c }) => c);
}

export async function listLenses(d: LabDb, userId: string): Promise<LensView[]> {
	const rows = await d.select().from(lens).where(eq(lens.userId, userId)).orderBy(asc(lens.mount), asc(lens.focalMin));
	return rows.map(({ userId: _u, createdAt: _c, updatedAt: _m, ...l }) => l);
}

export async function listLabs(d: LabDb, userId: string): Promise<LabView[]> {
	const rows = await d.select().from(lab).where(eq(lab.userId, userId)).orderBy(asc(lab.name));
	return rows.map(({ userId: _u, createdAt: _c, updatedAt: _m, ...l }) => l);
}

export interface ServiceEntry {
	id: string;
	cameraId: string | null;
	lensId: string | null;
	on: string;
	kind: string;
	costCents: number | null;
	note: string | null;
}

export async function listService(d: LabDb, userId: string): Promise<ServiceEntry[]> {
	return d
		.select({
			id: serviceLog.id,
			cameraId: serviceLog.cameraId,
			lensId: serviceLog.lensId,
			on: serviceLog.on,
			kind: serviceLog.kind,
			costCents: serviceLog.costCents,
			note: serviceLog.note,
		})
		.from(serviceLog)
		.where(eq(serviceLog.userId, userId))
		.orderBy(desc(serviceLog.on));
}

/* ---------- lab turnaround ---------- */

export interface LabStats {
	rolls: number;
	/** Median days from "sent" to "scans in", when there are dated pairs. */
	medianDays: number | null;
	samples: number;
}

export async function labStats(d: LabDb, userId: string): Promise<Record<string, LabStats>> {
	const [rows, counts] = await Promise.all([
		d
			.select({ rollId: rollEvent.rollId, status: rollEvent.status, on: rollEvent.on, labId: roll.labId })
			.from(rollEvent)
			.innerJoin(roll, eq(roll.id, rollEvent.rollId))
			.where(and(eq(rollEvent.userId, userId), inArray(rollEvent.status, ['lab', 'scanned'])))
			.orderBy(asc(rollEvent.on), asc(rollEvent.createdAt)),
		d.select({ labId: roll.labId }).from(roll).where(eq(roll.userId, userId)),
	]);

	const stats: Record<string, LabStats> = {};
	const turn: Record<string, number[]> = {};
	for (const { labId } of counts) {
		if (!labId) continue;
		stats[labId] ??= { rolls: 0, medianDays: null, samples: 0 };
		stats[labId].rolls++;
	}
	const sent = new Map<string, string>();
	for (const e of rows) {
		if (!e.labId) continue;
		if (e.status === 'lab') sent.set(e.rollId, e.on);
		else if (sent.has(e.rollId)) {
			const from = sent.get(e.rollId)!;
			const days = Math.round((Date.parse(e.on) - Date.parse(from)) / 864e5);
			if (days >= 0) (turn[e.labId] ??= []).push(days);
			sent.delete(e.rollId);
		}
	}
	for (const [labId, list] of Object.entries(turn)) {
		const sorted = list.sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		stats[labId] ??= { rolls: 0, medianDays: null, samples: 0 };
		stats[labId].samples = sorted.length;
		stats[labId].medianDays = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
	}
	return stats;
}

/* ---------- the public film desk ---------- */

/** Every roll on the public film desk, as link options. */
export async function deskRolls(): Promise<DeskRollOption[]> {
	const rolls = await getFilmRolls();
	return rolls.map((r) => ({
		id: r.id,
		title: r.data.title,
		developed: r.data.developed.toISOString().slice(0, 10),
		camera: filmLabel('cameras', r.data.camera),
		stock: filmLabel('stocks', r.data.stock),
		lab: filmLabel('labs', r.data.lab),
		count: r.data.photos.length,
	}));
}

/** A linked desk roll's title, scan count and a few scan paths for thumbnails. */
export async function deskRollPreview(id: string) {
	const rolls = await getFilmRolls();
	const r = rolls.find((x) => x.id === id);
	if (!r) return null;
	const folder = rollFolder(r);
	const picks = [...r.data.photos]
		.map((p, i) => ({ p, i }))
		.sort((a, b) => b.p.priority - a.p.priority || a.i - b.i)
		.slice(0, 6)
		.sort((a, b) => a.i - b.i);
	return {
		id: r.id,
		title: r.data.title,
		developed: r.data.developed.toISOString().slice(0, 10),
		count: r.data.photos.length,
		scans: picks.map(({ p, i }) => ({ path: `${folder}/${p.filename}`, frame: i + 1, w: p.width, h: p.height })),
	};
}

/**
 * Every scan of a linked desk roll, for the roll page's strip: storage path,
 * frame number, and the exposure its negative is drawn at (from the scan's
 * measured tone), plus which stock profile draws the negatives.
 */
export async function deskRollStrip(id: string): Promise<{
	profile: NegativeProfileKey;
	scans: { path: string; frame: number; w?: number; h?: number; exposure: number }[];
} | null> {
	const r = (await getFilmRolls()).find((x) => x.id === id);
	if (!r) return null;
	const label = filmLabel('stocks', r.data.stock);
	const folder = rollFolder(r);
	return {
		profile: negativeProfileKey(label, filmBrand('stocks', r.data.stock), isMonochrome(label)),
		scans: r.data.photos.map((p, i) => ({
			path: `${folder}/${p.filename}`,
			frame: i + 1,
			w: p.width,
			h: p.height,
			exposure: p.tone ? frameExposure(p.tone) : 0,
		})),
	};
}

/** Choices for the stage-change forms. Desk rolls to link are offered to the owner only. */
export async function stepChoices(d: LabDb, userId: string, owner: boolean): Promise<StepChoices> {
	const [cams, labs, linked, desk] = await Promise.all([
		d.select({ id: camera.id, name: camera.name, format: camera.format, status: camera.status }).from(camera).where(eq(camera.userId, userId)).orderBy(asc(camera.name)),
		d.select({ id: lab.id, name: lab.name, costCents: lab.costCents }).from(lab).where(eq(lab.userId, userId)).orderBy(asc(lab.name)),
		owner ? d.select({ id: roll.publicRollId }).from(roll).where(eq(roll.userId, userId)) : Promise.resolve([]),
		owner ? deskRolls() : Promise.resolve([]),
	]);
	const taken = new Set(linked.map((l) => l.id).filter(Boolean));
	return {
		cameras: cams.filter((c) => c.status !== 'gone' && c.status !== 'wishlist'),
		labs,
		deskRolls: desk.filter((r) => !taken.has(r.id)),
	};
}

/* ---------- seeding from film-labels.json ---------- */

const STANDARD_ISO = [25, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1600, 3200, 6400];
const ISO_OVERRIDES: Record<string, number> = { lomocolor92: 400, lomocolor92sunkissed: 400 };

/** What's worth knowing when you load one (shown on the stock, editable). */
const STOCK_NOTES: Record<string, string> = {
	cinestill800t:
		'Tungsten-balanced (3200K): warm-to-neutral under tungsten, cool in daylight. No remjet, so bright highlights get a red halation glow. Processed C-41.',
	cinestill400d: 'Daylight-balanced Vision3 without remjet; red halation around bright highlights. Processed C-41.',
	cinestill50d: 'Daylight-balanced, very fine grain, no remjet. Processed C-41.',
	candido800: 'Respooled motion-picture film, tungsten-leaning. Processed C-41.',
	candido400: 'Respooled motion-picture film with the remjet removed. Processed C-41.',
	ektar100: 'Very fine grain, high saturation and contrast; less forgiving of underexposure than Portra. Processed C-41.',
	ektacolorpro400: 'Discontinued Kodak professional stock, so any roll today is expired: rate it slower (about a stop per decade past date).',
	ektacolorpro800: 'Discontinued Kodak professional stock, so any roll today is expired: rate it slower (about a stop per decade past date).',
	ladygrey400: 'Lomography’s black-and-white 400. Develops in standard B&W chemistry; labs list it as B&W.',
};

export function guessStock(token: string, isMono: (name: string) => boolean) {
	const name = filmLabel('stocks', token);
	const numbers = [...name.matchAll(/(\d{2,4})/g)].map((m) => Number(m[1])).filter((n) => STANDARD_ISO.includes(n));
	const iso = ISO_OVERRIDES[token] ?? numbers.at(-1) ?? null;
	const process = isMono(name) ? 'B&W' : /velvia|provia|ektachrome|e100|astia|chrome/i.test(name) ? 'E-6' : 'C-41';
	return { token, name, brand: filmBrand('stocks', token), iso, process, notes: STOCK_NOTES[token] ?? null };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Names compared loosely, with or without the brand in front:
 * "CineStill 800T" = "cinestill 800 t", and "Ektar 100" (brand Kodak) = "Kodak Ektar 100".
 */
export function sameName(a: string, b: string, brandA?: string | null, brandB?: string | null): boolean {
	const forms = (name: string, brand?: string | null) => [squash(name), brand ? squash(`${brand} ${name}`) : null].filter(Boolean);
	const fa = forms(a, brandA);
	return forms(b, brandB).some((x) => fa.includes(x));
}

type Named = { token: string | null; name: string; brand?: string | null };

/**
 * film-labels.json entries the logbook doesn't have yet, per kind. A row you
 * added by hand with the same name counts as having it (the sync adopts it).
 */
export function labelGaps(
	labels: { stocks: Record<string, string>; cameras: Record<string, string>; labs: Record<string, string> },
	have: { stocks: Named[]; cameras: Named[]; labs: Named[] }
) {
	const missing = (kind: 'stocks' | 'cameras' | 'labs', rows: Named[]) =>
		Object.entries(labels[kind]).filter(
			([token, name]) =>
				!rows.some(
					(r) => r.token === token || (!r.token && sameName(r.name, name, r.brand, kind === 'labs' ? null : filmBrand(kind, token)))
				)
		);
	return {
		stocks: missing('stocks', have.stocks).map(([t]) => t),
		cameras: missing('cameras', have.cameras).map(([t]) => t),
		labs: missing('labs', have.labs).map(([t]) => t),
	};
}

/**
 * What's safe to say about the cameras already named in film-labels.json.
 * Anything not listed is left blank to fill in on the Gear page.
 */
const KNOWN_CAMERAS: Record<string, Partial<{ kind: string; mount: string; battery: string; fixedLens: string }>> = {
	minoltax700: { kind: 'slr', mount: 'Minolta SR (MD)', battery: '2 × LR44' },
	ricohxrm: { kind: 'slr', mount: 'Pentax K' },
	canonae1: { kind: 'slr', mount: 'Canon FD', battery: '4LR44 (6 V)' },
	canonae1p: { kind: 'slr', mount: 'Canon FD', battery: '4LR44 (6 V)' },
	canont70: { kind: 'slr', mount: 'Canon FD', battery: '2 × AA' },
	olympusstylusepic: { kind: 'point-and-shoot', fixedLens: '35mm f/2.8', battery: 'CR123A' },
};

export function guessCamera(token: string) {
	return {
		token,
		name: filmLabel('cameras', token),
		brand: filmBrand('cameras', token),
		kind: 'point-and-shoot',
		...KNOWN_CAMERAS[token],
	};
}
