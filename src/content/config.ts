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

const photoSchema = z.object({
	filename: z.string(),
	caption: z.string().default(''),
	width: z.number().optional(),
	height: z.number().optional(),
	exif: exifSchema.optional(),
});

export const collections = {
	work: defineCollection({
		schema: z.object({
			title: z.string(),
			description: z.string(),
			publishDate: z.coerce.date(),
			link: z.string(),
			tags: z.array(z.string()),
			img: z.string(),
			img_alt: z.string().optional(),
		}),
	}),
	blog: defineCollection({
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
		schema: z.object({
			title: z.string(),
			date: z.coerce.date(),
			location: z.string().optional(),
			description: z.string().optional(),
			coverPhoto: z.string().optional(),
			photos: z.array(photoSchema).min(1),
		}),
	}),
};
