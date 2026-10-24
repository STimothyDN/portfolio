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

const mapCache = new Map<string, string>();
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

/** Inward displacement map for a w×h rounded rect, as a PNG data URL (R = x, G = y; 128 = none). */
function displacementMap(w: number, h: number, radius: number, bezel: number) {
	const key = `${w}x${h}:${radius}:${bezel.toFixed(2)}`;
	const cached = mapCache.get(key);
	if (cached) return cached;

	if (!scratchCanvas) {
		scratchCanvas = document.createElement('canvas');
		scratchCtx = scratchCanvas.getContext('2d');
	}
	const canvas = scratchCanvas;
	const ctx = scratchCtx!;
	canvas.width = w;
	canvas.height = h;
	const image = ctx.createImageData(w, h);
	const data = image.data;
	// Pre-fill every pixel to neutral displacement (R=128, G=128, B=128, A=255).
	new Uint32Array(data.buffer).fill(0xff808080);

	const r = Math.min(radius, w / 2, h / 2);
	const hx = w / 2 - r;
	const hy = h / 2 - r;
	const innerBezel = r - bezel;
	for (let y = 0; y < h; y++) {
		const py = y + 0.5 - h / 2;
		const qy = Math.abs(py) - hy;
		const sy = py < 0 ? -1 : 1;
		const rowOffset = y * w;
		for (let x = 0; x < w; x++) {
			const px = x + 0.5 - w / 2;
			const qx = Math.abs(px) - hx;
			// Fast-skip the flat middle where sdf <= -bezel (t === 0, strength === 0).
			if (qx <= -bezel && qy <= -bezel) continue;

			const sx = px < 0 ? -1 : 1;
			let sdf: number;
			let nx = 0;
			let ny = 0;
			if (qx > 0 && qy > 0) {
				const len = Math.hypot(qx, qy);
				sdf = len - r;
				if (sdf <= -bezel) continue;
				const inv = len > 0 ? 1 / len : 0;
				nx = qx * inv * sx;
				ny = qy * inv * sy;
			} else if (qx > qy) {
				if (qx <= innerBezel) continue;
				sdf = qx - r;
				nx = sx;
			} else {
				if (qy <= innerBezel) continue;
				sdf = qy - r;
				ny = sy;
			}

			// Bevel: nothing in the flat middle, steepening toward the rim.
			const t = Math.min(1, Math.max(0, 1 + sdf / bezel));
			const strength = t * t * 127;
			const i = (rowOffset + x) * 4;
			data[i] = 128 - nx * strength;
			data[i + 1] = 128 - ny * strength;
		}
	}
	ctx.putImageData(image, 0, 0);
	const url = canvas.toDataURL();
	if (mapCache.size > 24) mapCache.clear();
	mapCache.set(key, url);
	return url;
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
let initializedForSwap = false;

function init() {
	teardown();
	initializedForSwap = true;
	if (!supported() || document.body.dataset.sky !== 'observatory') return;
	const targets = [...document.querySelectorAll<HTMLElement>('[data-glass]')];
	if (!targets.length) return;
	controller = new AbortController();
	document.documentElement.classList.add('liquid-glass');

	svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true' }) as SVGSVGElement;
	svg.style.position = 'absolute';
	document.body.append(svg);

	const targetIndex = new Map(targets.map((t, i) => [t, i]));
	const builtSignature = new WeakMap<HTMLElement, string>();

	const buildBatch = (batch: Iterable<HTMLElement>) => {
		const measurements: {
			target: HTMLElement;
			index: number;
			w: number;
			h: number;
			radius: number;
			bezel: number;
			scale: number;
			blur: number;
			sig: string;
		}[] = [];

		// Read phase: measure all targets before touching the DOM.
		for (const target of batch) {
			const w = Math.round(target.offsetWidth);
			const h = Math.round(target.offsetHeight);
			if (!w || !h) continue;
			const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
			const bezel = Number(target.dataset.glassBezel) || Math.min(18, h * 0.42);
			const scale = Number(target.dataset.glassScale) || 30;
			const blur = Number(target.dataset.glassBlur ?? 4);
			const sig = `${w}x${h}:${radius}:${bezel}:${scale}:${blur}`;
			if (builtSignature.get(target) === sig) continue;
			builtSignature.set(target, sig);
			measurements.push({
				target,
				index: targetIndex.get(target) ?? 0,
				w,
				h,
				radius,
				bezel,
				scale,
				blur,
				sig,
			});
		}

		// Write phase: build and attach SVG filters.
		for (const { target, index, w, h, radius, bezel, scale, blur } of measurements) {
			const id = `liquid-glass-${index}`;
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
		}
	};

	let frame = 0;
	const pending = new Set<HTMLElement>();
	const observer = new ResizeObserver((entries) => {
		entries.forEach((entry) => pending.add(entry.target as HTMLElement));
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			buildBatch(pending);
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

// Refract from the first paint (and on every swap) rather than after window.load.
init();
document.addEventListener('astro:after-swap', init);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) init();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	teardown();
});

// A module, not a global script: its top-level names stay its own.
export {};
