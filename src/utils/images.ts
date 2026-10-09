import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

export interface ResponsiveImage {
	src: string;
	srcset: string;
	width: number;
	height: number;
}

interface ResponsiveOptions {
	widths: number[];
	format: 'avif' | 'webp';
	quality?: number;
	/**
	 * Crop to this aspect ratio (width / height) at build time — the same
	 * framing `object-fit: cover` + `object-position` would produce, so the
	 * browser downloads only the pixels it actually shows.
	 */
	crop?: { aspect: number; position?: string };
}

/**
 * Build-time responsive variants of a local image in one format. The middle
 * width doubles as the plain `src` fallback.
 */
export async function responsive(
	src: ImageMetadata,
	{ widths, format, quality, crop }: ResponsiveOptions
): Promise<ResponsiveImage> {
	const width = widths[Math.floor(widths.length / 2)];
	const img = await getImage({
		src,
		width,
		...(crop ? { height: Math.round(width / crop.aspect), fit: 'cover', position: crop.position ?? 'center' } : {}),
		widths,
		format,
		quality,
	});
	return {
		src: img.src,
		srcset: img.srcSet.attribute,
		width: Number(img.attributes.width),
		height: Number(img.attributes.height),
	};
}

/**
 * Work screenshots render in three places — the index thumb, the index's
 * cursor follower (which copies the thumb's `currentSrc`), and the detail
 * page's featured image — and the view-transition morph between them should
 * land on a file that's already cached. One shared srcset + sizes guarantees
 * all three pick the same candidate for a given viewport. The 45rem slot is
 * the follower's cover-cropped draw width (34rem box × the ~4:3 overscan of a
 * 2:1 screenshot in a 3:2 frame).
 */
export const WORK_IMAGE_SIZES = '(min-width: 50em) 45rem, calc(125vw - 3.75rem)';

export const workImage = (src: ImageMetadata) =>
	responsive(src, { widths: [480, 720, 960, 1280, 1600, 2000], format: 'webp', quality: 80 });
