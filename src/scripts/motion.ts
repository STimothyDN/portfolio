/**
 * Shared motion system — declarative entrances on IntersectionObserver + the
 * Web Animations API, scroll-linked effects on CSS scroll-driven animations.
 * No animation library ships with it: entrances run on the compositor (so
 * they stay smooth while the main thread is busy hydrating or decoding), and
 * parallax/progress need no scroll listeners at all where scroll timelines
 * are supported.
 *
 * Components opt in with markup only:
 *   data-animate="fade-up | fade | scale | clip | mask-lines | work-row" → entrance on scroll
 *   data-animate-delay="0.3"                            → entrance delay (seconds)
 *   data-line (inside mask-lines)                       → one masked line/word per wrapper
 *                                                         (CSS owns display; JS only animates)
 *   data-animate-group [data-stagger="0.08"]            → staggered child entrances
 *   data-animate-body                                   → each direct child fades up on its own
 *   data-parallax="0.15"                                → scrubbed y-parallax
 *   data-scroll-progress                                → reading-progress bar over the page
 *
 * Rules the rest of the site depends on:
 * - Hidden pre-states live in base.css behind `html.anim-ready` (set before
 *   first paint, only when JS runs and motion is allowed) and stop applying
 *   once an element is marked [data-revealed] — in the same frame its entrance
 *   starts, with `fill: backwards` holding the first keyframe through any
 *   delay. No-JS, reduced-motion and crawlers always see content.
 * - Entrances animate the individual `translate` / `scale` properties, never
 *   `transform`, so they compose with parallax and component CSS. Finished
 *   animations leave no inline styles behind.
 * - <body> is the scroll container (base.css). IntersectionObserver doesn't
 *   care, and the CSS view()/scroll timelines resolve to it.
 * - No pinning anywhere: pin spacers corrupt view-transition snapshots.
 * - The photography section gets the restrained editorial set: every preset
 *   collapses to a fade (plus the `.rule` hairline draw), and no parallax.
 */
import { easing, type EaseName } from './ease';

declare global {
	interface Window {
		/** Read by MainHead's failsafe: motion loaded, keep the pre-hide. */
		__motionReady?: boolean;
	}
}

window.__motionReady = true;

const isPhotography = () => document.documentElement.dataset.section === 'photography';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionAllowed = () =>
	!reducedMotion.matches && document.documentElement.classList.contains('anim-ready');

/** One entrance step. `fill: backwards` holds frame 0 through the delay. */
function play(el: Element, frames: Keyframe[], duration: number, ease: EaseName, delay = 0) {
	return el.animate(frames, {
		duration: duration * 1000,
		delay: delay * 1000,
		easing: easing(ease),
		fill: 'backwards',
	});
}

// Entrances start a hair above fully transparent: an element painted at
// opacity 0 isn't a Largest Contentful Paint candidate, and a compositor-run
// fade never repaints it, so LCP would only register when the fade ends
// (~1.2s late). At 0.001 the reveal frame counts — invisibly.
const HIDDEN = 0.001;
const FADE: Keyframe[] = [{ opacity: HIDDEN }, { opacity: 1 }];
const rise = (px: number): Keyframe[] => [
	{ opacity: HIDDEN, translate: `0 ${px}px` },
	{ opacity: 1, translate: '0 0' },
];
const DRAW: Keyframe[] = [{ scale: '0 1' }, { scale: '1 1' }];

const delayOf = (el: HTMLElement) => parseFloat(el.dataset.animateDelay ?? '') || 0;

/** mask-lines wrappers clip their word until revealed; then hover effects
 * (the brand swap's falling glyph) may overflow the word box. */
const unclip = (el: HTMLElement) =>
	el.querySelectorAll<HTMLElement>('[data-line]').forEach((line) => (line.style.overflow = 'visible'));

