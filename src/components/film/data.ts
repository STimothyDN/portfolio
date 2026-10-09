import type { FilmPhotoData } from './types';

/** One scan as shipped to the island: [roll index, filename, width, height, priority, frame no., caption?]. */
type PackedPhoto = [number, string, number, number, number, number, string?];

/**
 * Island props are serialized with a type tag around every value and every
 * quote HTML-escaped, which made 600+ scan records as objects the bulk of the
 * film page. One JSON string of tuples costs about a quarter of that.
 */
export function packFilmPhotos(photos: FilmPhotoData[]): string {
	return JSON.stringify(
		photos.map((p): PackedPhoto => {
			const row: PackedPhoto = [p.r, p.f, p.w ?? 0, p.h ?? 0, p.p, p.n];
			if (p.c) row.push(p.c);
			return row;
		})
	);
}

export function unpackFilmPhotos(json: string): FilmPhotoData[] {
	return (JSON.parse(json) as PackedPhoto[]).map(([r, f, w, h, p, n, c]) => ({
		r,
		f,
		w: w || undefined,
		h: h || undefined,
		p,
		n,
		...(c ? { c } : {}),
	}));
}
