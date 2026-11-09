/**
 * The Frames page: every frame you've logged, each with the scan it lines up
 * with (alignment.ts), plus, for the owner, what the film desk's scan tone
 * says about their cameras, film and labs (insight.ts).
 */
import { bunnyUrl } from '../../../utils/bunny';
import { filmLabel, getFilmRolls, rollFolder, type FilmRoll } from '../../../utils/film';
import { median, shutterSeconds } from '../almanac';
import { alignScans } from '../alignment';
import { deskFindings, frameFindings, isThin, toneGroups, type DeskScan, type Finding, type ReviewFrame, type Tone, type ToneGroup } from '../insight';
import { ev100Of } from '../light';
import type { LabDb } from './db/client';
import { allFrames, listLenses, rollViews } from './inventory';

/** One frame on the wire; its roll's details come once per roll, in `rolls`. */
export interface FrameRow {
	id: string;
	rollId: string;
	number: number;
	shotAt: number;
	tzOffset: number;
	aperture: number | null;
	shutter: string | null;
	flash: boolean;
	lens: string | null;
	note: string | null;
	lat: number | null;
	lng: number | null;
	/** The light it was exposed for, EV at ISO 100 (null with flash or unknown settings). */
	ev: number | null;
	scan: { thumb: string; n: number } | null;
	thin: boolean;
}

export interface RollBrief {
	code: string;
	title: string | null;
	stock: string;
	camera: string | null;
}

export interface ReviewPoint {
	ev: number;
	black: number;
	thin: boolean;
	label: string;
}

export interface DeskTone {
	cameras: ToneGroup[];
	stocks: ToneGroup[];
	labs: ToneGroup[];
	findings: Finding[];
	scans: number;
}

export interface FramesPage {
	rows: FrameRow[];
	rolls: Record<string, RollBrief>;
	review: { points: ReviewPoint[]; findings: Finding[]; withScans: number };
	/** The film desk's tone: the owner's only. */
	desk: DeskTone | null;
}

export async function framesPage(d: LabDb, userId: string, owner: boolean): Promise<FramesPage> {
	const [rolls, lenses, frames, desk] = await Promise.all([rollViews(d, userId), listLenses(d, userId), allFrames(d, userId), getFilmRolls()]);
	const rollById = new Map(rolls.map((r) => [r.id, r]));
	const lensName = new Map(lenses.map((l) => [l.id, l.name]));
	const deskById = new Map(desk.map((r) => [r.id, r]));
	const framesByRoll = new Map<string, typeof frames>();
	for (const f of frames) {
		const list = framesByRoll.get(f.rollId);
		if (list) list.push(f);
		else framesByRoll.set(f.rollId, [f]);
	}

	// Which scan each frame is, roll by roll.
	const scanOf = new Map<string, { path: string; n: number; tone: Tone | null; rollBlack: number }>();
	for (const [rollId, own] of framesByRoll) {
		const r = rollById.get(rollId);
		const dr = r?.publicRollId ? deskById.get(r.publicRollId) : undefined;
		if (!r || !dr) continue;
		const photos = dr.data.photos;
		const rollBlack = (median(photos.filter((p) => p.tone).map((p) => p.tone![0] * 100)) ?? 0) / 100;
		const aligned = alignScans(
			photos.map((p) => p.filename),
			own,
			r.firstScanFrame
		);
		const folder = rollFolder(dr);
		photos.forEach((p, i) => {
			const f = aligned.get(p.filename);
			if (f) scanOf.set(f.id, { path: `${folder}/${p.filename}`, n: i + 1, tone: (p.tone as Tone | undefined) ?? null, rollBlack });
		});
	}

	const rows: FrameRow[] = [];
	const review: ReviewFrame[] = [];
	const briefs: Record<string, RollBrief> = {};
	for (const f of frames) {
		const r = rollById.get(f.rollId);
		if (!r) continue;
		briefs[r.id] ??= { code: r.code, title: r.title, stock: r.stock.name, camera: r.camera?.name ?? null };
		const iso = r.shotAtIso ?? r.stock.iso;
		const t = shutterSeconds(f.shutter);
		const ev = !f.flash && f.aperture && t && iso ? Math.round(ev100Of(f.aperture, t, iso) * 10) / 10 : null;
		const s = scanOf.get(f.id);
		const lens = f.lensId ? (lensName.get(f.lensId) ?? null) : null;
		const thin = !!s?.tone && isThin({ tone: s.tone, rollBlack: s.rollBlack });
		rows.push({
			id: f.id,
			rollId: f.rollId,
			number: f.number,
			shotAt: f.shotAt,
			tzOffset: f.tzOffset,
			aperture: f.aperture,
			shutter: f.shutter,
			flash: f.flash,
			lens,
			note: f.note,
			lat: f.lat,
			lng: f.lng,
			ev,
			scan: s ? { thumb: bunnyUrl(s.path, { width: 320, format: 'webp', quality: 65 }), n: s.n } : null,
			thin,
		});
		if (s?.tone) review.push({ id: f.id, code: r.code, number: f.number, camera: r.camera?.name ?? null, lens, ev, tone: s.tone, rollBlack: s.rollBlack });
	}
	rows.sort((a, b) => b.shotAt - a.shotAt || briefs[a.rollId].code.localeCompare(briefs[b.rollId].code) || b.number - a.number);

	return {
		rows,
		rolls: briefs,
		review: {
			points: review.filter((f) => f.ev != null).map((f) => ({ ev: f.ev!, black: f.tone[0], thin: isThin(f), label: `${f.code} · frame ${f.number}` })),
			findings: frameFindings(review),
			withScans: review.length,
		},
		desk: owner ? deskTone(desk) : null,
	};
}

/* The desk only changes when the site is rebuilt (or, in development, when a roll is uploaded): keep the last answer. */
let toneCache: { key: string; value: DeskTone } | null = null;

/** Every desk scan's tone, by camera, film and lab, with what stands out. */
function deskTone(desk: FilmRoll[]): DeskTone {
	const key = desk.map((r) => `${r.id}:${r.data.photos.length}`).join('|');
	if (toneCache?.key === key) return toneCache.value;
	const scans: DeskScan[] = desk.flatMap((r) =>
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
	const cameras = toneGroups(scans, 'camera', (k) => filmLabel('cameras', k));
	const stocks = toneGroups(scans, 'stock', (k) => filmLabel('stocks', k));
	const labs = toneGroups(scans, 'lab', (k) => filmLabel('labs', k));
	const value = {
		cameras,
		stocks,
		labs,
		findings: deskFindings(cameras, stocks, labs, { camera: (k) => filmLabel('cameras', k), lab: (k) => filmLabel('labs', k) }),
		scans: scans.length,
	};
	toneCache = { key, value };
	return value;
}
