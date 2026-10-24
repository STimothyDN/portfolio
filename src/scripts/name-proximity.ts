/**
 * Variable-font name (the home page hero): letters near the pointer swell —
 * heavier, and at the same time narrower, so each line keeps its length and
 * nothing around it reflows (Bricolage's `wght` up, `wdth` down). Mouse
 * only, at the top of the page (once the name starts docking it rests).
 *
 * The name is split into one inline span per letter (inline, not
 * inline-block, so the heading still reads as one string to assistive tech).
 * The swap glyph and the accent full stop are left whole: they're gradient
 * ink drawn with background-clip.
 *
 * Each letter eases toward its target, frame-rate independently; the loop
 * only runs while something is still moving.
 */
const capable = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 50em)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const RADIUS = 240;
const WGHT: [rest: number, full: number] = [600, 800];
const WDTH: [rest: number, full: number] = [100, 86];
const OPSZ = 40;
const EASE = 14;

type Letter = { el: HTMLElement; x: number; y: number; f: number; style: string };

function splitLetters(root: HTMLElement) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest('.brand-in, .dot, .ch') || !node.textContent?.trim()
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT,
	});
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	const letters: HTMLElement[] = [];
	for (const node of nodes) {
		const fragment = document.createDocumentFragment();
		for (const char of node.textContent!) {
			const span = document.createElement('span');
			span.className = 'ch';
			span.textContent = char;
			fragment.append(span);
			letters.push(span);
		}
		node.replaceWith(fragment);
	}
	return letters;
}

const settings = (f: number) =>
	`'wght' ${Math.round(WGHT[0] + (WGHT[1] - WGHT[0]) * f)}, 'wdth' ${(WDTH[0] + (WDTH[1] - WDTH[0]) * f).toFixed(1)}, 'opsz' ${OPSZ}`;

let controller: AbortController | null = null;

function init() {
	controller?.abort();
	controller = null;
	const title = document.querySelector<HTMLElement>('[data-dock-name] .title');
	if (!title || !capable.matches || reducedMotion.matches) return;
	controller = new AbortController();
	const { signal } = controller;
	const body = document.body;

	const letters: Letter[] = splitLetters(title).map((el) => ({ el, x: 0, y: 0, f: 0, style: '' }));
	const invRadiusSq = 1 / (RADIUS * RADIUS);
	let measured = false;
	let hasActive = false;
	let px = -1e5;
	let py = -1e5;
	let frame = 0;
	let last = 0;

	const measure = () => {
		for (const letter of letters) {
			const r = letter.el.getBoundingClientRect();
			letter.x = r.left + r.width / 2;
			letter.y = r.top + r.height / 2;
		}
		measured = true;
	};

	const tick = (now: number) => {
		frame = 0;
		const dt = Math.min(0.05, (now - last) / 1000 || 1 / 60);
		last = now;
		const atTop = body.scrollTop < 4;
		const step = 1 - Math.exp(-EASE * dt);
		let moving = false;
		let anyActive = false;
		for (const letter of letters) {
			let target = 0;
			if (atTop) {
				const dx = letter.x - px;
				const dy = letter.y - py;
				target = Math.exp(-2.2 * (dx * dx + dy * dy) * invRadiusSq);
			}
			letter.f += (target - letter.f) * step;
			if (Math.abs(target - letter.f) > 0.003) moving = true;
			else letter.f = target;
			if (letter.f > 0.001) anyActive = true;
			const style = settings(letter.f);
			if (style !== letter.style) {
				letter.style = style;
				letter.el.style.fontVariationSettings = style;
			}
		}
		hasActive = anyActive;
		if (moving) frame = requestAnimationFrame(tick);
	};

	const kick = () => {
		if (frame) return;
		last = performance.now();
		frame = requestAnimationFrame(tick);
	};

	window.addEventListener(
		'pointermove',
		(event) => {
			if (event.pointerType !== 'mouse') return;
			const atTop = body.scrollTop < 4;
			if (!atTop && !hasActive) return;
			if (!measured && atTop) measure();
			px = event.clientX;
			py = event.clientY;
			kick();
		},
		{ passive: true, signal }
	);
	// Leaving the window lets the letters settle.
	window.addEventListener(
		'pointerout',
		(event) => {
			if (event.relatedTarget) return;
			px = py = -1e5;
			if (hasActive) kick();
		},
		{ passive: true, signal }
	);
	// Positions go stale when the page moves or resizes; scrolling also relaxes the name.
	const invalidate = () => {
		measured = false;
		if (hasActive) kick();
	};
	document.addEventListener('scroll', invalidate, { capture: true, passive: true, signal });
	window.addEventListener('resize', invalidate, { passive: true, signal });
	signal.addEventListener('abort', () => cancelAnimationFrame(frame));
}

let initializedForSwap = false;

function start() {
	initializedForSwap = true;
	init();
}

start();
document.addEventListener('astro:after-swap', start);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) start();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	controller?.abort();
	controller = null;
});

// A module, not a global script: its top-level names stay its own.
export {};
