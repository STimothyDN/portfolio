/**
 * Observatory hero (home page, and the /lab sandbox): the name docks into the nav logo on scroll, and
 * meteors knock the "thy" out of "Timothy".
 *
 * Dock — one progress value drives everything: `--dock-p` (0 → 1 over the
 * first `--dock-range` px of scroll) is a registered number property on
 * <body>, animated by a CSS scroll timeline where supported (this script only
 * measures), or written per frame from a scroll listener where it isn't.
 * The page's CSS turns it into the name's translate/scale, "Navarro" falling
 * away, the byline fading, and the handoff to the nav's own "Timo3" text.
 * The range is exactly the scroll it takes the name to reach the nav, so the
 * name rides native scroll vertically and only shrinks and slides sideways —
 * nothing counter-scrolls, so nothing can wobble.
 *
 * Swap — the brand word is put in script mode ([data-swap='js']) and its
 * `.is-swapped` class is the union of: mouse hover, being scrolled into the
 * dock, and a strike (on load, on tap, and now and then while idle). By
 * night a meteor brings the "3"; by day a cloud condenses over the name and
 * drops it.
 */
import { burstSparks, dropFromCloud, strikeMeteor } from './sky';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scrollTimelines = CSS.supports('animation-timeline: scroll()');

/** Progress at which scrolling knocks the "thy" out (and, below UNSWAP, puts it back). */
const SWAP_AT = 0.14;
const UNSWAP_AT = 0.07;
/** First strike, after the name's mask entrance (~1.3s) has settled. */
const FIRST_STRIKE_MS = 1900;
const HOLD_MS = 2600;
const IDLE_STRIKE_MS: [number, number] = [28000, 42000];
/** Day: how long the cloud takes to condense before it lets the "3" go. */
const CONDENSE_S = 0.9;

let controller: AbortController | null = null;
const timers = new Set<number>();

function later(fn: () => void, ms: number) {
	const id = window.setTimeout(() => {
		timers.delete(id);
		fn();
	}, ms);
	timers.add(id);
}

