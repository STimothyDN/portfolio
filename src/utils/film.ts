import { frameExposure, negativeProfileKey } from '../components/film/negative';
import type { FilmPhotoData, FilmRollData } from '../components/film/types';
import type { PublicExposure } from '../lib/lab/alignment';
import type { PublishedExposures } from '../lib/lab/server/published';

/*
 * The film desk comes from Film Labs, which owns it: every roll and scan, the
 * display names of cameras, stocks and labs, and what the logbook shares. One
 * request to GET /v1/public/desk (FILM_LAB_API_URL, default
 * https://lab.timo3.dev/api) per build; Film Labs rebuilds the site when the
 * desk changes. In `npm run dev` it's asked again every few seconds, so a
 * local Film Labs (FILM_LAB_API_URL=http://localhost:4321/api) shows edits live.
 */

/** A scan on a roll. `priority` sets how close to the top of the pile a print lands (1–5); `tone` is the scan's measured black point, key and white point. */
export interface FilmPhoto {
	filename: string;
	width?: number;
	height?: number;
	priority: number;
	caption?: string;
	tone?: [number, number, number];
}

/** One roll on the desk. camera/stock/lab are tokens; their names come with the desk (`filmLabel`). */
export interface FilmRoll {
	id: string;
	data: {
		title: string;
		developed: Date;
		camera: string;
		stock: string;
		lab: string;
		description?: string;
		/** CDN folder holding the scans; defaults to `film/<roll id>`. */
		cdnFolder?: string;
		photos: FilmPhoto[];
	};
}

type LabelKind = 'cameras' | 'stocks' | 'labs';
export type FilmLabels = Record<LabelKind | 'brands', Record<string, string>>;

/** "In the Minolta X-700: Kodak Portra 400, 22 of 36", for each loaded camera the owner shows. */
export interface LoadedNow {
	camera: string;
	stock: string;
	frames: number;
	exposures: number;
}

interface PublicDesk {
	cdnBase: string;
	labels: FilmLabels;
	rolls: (Omit<FilmRoll['data'], 'developed'> & { id: string; developed: string })[];
	exposures: Record<string, Record<string, PublicExposure>>;
	marks: Record<string, Record<string, number>>;
	loaded: LoadedNow[];
}

export interface FilmDesk {
	/** False when Film Labs couldn't be reached: everything below is empty. */
	ok: boolean;
	rolls: FilmRoll[];
	labels: FilmLabels;
	exposures: PublicDesk['exposures'];
	marks: PublicDesk['marks'];
	loaded: LoadedNow[];
}

const API = (
	(import.meta.env.FILM_LAB_API_URL as string | undefined) ??
	(typeof process !== 'undefined' ? process.env.FILM_LAB_API_URL : undefined) ??
	'https://lab.timo3.dev/api'
).replace(/\/$/, '');

const EMPTY: FilmDesk = { ok: false, rolls: [], labels: { cameras: {}, stocks: {}, labs: {}, brands: {} }, exposures: {}, marks: {}, loaded: [] };
// Once per build; on the server (the old lab's pages) every minute; in dev every few seconds.
const FRESH_FOR_MS = import.meta.env.DEV ? 3_000 : 60_000;
let cached: { at: number; desk: Promise<FilmDesk> } | undefined;
/** The last desk that loaded, for when Film Labs doesn't answer. */
let lastGood: FilmDesk | undefined;
let labels: FilmLabels = EMPTY.labels;

