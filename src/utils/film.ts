import { type CollectionEntry, getCollection } from 'astro:content';

import labels from '../data/film-labels.json';
import type { FilmPhotoData, FilmRollData } from '../components/film/types';

export type FilmRoll = CollectionEntry<'film'>;
type LabelKind = keyof typeof labels;

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

export function filmLabel(kind: LabelKind, key: string): string {
	return (labels[kind] as Record<string, string>)[key] ?? humanizeToken(key);
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
			stock: data.stock,
			stockLabel: filmLabel('stocks', data.stock),
			lab: data.lab,
			labLabel: filmLabel('labs', data.lab),
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