function entrance(el: HTMLElement, preset: string, photo: boolean) {
	const delay = delayOf(el);

	// Editorial restraint: every preset collapses to a slow fade. The one
	// flourish: a child `.rule` hairline draws in alongside it.
	if (photo) {
		play(el, FADE, 0.6, 'power2.out', delay);
		const rule = el.querySelector('.rule');
		if (rule) play(rule, DRAW, 0.9, 'power2.out', delay + 0.15);
		return;
	}

	switch (preset) {
		case 'fade':
			play(el, FADE, 0.8, 'power2.out', delay);
			break;
		case 'scale':
			play(el, [{ opacity: HIDDEN, scale: '0.94' }, { opacity: 1, scale: '1' }], 0.9, 'power3.out', delay);
			break;
		case 'clip':
			play(
				el,
				[
					{ clipPath: 'inset(12% 12% 12% 12%)', opacity: HIDDEN, scale: '1.08' },
					{ clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, scale: '1' },
				],
				1.2,
				'power4.out',
				delay
			);
			break;
		case 'work-row': {
			// Editorial index row: the top hairline draws in while the content
			// lifts up with a small internal stagger (see WorkIndexRow.astro).
			const hairline = el.querySelector('.hairline');
			if (hairline) play(hairline, DRAW, 0.9, 'power2.out', delay);
			el.querySelectorAll('.title, .thumb').forEach((bit, i) =>
				play(bit, rise(18), 0.7, 'power3.out', delay + 0.1 + i * 0.06)
			);
			break;
		}
		case 'mask-lines': {
			// Markup contract: each [data-line] wrapper masks one line/word; its
			// first element child is the moving part.
			const movers = [...el.querySelectorAll('[data-line]')].flatMap((line) => line.firstElementChild ?? []);
			const steps = movers.map((mover, i) =>
				play(mover, [{ translate: '0 112%' }, { translate: '0 0' }], 1.1, 'expo.out', delay + i * 0.12)
			);
			const last = steps.at(-1);
			if (last) last.finished.then(() => unclip(el), () => {});
			else unclip(el);
			break;
		}
		case 'fade-up':
		default:
			play(el, rise(24), 0.9, 'power3.out', delay);
	}
}

function group(el: HTMLElement, photo: boolean) {
	const stagger = parseFloat(el.dataset.stagger ?? '') || 0.08;
	const delay = delayOf(el);
	[...el.children].forEach((child, i) =>
		photo
			? play(child, FADE, 0.6, 'power2.out', delay + i * stagger)
			: play(child, rise(20), 0.8, 'power3.out', delay + i * stagger)
	);
}

/* ── Triggers ──────────────────────────────────────────────────────────── */

type Reveal = (animate: boolean) => void;
const reveals = new Map<Element, Reveal>();

const onIntersect: IntersectionObserverCallback = (entries, observer) => {
	for (const entry of entries) {
		const line = entry.rootBounds?.bottom ?? innerHeight * 0.88;
		// Still below the trigger line: keep waiting.
		if (!entry.isIntersecting && entry.boundingClientRect.top >= line) continue;
		observer.unobserve(entry.target);
		const reveal = reveals.get(entry.target);
		reveals.delete(entry.target);
		// Already scrolled past (a restored scroll position) or not rendered at
		// all: nobody can see an entrance, so just show it.
		reveal?.(entry.isIntersecting);
	}
};

let enterAt88: IntersectionObserver | undefined; // 'top 88%' — element top crosses 88% of the viewport
let enterAt92: IntersectionObserver | undefined; // 'top 92%' — long-form bodies, a touch earlier

function watch(observer: IntersectionObserver, el: HTMLElement, onEnter: () => void, onSkip?: () => void) {
	reveals.set(el, (animate) => {
		el.dataset.revealed = '';
		if (animate) onEnter();
		else onSkip?.();
	});
	observer.observe(el);
}

/* ── Scroll-linked: parallax + reading progress ───────────────────────── */

// CSS scroll timelines (base.css) do the work where supported; this is the
// fallback: one rAF-throttled listener on the body scroller.
const scrollTimelines = CSS.supports('animation-timeline: view()');

