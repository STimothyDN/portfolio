/**
 * Liquid glass: elements marked [data-glass] refract what's behind them at
 * their rims, like a thick pane with rounded, bevelled edges — the stars
 * bend as they pass under the nav or the dock.
 *
 * How: each element gets an SVG filter used as its backdrop-filter. A
 * displacement map is generated for the element's exact size and corner
 * radius (a rounded-rect signed distance field): zero across the flat
 * middle, rising toward the rim, pointing inward, so the backdrop near the
 * edge is sampled from further in. Red, green and blue are displaced by
 * slightly different amounts for a faint chromatic fringe. Maps are rebuilt
 * when an element resizes.
 *
 * Chromium only (url() in backdrop-filter); elsewhere, and with reduced
 * transparency requested, the elements keep their plain frosted blur. For
 * now only pages in the Observatory design (body[data-sky='observatory'])
 * get it: page scripts stay loaded across client-side navigation, and every
 * page's nav carries [data-glass].
 * `html.liquid-glass` is set while active so components can thin their
 * tint and let the refraction show. Per element: data-glass-blur (px, 4),
 * data-glass-bezel (px, auto), data-glass-scale (displacement, 30).
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const supported = () =>
	'chrome' in window &&
	CSS.supports('backdrop-filter', 'url(#a)') &&
	!matchMedia('(prefers-reduced-transparency: reduce)').matches;

/** Inward displacement map for a w×h rounded rect, as a PNG data URL (R = x, G = y; 128 = none). */
function displacementMap(w: number, h: number, radius: number, bezel: number) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	const image = ctx.createImageData(w, h);
	const data = image.data;
	const r = Math.min(radius, w / 2, h / 2);
	const hx = w / 2 - r;
	const hy = h / 2 - r;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const px = x + 0.5 - w / 2;
			const py = y + 0.5 - h / 2;
			const qx = Math.abs(px) - hx;
			const qy = Math.abs(py) - hy;
			// Signed distance to the rounded rect (negative inside).
			const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
			// Bevel: nothing in the flat middle, steepening toward the rim.
			const t = Math.min(1, Math.max(0, 1 + sdf / bezel));
			const strength = t * t;
			// Outward normal of the nearest edge; displacement points the other way.
			let nx = 0;
			let ny = 0;
			if (qx > 0 && qy > 0) {
				const len = Math.hypot(qx, qy) || 1;
				nx = (qx / len) * Math.sign(px);
				ny = (qy / len) * Math.sign(py);
			} else if (qx > qy) {
				nx = Math.sign(px);
			} else {
				ny = Math.sign(py);
			}
			const i = (y * w + x) * 4;
			data[i] = 128 - nx * strength * 127;
			data[i + 1] = 128 - ny * strength * 127;
			data[i + 2] = 128;
			data[i + 3] = 255;
		}
	}
	ctx.putImageData(image, 0, 0);
	return canvas.toDataURL();
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) {
	const node = document.createElementNS(SVG_NS, name);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

/** One channel's displacement, isolated: R, G or B. */
function channel(filter: SVGFilterElement, scale: number, which: 0 | 1 | 2) {
	const result = `c${which}`;
	// 4×5 colour matrix keeping only this channel (and alpha).
	const keep = [0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((col) => (row === which && col === which ? 1 : 0)));
	const matrix = [...keep, [0, 0, 0, 1, 0]].flat().join(' ');
	filter.append(
		el('feDisplacementMap', {
			in: 'SourceGraphic',
			in2: 'map',
			scale,
			xChannelSelector: 'R',
			yChannelSelector: 'G',
			result: `${result}d`,
		}),
		el('feColorMatrix', {
			in: `${result}d`,
			type: 'matrix',
			values: matrix,
			result,
		})
	);
}

let controller: AbortController | null = null;
let svg: SVGSVGElement | null = null;

function init() {
	teardown();
	if (!supported() || document.body.dataset.sky !== 'observatory') return;
	const targets = [...document.querySelectorAll<HTMLElement>('[data-glass]')];
	if (!targets.length) return;
	controller = new AbortController();
	document.documentElement.classList.add('liquid-glass');

	svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true' }) as SVGSVGElement;
	svg.style.position = 'absolute';
	document.body.append(svg);

	const build = (target: HTMLElement, index: number) => {
		const w = Math.round(target.offsetWidth);
		const h = Math.round(target.offsetHeight);
		if (!w || !h) return;
		const id = `liquid-glass-${index}`;
		const style = getComputedStyle(target);
		const radius = parseFloat(style.borderTopLeftRadius) || 0;
		const bezel = Number(target.dataset.glassBezel) || Math.min(18, h * 0.42);
		const scale = Number(target.dataset.glassScale) || 30;
		const blur = Number(target.dataset.glassBlur ?? 4);

		svg!.querySelector(`#${id}`)?.remove();
		const filter = el('filter', {
			id,
			x: 0,
			y: 0,
			width: w,
			height: h,
			filterUnits: 'userSpaceOnUse',
			primitiveUnits: 'userSpaceOnUse',
			'color-interpolation-filters': 'sRGB',
		}) as SVGFilterElement;
		filter.append(
			el('feImage', {
				href: displacementMap(w, h, radius, bezel),
				x: 0,
				y: 0,
				width: w,
				height: h,
				preserveAspectRatio: 'none',
				result: 'map',
			})
		);
		channel(filter, scale, 0);
		channel(filter, scale * 0.92, 1);
		channel(filter, scale * 0.84, 2);
		filter.append(
			el('feComposite', { in: 'c0', in2: 'c1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg' }),
			el('feComposite', { in: 'rg', in2: 'c2', operator: 'arithmetic', k2: 1, k3: 1 })
		);
		svg!.append(filter);
		const value = `url(#${id}) blur(${blur}px) saturate(1.5)`;
		target.style.backdropFilter = value;
		target.style.setProperty('-webkit-backdrop-filter', value);
	};

	let frame = 0;
	const pending = new Set<HTMLElement>();
	const observer = new ResizeObserver((entries) => {
		entries.forEach((entry) => pending.add(entry.target as HTMLElement));
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			pending.forEach((target) => build(target, targets.indexOf(target)));
			pending.clear();
		});
	});
	targets.forEach((target) => observer.observe(target));
	controller.signal.addEventListener('abort', () => {
		observer.disconnect();
		cancelAnimationFrame(frame);
		targets.forEach((target) => {
			target.style.backdropFilter = '';
			target.style.removeProperty('-webkit-backdrop-filter');
		});
	});
}

function teardown() {
	controller?.abort();
	controller = null;
	svg?.remove();
	svg = null;
	document.documentElement.classList.remove('liquid-glass');
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', teardown);

// A module, not a global script: its top-level names stay its own.
export {};
