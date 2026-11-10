/**
 * What the owner's logbook shares with the public film desk, read when the
 * film page is built: desk roll id → scan filename → the frame's public
 * details (alignment.ts decides which frame each scan is; each roll's
 * sharing settings decide what shows).
 *
 * Visitors never reach the database: this runs at build time (and on request
 * in `npm run dev`, against the local file). A plain local `npm run build`
 * skips it so it never touches production; FILM_LAB_BUILD_DATA=1 opts in.
 * On Vercel it reads production. Any failure builds the desk without it.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { alignScans, publicExposure, type PublicExposure } from '../alignment';
import { labConfig, type LabConfig } from './config';
import { getDb } from './db/client';
import { filmStock, frame, labSetting, lens, roll, scanMark, user } from './db/schema';
import { rollViews } from './inventory';

export type PublishedExposures = Map<string, Map<string, PublicExposure>>;

/** Reads the logbook at build time with a timeout; any failure gives `empty`. */
async function guarded<T>(what: string, empty: T, fn: (config: LabConfig) => Promise<T>): Promise<T> {
	if (import.meta.env.PROD && !process.env.VERCEL && process.env.FILM_LAB_BUILD_DATA !== '1') return empty;
	const config = labConfig();
	if (!config.ok) return empty;
	try {
		return await Promise.race([
			fn(config.config),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 8 s')), 8000)),
		]);
	} catch (e) {
		console.warn(`[film lab] Couldn't read ${what} (${(e as Error).message}); building the film desk without it.`);
		return empty;
	}
}

export const publishedExposures = (desk: { id: string; files: string[] }[]): Promise<PublishedExposures> =>
	guarded('what the logbook shares', new Map(), (config) => read(config, desk));

/** Desk roll id → scan filename → the owner's grease-pencil mark (1–5, -1 a reject). */
export type PublishedMarks = Map<string, Map<string, number>>;

/** The owner's marks from the lab's contact sheets: they set each print's place in the desk's pile. */
export const publishedMarks = (): Promise<PublishedMarks> =>
	guarded('the contact-sheet marks', new Map(), async (config) => {
		const d = await getDb(config);
		const [owner] = await d.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).limit(1);
		if (!owner) return new Map();
		const rows = await d.select({ roll: scanMark.publicRollId, file: scanMark.filename, mark: scanMark.mark }).from(scanMark).where(eq(scanMark.userId, owner.id));
		const out: PublishedMarks = new Map();
		for (const r of rows) {
			const m = out.get(r.roll) ?? new Map<string, number>();
			m.set(r.file, r.mark);
			out.set(r.roll, m);
		}
		return out;
	});

/** "In the Minolta X-700: Kodak Portra 400, 22 of 36", for each loaded camera. */
export interface LoadedNow {
	camera: string;
	stock: string;
	frames: number;
	exposures: number;
}

/** What's in the owner's cameras, if they chose to show it on the desk. */
export const publishedLoaded = (): Promise<LoadedNow[]> =>
	guarded('what’s loaded', [], async (config) => {
		const d = await getDb(config);
		const [owner] = await d.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).limit(1);
		if (!owner) return [];
		const [setting] = await d.select({ shareLoaded: labSetting.shareLoaded }).from(labSetting).where(eq(labSetting.userId, owner.id));
		if (!setting?.shareLoaded) return [];
		return (await rollViews(d, owner.id))
			.filter((r) => r.status === 'camera' && r.camera)
			.sort((a, b) => b.statusOn.localeCompare(a.statusOn))
			.map((r) => ({ camera: r.camera!.name, stock: r.stock.name, frames: r.frameCount, exposures: r.exposures }));
	});

async function read(config: LabConfig, desk: { id: string; files: string[] }[]): Promise<PublishedExposures> {
	const d = await getDb(config);
	const out: PublishedExposures = new Map();
	// Only the owner's rolls reach the owner's portfolio.
	const [owner] = await d.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).limit(1);
	if (!owner) return out;

	const rolls = (
		await d
			.select({
				id: roll.id,
				publicRollId: roll.publicRollId,
				shareExposure: roll.shareExposure,
				sharePlace: roll.sharePlace,
				shareNotes: roll.shareNotes,
				firstScanFrame: roll.firstScanFrame,
				shotAtIso: roll.shotAtIso,
				boxIso: filmStock.iso,
			})
			.from(roll)
			.innerJoin(filmStock, eq(filmStock.id, roll.stockId))
			.where(and(eq(roll.userId, owner.id), isNotNull(roll.publicRollId)))
	).filter((r) => r.shareExposure || r.shareNotes || r.sharePlace?.trim());
	if (!rolls.length) return out;

	const frames = await d
		.select({
			rollId: frame.rollId,
			number: frame.number,
			aperture: frame.aperture,
			shutter: frame.shutter,
			focalLength: frame.focalLength,
			note: frame.note,
			lensId: frame.lensId,
			scanFilename: frame.scanFilename,
		})
		.from(frame)
		.where(and(eq(frame.userId, owner.id), inArray(frame.rollId, rolls.map((r) => r.id))));
	const lenses = new Map(
		(await d.select({ id: lens.id, name: lens.name }).from(lens).where(eq(lens.userId, owner.id))).map((l) => [l.id, l.name])
	);
	const files = new Map(desk.map((r) => [r.id, r.files]));

	for (const r of rolls) {
		const scans = files.get(r.publicRollId!);
		if (!scans) continue;
		const share = {
			shareExposure: r.shareExposure,
			sharePlace: r.sharePlace,
			shareNotes: r.shareNotes,
			ratedIso: r.shotAtIso ?? r.boxIso,
		};
		const aligned = alignScans(scans, frames.filter((f) => f.rollId === r.id), r.firstScanFrame);
		const map = new Map<string, PublicExposure>();
		for (const file of scans) {
			const f = aligned.get(file);
			// Scans with no logged frame still get the roll's place, if it shares one.
			const e = f
				? publicExposure(f, f.lensId ? (lenses.get(f.lensId) ?? null) : null, share)
				: publicExposure({ aperture: null, shutter: null, focalLength: null, note: null }, null, { ...share, shareExposure: false });
			if (e) map.set(file, e);
		}
		if (map.size) out.set(r.publicRollId!, map);
	}
	return out;
}