function scrollLinked(photo: boolean, signal: AbortSignal) {
	const parallax = photo ? [] : [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
	const items = parallax.map((el) => {
		const strength = parseFloat(el.dataset.parallax ?? '');
		const s = Number.isFinite(strength) ? strength : 0.15;
		el.style.setProperty('--parallax', String(s));
		return { el, strength: s, top: 0, height: 0 };
	});
	const progress = document.querySelector<HTMLElement>('[data-scroll-progress]');
	if (scrollTimelines || (!items.length && !progress)) return;

	const scroller = document.body;
	const measure = () => {
		// Layout position, not the parallaxed one.
		for (const it of items) it.el.style.translate = '';
		const scrollTop = scroller.scrollTop;
		for (const it of items) {
			const r = it.el.getBoundingClientRect();
			it.top = r.top + scrollTop;
			it.height = r.height;
		}
	};
	let frame = 0;
	const update = () => {
		frame = 0;
		const scrollTop = scroller.scrollTop;
		const vh = innerHeight;
		for (const it of items) {
			// 0 when its top meets the viewport bottom, 1 when its bottom leaves the top.
			const p = Math.min(1, Math.max(0, (scrollTop + vh - it.top) / (vh + it.height)));
			it.el.style.translate = `0 ${(it.strength * 120 * (1 - 2 * p)).toFixed(2)}px`;
		}
		if (progress) {
			const max = scroller.scrollHeight - scroller.clientHeight;
			progress.style.transform = `scaleX(${max > 0 ? scrollTop / max : 0})`;
		}
	};
	const queue = () => (frame ||= requestAnimationFrame(update));
	const remeasure = () => {
		measure();
		queue();
	};
	scroller.addEventListener('scroll', queue, { passive: true, signal });
	window.addEventListener('resize', remeasure, { signal });
	// Late image decodes shift layout.
	if (document.readyState !== 'complete') window.addEventListener('load', remeasure, { once: true, signal });
	signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true });
	remeasure();
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

let controller: AbortController | null = null;

function init() {
	teardown();
	if (!motionAllowed()) return;
	controller = new AbortController();
	const photo = isPhotography();

	enterAt88 ??= new IntersectionObserver(onIntersect, { rootMargin: '0px 0px -12% 0px' });
	enterAt92 ??= new IntersectionObserver(onIntersect, { rootMargin: '0px 0px -8% 0px' });

	document.querySelectorAll<HTMLElement>('[data-animate]').forEach((el) => {
		const preset = el.dataset.animate || 'fade-up';
		const skip = preset === 'mask-lines' && !photo ? () => unclip(el) : undefined;
		watch(enterAt88!, el, () => entrance(el, preset, photo), skip);
	});
	document
		.querySelectorAll<HTMLElement>('[data-animate-group]')
		.forEach((el) => watch(enterAt88!, el, () => group(el, photo)));
	// Long-form bodies (markdown content): each direct child fades up on its
	// own trigger so a tall article reveals progressively.
	document
		.querySelectorAll<HTMLElement>('[data-animate-body] > *')
		.forEach((child) =>
			watch(enterAt92!, child, () => play(child, photo ? FADE : rise(16), photo ? 0.6 : 0.7, 'power2.out'))
		);

	scrollLinked(photo, controller.signal);
}

function teardown() {
	controller?.abort();
	controller = null;
	enterAt88?.disconnect();
	enterAt92?.disconnect();
	reveals.clear();
}

// Fires on first load and after every ClientRouter navigation.
document.addEventListener('astro:page-load', init);
// The outgoing page's observers and listeners are dead weight after the swap.
document.addEventListener('astro:before-swap', teardown);
// Turning on reduced motion mid-session: base.css drops every pre-hide on its
// own; stop starting new entrances (and resume if it's turned back off).
reducedMotion.addEventListener('change', init);
