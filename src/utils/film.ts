import { type CollectionEntry, getCollection } from 'astro:content';

import labels from '../data/film-labels.json';
import type { FilmPhotoData, FilmRollData } from '../components/film/types';

export type FilmRoll = CollectionEntry<'film'>;
type LabelKind = 'cameras' | 'stocks' | 'labs';

/**
 * Fallback display name for a folder token with no entry in film-labels.json:
 * splits hyphens, camelCase and letter/digit runs, then title-cases
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
const MONOCHROME = /\b(hp5|fp4|delta|pan ?f|tri-?x|t-?max|kentmere|fomapan|acros|ortho|retro \d|xp2|double-x)\b/i;
export const isMonochrome = (stockLabel: string) => MONOCHROME.test(stockLabel);

export function filmLabel(kind: LabelKind, key: string): string {
	return (labels[kind] as Record<string, string>)[key] ?? humanizeToken(key);
}

// A brand is the first word of the display name — with Fuji's product lines
// counted as Fujifilm, Lomo as Lomography, and a few two-word brands — unless
// film-labels.json names it outright (for stocks shown without their brand,
// like Mr. Negative's or Lomography's).
const BRAND_ALIASES: Record<string, string> = {
	fuji: 'Fujifilm',
	fujicolor: 'Fujifilm',
	fujichrome: 'Fujifilm',
	lomo: 'Lomography',
};
const MULTIWORD_BRANDS = ['Mr. Negative'];

export function filmBrand(kind: 'cameras' | 'stocks', key: string): string {
	const named = (labels.brands as Record<string, string> | undefined)?.[key];
	if (named) return named;
	const label = filmLabel(kind, key).trim();
	const multi = MULTIWORD_BRANDS.find((b) => label.toLowerCase().startsWith(b.toLowerCase()));
	if (multi) return multi;
	const first = label.split(/\s+/)[0];
	return BRAND_ALIASES[first.toLowerCase()] ?? first;
}

/** Every roll the site should show, newest development first. Demo rolls are dev-only. */
export async function getFilmRolls(): Promise<FilmRoll[]> {
	const rolls = await getCollection('film', (roll) => !(import.meta.env.PROD && roll.data.demo));
	return rolls.sort((a, b) => b.data.developed.valueOf() - a.data.developed.valueOf());
}

export function rollFolder(roll: FilmRoll): string {
	return roll.data.cdnFolder ?? `film/${roll.id}`;
}

const PREVIEW_FRAMES = 3;

/** Compact island props for the film desk: rolls plus every frame on them. */
export function toFilmDeskData(rolls: FilmRoll[]): { rolls: FilmRollData[]; photos: FilmPhotoData[] } {
	const rollData = rolls.map((roll): FilmRollData => {
		const { data } = roll;
		// Strip previews: the roll's favorite frames in frame order. Among equally
		// rated frames, take them spread across the roll — the first few frames
		// on a roll are often throwaways.
		const ranked = data.photos
			.map((photo, i) => ({ photo, i }))
			.sort((a, b) => b.photo.priority - a.photo.priority || a.i - b.i);
		const cutoff = ranked[Math.min(PREVIEW_FRAMES, ranked.length) - 1].photo.priority;
		const sure = ranked.filter((r) => r.photo.priority > cutoff);
		const tied = ranked.filter((r) => r.photo.priority === cutoff).sort((a, b) => a.i - b.i);
		const need = Math.min(PREVIEW_FRAMES, ranked.length) - sure.length;
		const spread = Array.from({ length: need }, (_, k) => tied[Math.floor(((k + 0.5) * tied.length) / need)]);
		const previews = [...sure, ...spread].sort((a, b) => a.i - b.i).map(({ photo }) => photo.filename);
		return {
			id: roll.id,
			title: data.title,
			developed: data.developed.toISOString().slice(0, 10),
			year: String(data.developed.getUTCFullYear()),
			camera: data.camera,
			cameraLabel: filmLabel('cameras', data.camera),
			cameraBrand: filmBrand('cameras', data.camera),
			stock: data.stock,
			stockLabel: filmLabel('stocks', data.stock),
			stockBrand: filmBrand('stocks', data.stock),
			lab: data.lab,
			labLabel: filmLabel('labs', data.lab),
			mono: isMonochrome(filmLabel('stocks', data.stock)),
			description: data.description,
			folder: rollFolder(roll),
			count: data.photos.length,
			previews,
		};
	});

	const photos = rolls.flatMap((roll, r) =>
		roll.data.photos.map(
			(photo, i): FilmPhotoData => ({
				r,
				f: photo.filename,
				w: photo.width,
				h: photo.height,
				p: photo.priority,
				n: i + 1,
				...(photo.caption ? { c: photo.caption } : {}),
			})
		)
	);

	return { rolls: rollData, photos };
}
