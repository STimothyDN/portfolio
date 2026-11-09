/**
 * The Frames page: every frame you've logged, each with the scan it lines up
 * with (alignment.ts), plus what the desk's scan tone says about your
 * cameras, film and labs (insight.ts).
 */
import { bunnyUrl } from '../../../utils/bunny';
import { filmLabel, getFilmRolls, rollFolder } from '../../../utils/film';
import { median, shutterSeconds } from '../almanac';
import { alignScans } from '../alignment';
import { deskFindings, frameFindings, isThin, toneGroups, type DeskScan, type Finding, type ReviewFrame, type Tone, type ToneGroup } from '../insight';
import { ev100Of } from '../light';
import type { LabDb } from './db/client';
import { listFrames, listLenses, rollViews } from './inventory';

export interface FrameRow {
	id: string;
	rollId: string;
	code: string;
	title: string | null;
	number: number;
	shotAt: number;
	tzOffset: number;
	aperture: number | null;
	shutter: string | null;
	flash: boolean;
	focalLength: number | null;
	lens: string | null;
	note: string | null;
	lat: number | null;
	lng: number | null;
	stock: string;
	stockId: string;
	/** The speed the roll was rated at. */
	iso: number | null;
	camera: string | null;
	cameraId: string | null;
	/** The light it was exposed for, EV at ISO 100 (null with flash or unknown settings). */
	ev: number | null;
	scan: { thumb: string; full: string; n: number; tone: Tone | null } | null;
	thin: boolean;
}

export interface ReviewPoint {
	ev: number;
	black: number;
	thin: boolean;
	camera: string | null;
	label: string;
}

export interface FramesPage {
	rows: FrameRow[];
	review: { points: ReviewPoint[]; findings: Finding[]; withScans: number };
	desk: { cameras: ToneGroup[]; stocks: ToneGroup[]; labs: ToneGroup[]; findings: Finding[]; scans: number };
}

export async function framesPage(d: LabDb, userId: string): Promise<FramesPage> {
	const [rolls, lenses, desk] = await Promise.all([rollViews(d, userId), listLenses(d, userId), getFilmRolls()]);
	const frames = rolls.length ? await listFrames(d, userId, rolls.map((r) => r.id)) : [];
	const rollById = new Map(rolls.map((r) => [r.id, r]));
	const lensName = new Map(lenses.map((l) => [l.id, l.name]));
	const deskById = new Map(desk.map((r) => [r.id, r]));

	// Which scan each frame is, roll by roll.
	const scanOf = new Map<string, { file: string; path: string; n: number; tone: Tone | null; rollBlack: number }>();
	for (const r of rolls) {
		const dr = r.publicRollId ? deskById.get(r.publicRollId) : undefined;
		if (!dr) continue;
		const own = frames.filter((f) => f.rollId === r.id);
		if (!own.length) continue;
		const photos = dr.data.photos;
		const blacks = photos.filter((p) => p.tone).map((p) => p.tone![0] * 100);
		const rollBlack = (median(blacks) ?? 0) / 100;
		const aligned = alignScans(
			photos.map((p) => p.filename),
			own,
			r.firstScanFrame
		);
		photos.forEach((p, i) => {
			const f = aligned.get(p.filename);
			if (f) scanOf.set(f.id, { file: p.filename, path: `${rollFolder(dr)}/${p.filename}`, n: i + 1, tone: (p.tone as Tone | undefined) ?? null, rollBlack });
		});
	}

	const rows: FrameRow[] = [];
	const review: ReviewFrame[] = [];
	for (const f of frames) {
		const r = rollById.get(f.rollId);
		if (!r) continue;
		const iso = r.shotAtIso ?? r.stock.iso;
		const t = shutterSeconds(f.shutter);
		const ev = !f.flash && f.aperture && t && iso ? Math.round(ev100Of(f.aperture, t, iso) * 10) / 10 : null;
		const s = scanOf.get(f.id);
		const lens = f.lensId ? (lensName.get(f.lensId) ?? null) : null;
		const thin = !!s?.tone && isThin({ tone: s.tone, rollBlack: s.rollBlack });
		rows.push({
			id: f.id,
			rollId: f.rollId,
			code: r.code,
			title: r.title,
			number: f.number,
			shotAt: f.shotAt,
			tzOffset: f.tzOffset,
			aperture: f.aperture,
			shutter: f.shutter,
			flash: f.flash,
			focalLength: f.focalLength,
			lens,
			note: f.note,
			lat: f.lat,
			lng: f.lng,
			stock: r.stock.name,
			stockId: r.stock.id,
			iso,
			camera: r.camera?.name ?? null,
			cameraId: r.camera?.id ?? null,
			ev,
			scan: s
				? { thumb: bunnyUrl(s.path, { width: 320, format: 'webp', quality: 65 }), full: bunnyUrl(s.path, { width: 2000, quality: 85 }), n: s.n, tone: s.tone }
				: null,
			thin,
		});
		if (s?.tone) review.push({ id: f.id, code: r.code, number: f.number, camera: r.camera?.name ?? null, lens, ev, tone: s.tone, rollBlack: s.rollBlack });
	}
	rows.sort((a, b) => b.shotAt - a.shotAt || a.code.localeCompare(b.code) || b.number - a.number);

	// The desk as a whole: every scan's tone, by camera, film and lab.
	const deskScans: DeskScan[] = desk.flatMap((r) =>
		r.data.photos
			.filter((p) => p.tone)
			.map((p) => ({
				roll: r.id,
				developed: r.data.developed.toISOString().slice(0, 10),
				camera: r.data.camera,
				stock: r.data.stock,
				lab: r.data.lab,
				tone: p.tone as Tone,
			}))
	);
	const cameras = toneGroups(deskScans, 'camera', (k) => filmLabel('cameras', k));
	const stocks = toneGroups(deskScans, 'stock', (k) => filmLabel('stocks', k));
	const labs = toneGroups(deskScans, 'lab', (k) => filmLabel('labs', k));

	return {
		rows,
		review: {
			points: review
				.filter((f) => f.ev != null)
				.map((f) => ({ ev: f.ev!, black: f.tone[0], thin: isThin(f), camera: f.camera, label: `${f.code} · frame ${f.number}` })),
			findings: frameFindings(review),
			withScans: review.length,
		},
		desk: {
			cameras,
			stocks,
			labs,
			findings: deskFindings(cameras, stocks, labs, { camera: (k) => filmLabel('cameras', k), lab: (k) => filmLabel('labs', k) }),
			scans: deskScans.length,
		},
	};
}
