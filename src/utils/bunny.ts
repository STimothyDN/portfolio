export interface BunnyImageOptions {
	width?: number;
	quality?: number;
	format?: 'webp' | 'jpg' | 'png' | 'avif';
	sharpen?: boolean;
}

const CDN_BASE = import.meta.env.PUBLIC_BUNNY_CDN_URL;

/** URL for any file in the pull zone, by its storage path (e.g. `film/<roll>/<scan>`). */
export function bunnyUrl(path: string, opts: BunnyImageOptions = {}): string {
	const params = new URLSearchParams();
	if (opts.width) params.set('width', String(opts.width));
	if (opts.format) params.set('format', opts.format);
	if (opts.quality) params.set('quality', String(opts.quality));
	if (opts.sharpen) params.set('sharpen', 'true');
	const qs = params.toString();
	// Lab scan names can contain spaces; encode each segment, keep the slashes.
	const encoded = path.split('/').map(encodeURIComponent).join('/');
	return `${CDN_BASE}/${encoded}${qs ? `?${qs}` : ''}`;
}

export function bunnyImageUrl(shootSlug: string, filename: string, opts: BunnyImageOptions = {}): string {
	return bunnyUrl(`photography/${shootSlug}/${filename}`, opts);
}

export function bunnySrcSet(
	shootSlug: string,
	filename: string,
	widths: number[],
	opts: Omit<BunnyImageOptions, 'width'> = {}
): string {
	return widths.map((w) => `${bunnyImageUrl(shootSlug, filename, { ...opts, width: w })} ${w}w`).join(', ');
}