async function fetchDesk(): Promise<FilmDesk> {
	try {
		const res = await fetch(`${API}/v1/public/desk`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const raw = (await res.json()) as PublicDesk;
		const desk: FilmDesk = {
			ok: true,
			rolls: raw.rolls.map(({ id, developed, ...data }) => ({ id, data: { ...data, developed: new Date(`${developed.slice(0, 10)}T00:00:00Z`) } })),
			labels: { cameras: {}, stocks: {}, labs: {}, brands: {}, ...raw.labels },
			exposures: raw.exposures ?? {},
			marks: raw.marks ?? {},
			loaded: raw.loaded ?? [],
		};
		lastGood = desk;
		labels = desk.labels;
		return desk;
	} catch (e) {
		console.warn(`[film desk] Couldn't read the film desk from ${API} (${(e as Error).message}).`);
		return lastGood ?? EMPTY;
	}
}

/** The film desk from Film Labs. Never throws: `ok` says whether it loaded (the film page refuses to build without it). */
export function getFilmDesk(): Promise<FilmDesk> {
	if (!cached || Date.now() - cached.at > FRESH_FOR_MS) cached = { at: Date.now(), desk: fetchDesk() };
	return cached.desk;
}

/** Every roll on the desk, newest development first. */
export async function getFilmRolls(): Promise<FilmRoll[]> {
	return (await getFilmDesk()).rolls;
}

/** The desk's display names for camera, stock and lab tokens. */
export async function getFilmLabels(): Promise<FilmLabels> {
	return (await getFilmDesk()).labels;
}

export function rollFolder(roll: FilmRoll): string {
	return roll.data.cdnFolder ?? `film/${roll.id}`;
}

/**
 * Fallback display name for a token with no name on the desk: splits hyphens,
 * camelCase and letter/digit runs, then title-cases
 * ("portra400" → "Portra 400", "downtown-durham" → "Downtown Durham").
 */
export function humanizeToken(token: string): string {
	return token
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([a-zA-Z])(\d)/g, '$1 $2')
		.replace(/(\d)([a-zA-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Black-and-white stocks, by display name (their negatives carry no orange mask). */
const MONOCHROME = /\b(hp5|fp4|delta|pan ?f|tri-?x|t-?max|kentmere|fomapan|acros|ortho|retro \d|xp2|double-x|lady ?grey)\b/i;
export const isMonochrome = (stockLabel: string) => MONOCHROME.test(stockLabel);

/** A token's display name (from the last desk loaded: call `getFilmRolls` or `getFilmLabels` first). */
export function filmLabel(kind: LabelKind, key: string): string {
	return labels[kind][key] ?? humanizeToken(key);
}

// A brand is the first word of the display name — with Fuji's product lines
// counted as Fujifilm, Lomo as Lomography, and a few two-word brands — unless
// the desk names it outright (for stocks shown without their brand,
// like Mr. Negative's or Lomography's).
const BRAND_ALIASES: Record<string, string> = {
	fuji: 'Fujifilm',
	fujicolor: 'Fujifilm',
	fujichrome: 'Fujifilm',
	lomo: 'Lomography',
};
const MULTIWORD_BRANDS = ['Mr. Negative'];

export function filmBrand(kind: 'cameras' | 'stocks', key: string): string {
	const named = labels.brands[key];
	if (named) return named;
	const label = filmLabel(kind, key).trim();
	const multi = MULTIWORD_BRANDS.find((b) => label.toLowerCase().startsWith(b.toLowerCase()));
	if (multi) return multi;
	const first = label.split(/\s+/)[0];
	return BRAND_ALIASES[first.toLowerCase()] ?? first;
}

const PREVIEW_FRAMES = 3;

/** A scan's exposure in stops, as its negative shows it; scans not yet measured count as normal. */
const exposureOf = (photo: FilmRoll['data']['photos'][number]) => (photo.tone ? frameExposure(photo.tone) : 0);

/** Compact island props for the film desk: rolls plus every frame on them. */
export function toFilmDeskData(
	rolls: FilmRoll[],
	published?: PublishedExposures,
	marks?: Map<string, Map<string, number>>
): { rolls: FilmRollData[]; photos: FilmPhotoData[] } {
	// A mark from the lab's contact sheet overrides the uploaded rating: a reject sinks to the bottom of the pile.
	const priorityOf = (rollId: string, photo: FilmRoll['data']['photos'][number]) => {
		const m = marks?.get(rollId)?.get(photo.filename);
		return m == null ? photo.priority : m < 0 ? 1 : Math.min(5, Math.max(1, m));
	};
	const rollData = rolls.map((roll): FilmRollData => {
		const { data } = roll;
		// Strip previews: the roll's favorite frames in frame order. Among equally
		// rated frames, take them spread across the roll — the first few frames
		// on a roll are often throwaways.
		const ranked = data.photos
			.map((photo, i) => ({ photo, i }))
			.sort((a, b) => priorityOf(roll.id, b.photo) - priorityOf(roll.id, a.photo) || a.i - b.i);
		const cutoff = priorityOf(roll.id, ranked[Math.min(PREVIEW_FRAMES, ranked.length) - 1].photo);
		const sure = ranked.filter((r) => priorityOf(roll.id, r.photo) > cutoff);
		const tied = ranked.filter((r) => priorityOf(roll.id, r.photo) === cutoff).sort((a, b) => a.i - b.i);
		const need = Math.min(PREVIEW_FRAMES, ranked.length) - sure.length;
		const spread = Array.from({ length: need }, (_, k) => tied[Math.floor(((k + 0.5) * tied.length) / need)]);
		const previews = [...sure, ...spread]
			.sort((a, b) => a.i - b.i)
			.map(({ photo }) => ({ file: photo.filename, exposure: exposureOf(photo) }));
		const stockLabel = filmLabel('stocks', data.stock);
		const stockBrand = filmBrand('stocks', data.stock);
		return {
			id: roll.id,
			title: data.title,
			developed: data.developed.toISOString().slice(0, 10),
			year: String(data.developed.getUTCFullYear()),
			camera: data.camera,
			cameraLabel: filmLabel('cameras', data.camera),
			cameraBrand: filmBrand('cameras', data.camera),
			stock: data.stock,
			stockLabel,
			stockBrand,
			lab: data.lab,
			labLabel: filmLabel('labs', data.lab),
			negative: negativeProfileKey(stockLabel, stockBrand, isMonochrome(stockLabel)),
			description: data.description,
			folder: rollFolder(roll),
			count: data.photos.length,
			previews,
		};
	});

	const photos = rolls.flatMap((roll, r) => {
		const shared = published?.get(roll.id);
		return roll.data.photos.map(
			(photo, i): FilmPhotoData => ({
				r,
				f: photo.filename,
				w: photo.width,
				h: photo.height,
				p: priorityOf(roll.id, photo),
				n: i + 1,
				x: exposureOf(photo),
				...(photo.caption ? { c: photo.caption } : {}),
				...(shared?.has(photo.filename) ? { e: shared.get(photo.filename) } : {}),
			})
		);
	});

	return { rolls: rollData, photos };
}
