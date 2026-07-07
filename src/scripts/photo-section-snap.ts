declare global {
	interface Window {
		__photoSectionSnapController?: AbortController;
		__photoSectionSnapPageLoad?: boolean;
	}
}

const prefersReducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The photography index stacks a full-viewport landing (the globe) above the
// shoot stage, whose single title block starts docked at the bottom of the
// first viewport (the stage is pulled up over the landing by --photo-title-h)
// and pins to the top via `position: sticky`. The soft snap between the two
// sections is native CSS (`scroll-snap-type: y proximity` on the document
// scroller) — it only eases toward a section when the scroll comes to rest
// near it, and never fights an in-progress gesture. This script adds:
//   1. real measurements for the layout's CSS vars (the stylesheet ships
//      approximate no-JS fallbacks),
//   2. the `.is-stuck` toggle that morphs the title from masthead to compact
//      header once it pins, and
//   3. keyboard section-jumps between landing and stage.
// Shoot page: the parent breadcrumb (PhotoParentBar) pins at top:0 and the
// shoot header pins directly beneath it. We publish the bar's height so the
// header's sticky `top` sits flush under it, and toggle the header's compact
// morph once the section has scrolled up to the top (i.e. once the header has
// pinned under the bar). The parent bar and header both stick natively — this
// only drives the measurement var and the `.is-stuck` toggle.
function initNestedShoot(ctx: {
	root: HTMLElement;
	stage: HTMLElement;
	title: HTMLElement;
	parentBar: HTMLElement;
	body: HTMLElement;
	scrollPos: () => number;
	signal: AbortSignal;
}) {
	const { root, stage, title, parentBar, body, scrollPos, signal } = ctx;

	let pinPoint = 0;
	let stuck = title.classList.contains('is-stuck');

	const measure = () => {
		const barH = Math.round(parentBar.offsetHeight);
		root.style.setProperty('--photo-parent-bar-h', `${barH}px`);
		// The stage's top is stable regardless of the header's stuck state (only
		// the nav and the fixed-height parent bar sit above it), so it gives a
		// flicker-free pin point: the header pins once scrolled past stageTop-barH.
		const stageTop = Math.round(stage.getBoundingClientRect().top + scrollPos());
		pinPoint = Math.max(0, stageTop - barH);
	};

	// Hysteresis so the morph doesn't flicker right at the pin point.
	const STICK_AT = 24;
	const UNSTICK_AT = 4;
	const onScroll = () => {
		const y = scrollPos();
		if (!stuck && y >= pinPoint + STICK_AT) {
			stuck = true;
			title.classList.add('is-stuck');
		} else if (stuck && y <= pinPoint + UNSTICK_AT) {
			stuck = false;
			title.classList.remove('is-stuck');
		}
	};

	window.addEventListener('scroll', onScroll, { passive: true, signal });
	body.addEventListener('scroll', onScroll, { passive: true, signal });

	let measureRaf = 0;
	const queueMeasure = () => {
		cancelAnimationFrame(measureRaf);
		measureRaf = requestAnimationFrame(() => {
			measure();
			onScroll();
		});
	};
	window.addEventListener('resize', queueMeasure, { signal });

	measure();
	onScroll();
	document.fonts?.ready.then(() => {
		if (!signal.aborted) queueMeasure();
	});
}

