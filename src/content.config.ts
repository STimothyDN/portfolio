import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const exifSchema = z.object({
	camera: z.string().optional(),
	lens: z.string().optional(),
	focalLength: z.string().optional(),
	aperture: z.string().optional(),
	shutterSpeed: z.string().optional(),
	iso: z.number().optional(),
	capturedAt: z.coerce.date().optional(),
});

const photoLocationSchema = z
	.object({
		name: z.string().optional(),
		latitude: z.number().min(-90).max(90).optional(),
		longitude: z.number().min(-180).max(180).optional(),
		source: z.enum(['exif', 'manual']).optional(),
	})
	.refine((location) => location.name || (location.latitude !== undefined && location.longitude !== undefined), {
		message: 'Photo locations need either a name or latitude and longitude.',
	});

const photoSchema = z.object({
	filename: z.string(),
	caption: z.string().default(''),
	width: z.number().optional(),
	height: z.number().optional(),
	exif: exifSchema.optional(),
	location: photoLocationSchema.optional(),
});

export const collections = {
	work: defineCollection({
		loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
		// `img` is resolved relative to the entry (src/assets/work/…) so Astro can
		// emit responsive, re-encoded variants instead of shipping the raw capture.
		schema: ({ image }) =>
			z.object({
				title: z.string(),
				// Name for tight spots (the work page's stack map); defaults to the title.
				short: z.string().optional(),
				description: z.string(),
				publishDate: z.coerce.date(),
				link: z.string(),
				tags: z.array(z.string()),
				img: image(),
				img_alt: z.string().optional(),
			}),
	}),
	blog: defineCollection({
		loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
		schema: z.object({
			title: z.string(),
			description: z.string(),
			publishDate: z.coerce.date(),
			tags: z.array(z.string()),
			draft: z.boolean().optional().default(false),
		}),
	}),
	photography: defineCollection({
		loader: glob({ pattern: '**/*.json', base: './src/content/photography' }),
		schema: z
			.object({
				title: z.string(),
				date: z.coerce.date(),
				location: z.string().optional(),
				description: z.string().optional(),
				coverPhoto: z.string().optional(),
				photos: z.array(photoSchema).min(1),
			})
			.refine((shoot) => !shoot.coverPhoto || shoot.photos.some((photo) => photo.filename === shoot.coverPhoto), {
				message: 'coverPhoto must match one of the filenames in photos.',
				path: ['coverPhoto'],
			}),
	}),
	// The film desk isn't content here any more: Film Labs owns it, and
	// src/utils/film.ts reads it from the Film Labs API when the site builds.
};