function init() {
	teardown();
	const dock = document.querySelector<HTMLElement>('[data-dock-name]');
	const brand = dock?.querySelector<HTMLElement>('.brand-word');
	const swapZone = brand?.querySelector<HTMLElement>('.brand-swap');
	const navText = document.querySelector<HTMLElement>('.is-docking .site-title-text');
	if (!dock || !brand || !swapZone || !navText) return;

	controller = new AbortController();
	const { signal } = controller;
	const body = document.body;
	const mode = scrollTimelines ? 'scroll' : 'js';

	brand.dataset.swap = 'js';

	let range = 300;
	let hovered = false;
	let scrolled = false;
	let striking = false;

	const sync = () => brand.classList.toggle('is-swapped', hovered || scrolled || striking);

	/* ── Dock geometry ─────────────────────────────────────────────────── */

	const measure = () => {
		// Read the untransformed layout: drop the dock rules for one
		// synchronous read (no frame is painted in between).
		const was = body.dataset.dock;
		delete body.dataset.dock;
		const scrollTop = body.scrollTop;
		const b = brand.getBoundingClientRect();
		const d = dock.getBoundingClientRect();
		// The nav is sticky at the top, so its box is the same at any scroll.
		const n = navText.getBoundingClientRect();
		if (was) body.dataset.dock = was;

		const brandMid = b.top + scrollTop + b.height / 2; // document y
		const navMid = n.top + n.height / 2; // viewport y
		range = Math.max(80, brandMid - navMid);
		const scale = parseFloat(getComputedStyle(navText).fontSize) / parseFloat(getComputedStyle(brand).fontSize);

		const set = (name: string, value: string) => body.style.setProperty(name, value);
		set('--dock-range', `${range.toFixed(1)}px`);
		set('--dock-ox', `${(b.left - d.left).toFixed(1)}px`);
		set('--dock-oy', `${(b.top + b.height / 2 - d.top).toFixed(1)}px`);
		set('--dock-dx', `${(n.left - b.left).toFixed(1)}px`);
		// Zero by construction (range = the natural travel), kept explicit so
		// a longer, lagging range is a one-line change.
		set('--dock-dy', `${(navMid - (brandMid - range)).toFixed(1)}px`);
		set('--dock-s', scale.toFixed(4));
		body.dataset.dock = mode;
		onScroll();
	};

	/* ── Scroll: progress fallback + swap/dock state ───────────────────── */

	let frame = 0;
	const onScroll = () => {
		frame = 0;
		const p = Math.min(1, Math.max(0, body.scrollTop / range));
		if (mode === 'js') body.style.setProperty('--dock-p', p.toFixed(4));
		// Past halfway the (shrinking, then invisible) name shouldn't catch
		// clicks meant for the nav.
		body.toggleAttribute('data-docked', p > 0.6);
		if (reducedMotion.matches) return;
		if (!scrolled && p > SWAP_AT) {
			scrolled = true;
			sync();
		} else if (scrolled && p < UNSWAP_AT) {
			scrolled = false;
			sync();
		}
	};
	const queueScroll = () => (frame ||= requestAnimationFrame(onScroll));
	body.addEventListener('scroll', queueScroll, { passive: true, signal });

	let resizeFrame = 0;
	window.addEventListener('resize', () => (resizeFrame ||= requestAnimationFrame(() => ((resizeFrame = 0), measure()))), {
		signal,
	});
	signal.addEventListener('abort', () => {
		cancelAnimationFrame(frame);
		cancelAnimationFrame(resizeFrame);
	});

	/* ── Hover (mouse) + tap (touch) ───────────────────────────────────── */

	brand.addEventListener(
		'pointerenter',
		(e) => {
			if (e.pointerType !== 'mouse') return;
			hovered = true;
			sync();
		},
		{ signal }
	);
	brand.addEventListener(
		'pointerleave',
		(e) => {
			if (e.pointerType !== 'mouse') return;
			hovered = false;
			sync();
		},
		{ signal }
	);
	brand.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && strike(), { signal });
	// The command palette's "Knock the 3 in".
	document.addEventListener('observatory:strike', () => strike(), { signal });

	/* ── Meteor strike ─────────────────────────────────────────────────── */

	const atTop = () => body.scrollTop < range * 0.05;

	// Arrow functions (not hoisted declarations) so they keep the null checks above.
	const strike = () => {
		if (striking || scrolled || hovered || !atTop()) return;
		striking = true;

		const finish = (delay: number) =>
			later(() => {
				striking = false;
				sync();
				if (!reducedMotion.matches) scheduleIdle();
			}, delay);

		if (reducedMotion.matches) {
			// No flight, no bounce: the swap just holds for a beat.
			sync();
			finish(HOLD_MS);
			return;
		}

		const fontSize = parseFloat(getComputedStyle(brand).fontSize);
		const zone = swapZone!.getBoundingClientRect();
		// Where the "3" starts its CSS drop: 1.7em above its landing spot.
		const to = { x: zone.left + fontSize * 0.3, y: zone.top + zone.height / 2 - fontSize * 1.7 };
		const night = document.documentElement.classList.contains('theme-dark');
		// Daylight pages (the GPU sky) send a gold sun-glint streak by day
		// rather than condensing a sprite cloud.
		const streak = night || 'daylight' in body.dataset;

		let duration: number;
		if (streak) {
			// Steep fall from the upper right, so the hand-off to the glyph's
			// straight drop barely bends.
			const angle = (64 * Math.PI) / 180;
			const fall = to.y + 80;
			const from = { x: to.x + fall / Math.tan(angle), y: -80 };
			duration = Math.min(0.9, Math.max(0.45, Math.hypot(to.x - from.x, fall) / 1300));
			strikeMeteor(from, to, duration);
		} else {
			// The cloud sits a touch above and right of the start point, so the
			// "3" falls out of its underside.
			duration = CONDENSE_S;
			dropFromCloud({ x: to.x + fontSize * 0.2, y: to.y - fontSize * 0.2 }, fontSize * 2.4, duration);
		}

		later(() => {
			sync(); // the "3" drops in, knocks the "thy" off a beat later
			later(() => {
				const hit = swapZone!.getBoundingClientRect();
				if (streak) burstSparks(hit.left + hit.width * 0.45, hit.top + hit.height * 0.7);
				brand.animate(
					[
						{ translate: '0 0', rotate: '0deg' },
						{ translate: '0 0.04em', rotate: '-1.4deg', offset: 0.3 },
						{ translate: '0 -0.01em', rotate: '0.5deg', offset: 0.65 },
						{ translate: '0 0', rotate: '0deg' },
					],
					{ duration: 420, easing: 'ease-out' }
				);
			}, 170);
		}, duration * 1000);
		finish(duration * 1000 + HOLD_MS);
	};

	let idleTimer = 0;
	const scheduleIdle = () => {
		clearTimeout(idleTimer);
		timers.delete(idleTimer);
		const [min, max] = IDLE_STRIKE_MS;
		idleTimer = window.setTimeout(
			() => {
				timers.delete(idleTimer);
				if (document.hidden || !atTop()) scheduleIdle();
				else strike();
			},
			min + Math.random() * (max - min)
		);
		timers.add(idleTimer);
	};

	/* ── Start ─────────────────────────────────────────────────────────── */

	document.fonts.ready.then(() => {
		if (signal.aborted) return;
		measure();
		// Reduced motion: no automatic strikes; a tap still swaps the name.
		if (!reducedMotion.matches) later(strike, FIRST_STRIKE_MS);
	});
}

function teardown() {
	controller?.abort();
	controller = null;
	timers.forEach((id) => clearTimeout(id));
	timers.clear();
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', teardown);
