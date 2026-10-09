/** Facets the film desk can filter on. `roll` is driven by the roll strip. */
export type FacetKey = 'roll' | 'camera' | 'stock' | 'lab' | 'year';

/** One choice in a filter list, with its count under the other active filters. */
export interface FacetOption {
	value: string;
	label: string;
	count: number;
	selected: boolean;
	/** Maker, for camera and film stock options (drives the brand buttons). */
	brand?: string;
}

/** One roll, as serialized from the film page into the FilmDesk island. */
export interface FilmRollData {
	id: string;
	title: string;
	/** Development date, YYYY-MM-DD. */
	developed: string;
	year: string;
	camera: string;
	cameraLabel: string;
	cameraBrand: string;
	stock: string;
	stockLabel: string;
	stockBrand: string;
	lab: string;
	labLabel: string;
	/** Black-and-white stock: its negatives are gray, not orange-masked. */
	mono: boolean;
	description?: string;
	/** CDN folder holding the scans. */
	folder: string;
	count: number;
	/** A few favorite frames (filenames) for the roll strip's mini contact sheet. */
	previews: string[];
}

/**
 * One scan, kept terse because every frame on every roll ships in the island's
 * props: r = roll index, f = filename, w/h = pixel size, p = priority (1–5),
 * n = frame number within the roll, c = optional caption.
 */
export interface FilmPhotoData {
	r: number;
	f: string;
	w?: number;
	h?: number;
	p: number;
	n: number;
	c?: string;
}
