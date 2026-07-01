export interface BunnyImageOptions {
	width?: number;
	quality?: number;
	format?: 'webp' | 'jpg' | 'png' | 'avif';
	sharpen?: boolean;
}

const CDN_BASE = import.meta.env.PUBLIC_BUNNY_CDN_URL;

export function bunnyImageUrl(shootSlug: string, filename: string, opts: BunnyImageOptions = {}): string {
	const params = new URLSearchParams();
	if (opts.width) params.set('width', String(opts.width));
	if (opts.format) params.set('format', opts.format);
	if (opts.quality) params.set('quality', String(opts.quality));
	if (opts.sharpen) params.set('sharpen', 'true');
	const qs = params.toString();
	return `${CDN_BASE}/photography/${shootSlug}/${filename}${qs ? `?${qs}` : ''}`;
}

export function bunnySrcSet(
	shootSlug: string,
	filename: string,
	widths: number[],
	opts: Omit<BunnyImageOptions, 'width'> = {}
): string {
	return widths.map((w) => `${bunnyImageUrl(shootSlug, filename, { ...opts, width: w })} ${w}w`).join(', ');
}