function initPhotoSectionSnap() {
	window.__photoSectionSnapController?.abort();

	if (document.documentElement.dataset.section !== 'photography') return;

	const root = document.querySelector<HTMLElement>('[data-photo-snap-root]');
	const stage = document.querySelector<HTMLElement>('[data-photo-stage]');
	const title = document.querySelector<HTMLElement>('[data-photo-title]');
	if (!root || !stage || !title) return;

	const controller = new AbortController();
	window.__photoSectionSnapController = controller;
	const { signal } = controller;

	// base.css gives html and body `height: 100%; overflow-x: hidden`, which
	// makes <body> the element that actually scrolls (window.scrollY stays 0).
	// Read/write both so this keeps working if that ever changes — the
	// non-scrolling one is a no-op.
	const body = document.body;
	const scrollPos = () => window.scrollY + body.scrollTop;

	// A shoot page nests its header under a persistent parent breadcrumb instead
	// of docking a masthead over a full-viewport landing. Detect that layout and
	// run the simpler nested morph.
	const parentBar = document.querySelector<HTMLElement>('[data-photo-parent-bar]');
	if (parentBar) {
		initNestedShoot({ root, stage, title, parentBar, body, scrollPos, signal });
		return;
	}

	const landing = document.querySelector<HTMLElement>('[data-photo-landing]');
	if (!landing) return;

	// Scroll offset the title pins at; kept fresh by measure().
	let stageTop = 0;
	let stuck = title.classList.contains('is-stuck');

	const measure = () => {
		// Chrome above the landing (nav + its margin) — sizes the landing so the
		// docked title's bottom edge lands exactly on the first viewport's fold.
		const landingTop = Math.round(landing.getBoundingClientRect().top + scrollPos());
		root.style.setProperty('--photo-landing-offset', `${Math.max(0, landingTop)}px`);

		// The title's natural (un-stuck) height drives the stage's pull-up margin.
		// [data-measuring] disables the morph transitions so both the un-stuck
		// read and the restore commit instantly, without re-playing the morph.
		title.setAttribute('data-measuring', '');
		title.classList.remove('is-stuck');
		const titleHeight = title.offsetHeight;
		title.classList.toggle('is-stuck', stuck);
		void title.offsetHeight; // commit restored state while transitions are off
		title.removeAttribute('data-measuring');
		root.style.setProperty('--photo-title-h', `${Math.round(titleHeight)}px`);

		stageTop = Math.round(stage.getBoundingClientRect().top + scrollPos());
	};

	// Hysteresis keeps the morph from flickering when the scroll rests right on
	// the snap point (where the title has pinned but not yet travelled past).
	const STICK_AT = 48;
	const UNSTICK_AT = 8;
	const onScroll = () => {
		const y = scrollPos();
		if (!stuck && y >= stageTop + STICK_AT) {
			stuck = true;
			title.classList.add('is-stuck');
		} else if (stuck && y <= stageTop + UNSTICK_AT) {
			stuck = false;
			title.classList.remove('is-stuck');
		}
	};

	const scrollToY = (top: number) => {
		const behavior = prefersReducedMotion() ? ('auto' as const) : ('smooth' as const);
		window.scrollTo({ top, behavior });
		body.scrollTo({ top, behavior });
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))
		)
			return;

		const downKeys = new Set(['ArrowDown', 'PageDown', ' ']);
		const upKeys = new Set(['ArrowUp', 'PageUp']);
		const y = scrollPos();

		// Jump landing → stage, and back, but leave the keys alone once the reader
		// is browsing the grid so it scrolls normally.
		if (downKeys.has(event.key) && y < stageTop - 4) {
			event.preventDefault();
			scrollToY(stageTop);
		} else if (upKeys.has(event.key) && y > 0 && y <= stageTop + 4) {
			event.preventDefault();
			scrollToY(0);
		}
	};

	document.addEventListener('keydown', handleKeydown, { capture: true, signal });
	window.addEventListener('scroll', onScroll, { passive: true, signal });
	body.addEventListener('scroll', onScroll, { passive: true, signal });

	let measureRaf = 0;
	const queueMeasure = () => {
		cancelAnimationFrame(measureRaf);
		measureRaf = requestAnimationFrame(() => {
			measure();
			onScroll();
		});
	};
	window.addEventListener('resize', queueMeasure, { signal });

	measure();
	onScroll();
	// The masthead uses a display font — its metrics (and so the title height)
	// settle once fonts finish loading.
	document.fonts?.ready.then(() => {
		if (!signal.aborted) queueMeasure();
	});
}

const queueInitPhotoSectionSnap = () => requestAnimationFrame(initPhotoSectionSnap);

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', queueInitPhotoSectionSnap, { once: true });
} else {
	queueInitPhotoSectionSnap();
}

if (!window.__photoSectionSnapPageLoad) {
	window.__photoSectionSnapPageLoad = true;
	document.addEventListener('astro:page-load', queueInitPhotoSectionSnap);
	document.addEventListener('astro:after-swap', queueInitPhotoSectionSnap);
}
