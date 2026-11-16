export interface BunnyImageOptions {
	width?: number;
	quality?: number;
	format?: 'webp' | 'jpg' | 'png' | 'avif';
	sharpen?: boolean;
}

const CDN_BASE = import.meta.env.PUBLIC_BUNNY_CDN_URL;

/**
 * Signed access to the pull zone, from the film desk (folder → query string). Empty while the
 * zone serves files unsigned. Set at build by getFilmDesk; in the browser, CdnAccess.astro
 * leaves it on window for the islands.
 */
type Access = Record<string, string>;
let access: Access = (globalThis as { __CDN_ACCESS?: Access }).__CDN_ACCESS ?? {};
export const setCdnAccess = (a: Access | undefined) => void (access = a ?? {});
export const cdnAccess = () => access;

/** A path as the CDN sees it, `..` worked out (a desk roll's edit can live in another folder). */
const normal = (path: string) =>
	path.split('/').reduce<string[]>((out, part) => (part === '..' ? out.slice(0, -1) : part && part !== '.' ? [...out, part] : out), []).join('/');

function signed(rawPath: string, url: string): string {
	const path = normal(rawPath);
	let best = '';
	for (const f of Object.keys(access)) if (path.startsWith(f) && f.length > best.length) best = f;
	return best ? `${url}${url.includes('?') ? '&' : '?'}${access[best]}` : url;
}

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
	return signed(path, `${CDN_BASE}/${encoded}${qs ? `?${qs}` : ''}`);
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
