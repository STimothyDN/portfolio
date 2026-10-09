import type { CollectionEntry } from 'astro:content';

import { bunnyImageUrl } from './bunny';

type ShootPhoto = CollectionEntry<'photography'>['data']['photos'][number];

/**
 * One photo as embedded in the page for the lightbox. Everything derivable
 * (both CDN URLs) is rebuilt in the browser, so the page only carries what
 * the info rail actually shows.
 */
export interface PackedLightboxPhoto {
	f: string;
	c?: string;
	w?: number;
	h?: number;
	exif?: Omit<NonNullable<ShootPhoto['exif']>, 'capturedAt'> & { capturedAt?: string };
	location?: { name?: string; latitude?: number; longitude?: number };
}

/** slug → that shoot's photos, in grid order. */
export type PackedLightboxSets = Record<string, PackedLightboxPhoto[]>;

/** Element id of the page's embedded lightbox data (see LightboxData.astro). */
export const LIGHTBOX_DATA_ID = 'lightbox-data';

// The info rail prints coordinates to 5 decimals; 6 keeps the map link exact.
const coord = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 1e6) / 1e6);

export function packLightboxPhotos(photos: ShootPhoto[]): PackedLightboxPhoto[] {
	return photos.map((photo) => {
		const packed: PackedLightboxPhoto = { f: photo.filename };
		if (photo.caption) packed.c = photo.caption;
		if (photo.width) packed.w = photo.width;
		if (photo.height) packed.h = photo.height;
		if (photo.exif) packed.exif = { ...photo.exif, capturedAt: photo.exif.capturedAt?.toISOString() };
		if (photo.location) {
			const { name, latitude, longitude } = photo.location;
			packed.location = { name, latitude: coord(latitude), longitude: coord(longitude) };
		}
		return packed;
	});
}

/** Shape PhotoLightbox.vue renders for each photo. */
export function unpackLightboxPhotos(shootSlug: string, photos: PackedLightboxPhoto[]) {
	return photos.map((photo) => ({
		filename: photo.f,
		caption: photo.c ?? '',
		fullUrl: bunnyImageUrl(shootSlug, photo.f, { width: 2000, format: 'webp', quality: 90 }),
		thumbUrl: bunnyImageUrl(shootSlug, photo.f, { width: 400, format: 'webp', quality: 75 }),
		width: photo.w,
		height: photo.h,
		exif: photo.exif,
		location: photo.location,
	}));
}
