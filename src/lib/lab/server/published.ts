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
import { filmStock, frame, lens, roll, user } from './db/schema';

export type PublishedExposures = Map<string, Map<string, PublicExposure>>;

export async function publishedExposures(desk: { id: string; files: string[] }[]): Promise<PublishedExposures> {
	const empty: PublishedExposures = new Map();
	if (import.meta.env.PROD && !process.env.VERCEL && process.env.FILM_LAB_BUILD_DATA !== '1') return empty;
	const config = labConfig();
	if (!config.ok) return empty;
	try {
		return await Promise.race([
			read(config.config, desk),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 8 s')), 8000)),
		]);
	} catch (e) {
		console.warn(`[film lab] Couldn't read what the logbook shares (${(e as Error).message}); building the film desk without it.`);
		return empty;
	}
}

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
