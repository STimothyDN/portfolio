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

// One scan from a film roll. Scans carry no EXIF worth showing, so the roll
// (folder) supplies the metadata; `priority` decides how close to the top of
// the film desk's pile a print tends to land (1 = buried, 5 = nearly always on top).
const filmPhotoSchema = z.object({
	filename: z.string(),
	width: z.number().optional(),
	height: z.number().optional(),
	priority: z.number().int().min(1).max(5).default(3),
	caption: z.string().optional(),
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
	// One JSON per roll, written by `npm run upload-film` from the scan folder's
	// name (dateDeveloped_camera_filmStock_lab_summary). camera/stock/lab hold the
	// raw folder tokens; their display names live in src/data/film-labels.json.
	film: defineCollection({
		loader: glob({ pattern: '**/*.json', base: './src/content/film' }),
		schema: z.object({
			title: z.string(),
			developed: z.coerce.date(),
			camera: z.string(),
			stock: z.string(),
			lab: z.string(),
			description: z.string().optional(),
			// CDN folder holding the scans; defaults to `film/<roll id>`.
			cdnFolder: z.string().optional(),
			// Dev-only sample rolls — never included in production builds.
			demo: z.boolean().optional(),
			photos: z.array(filmPhotoSchema).min(1),
		}),
	}),
};
