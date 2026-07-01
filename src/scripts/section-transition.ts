/*
 * Section transition controller — "the page itself drains like liquid".
 *
 * Instead of a separate overlay, this leans entirely on the native View Transitions
 * API that Astro's ClientRouter runs. On a navigation that crosses the photography
 * boundary we tag the *incoming* <html data-drain="in|out">; global.css then animates
 * the real outgoing/incoming page snapshots (::view-transition-old/new(root)) draining
 * behind a wavy mask + turbulence displacement, revealing the other page directly
 * underneath — no opaque middle frame.
 *
 *   • data-drain="in"  — entering /photography: the dark page drains away, white shows.
 *   • data-drain="out" — leaving  /photography: the dark page pours back in over white.
 *
 * The attribute is applied in `astro:before-swap` on `event.newDocument`, because
 * ClientRouter replaces the live <html> attributes during the swap — setting it on the
 * live element earlier would be wiped before the post-swap animation runs. The root VT
 * animation runs after the swap, when the new <html> (carrying data-drain) is live.
 *
 * Same-world navigations, reduced-motion users, and browsers without the View
 * Transitions API fall through to Astro's default (instant / simple fade) swap.
 */

const prefersReducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const supportsVT = () => typeof (document as any).startViewTransition === 'function';

const isPhoto = (url: URL) =>
	url.pathname === '/photography' || url.pathname.startsWith('/photography/');

const crossesBoundary = (from: URL, to: URL) => isPhoto(from) !== isPhoto(to);

let pending: 'in' | 'out' | null = null;
let started: 'in' | 'out' | null = null;
let rampGen = 0;

const easeInCubic = (t: number) => t * t * t;

/**
 * Ramp the whole-page displacement warp from 0 up to full over the drain, so the
 * page starts crisp and "goo-ifies" gradually as it melts — rather than snapping
 * to full ripple on frame one. (SVG filter attributes can't be animated in CSS.)
 */
function rampGoo(durationMs: number) {
	const disp = document.getElementById('liquid-disp');
	if (!disp) return;
	const MAX = 24;
	const gen = ++rampGen;
	const start = performance.now();
	const step = (now: number) => {
		if (gen !== rampGen) return;
		const t = Math.min((now - start) / durationMs, 1);
		disp.setAttribute('scale', String(easeInCubic(t) * MAX));
		if (t < 1) requestAnimationFrame(step);
		else disp.setAttribute('scale', '0'); // reset for next time
	};
	requestAnimationFrame(step);
}

function register() {
	if (window.__sectionTransition) return;
	window.__sectionTransition = true;

	document.addEventListener('astro:before-preparation', (event: any) => {
		const from: URL = event.from;
		const to: URL = event.to;
		// Only a boundary crossing gets the liquid drain; everything else uses the
		// default swap.
		pending =
			from && to && crossesBoundary(from, to) && supportsVT() && !prefersReducedMotion()
				? isPhoto(to)
					? 'in'
					: 'out'
				: null;
	});

	document.addEventListener('astro:before-swap', (event: any) => {
		// Carry the drain flag on the incoming document so it's live when the root
		// View Transition animation runs (after the swap).
		if (pending) {
			event.newDocument.documentElement.dataset.drain = pending;
		}
		started = pending;
		pending = null;
	});

	document.addEventListener('astro:after-swap', () => {
		// Only the drain-in direction uses the displacement warp; ramp it in sync
		// with the CSS drain animation (which starts right after the swap).
		if (started === 'in') {
			const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drain-dur-in')) || 2800;
			rampGoo(dur);
		}
		started = null;
	});
}

register();
