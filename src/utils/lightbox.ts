import type { CollectionEntry } from 'astro:content';

import { bunnyImageUrl } from './bunny';

/** Shape PhotoLightbox.vue expects for each photo. */
export function toLightboxPhotos(
	shootId: string,
	photos: CollectionEntry<'photography'>['data']['photos']
) {
	return photos.map((photo) => ({
		filename: photo.filename,
		caption: photo.caption,
		fullUrl: bunnyImageUrl(shootId, photo.filename, { width: 2000, format: 'webp', quality: 90 }),
		thumbUrl: bunnyImageUrl(shootId, photo.filename, { width: 400, format: 'webp', quality: 75 }),
		width: photo.width,
		height: photo.height,
		exif: photo.exif
			? { ...photo.exif, capturedAt: photo.exif.capturedAt?.toISOString() }
			: undefined,
		location: photo.location,
	}));
}
