/**
 * Shared motion system — GSAP + ScrollTrigger behind a declarative API.
 *
 * Components opt in with markup only:
 *   data-animate="fade-up | fade | scale | clip | mask-lines" → entrance on scroll
 *   data-animate-delay="0.3"                            → entrance delay (seconds)
 *   data-line (inside mask-lines)                       → one masked line/word per wrapper
 *                                                         (CSS owns display; JS only transforms)
 *   data-animate-group [data-stagger="0.08"]            → staggered child entrances
 *   data-parallax="0.15"                                → scrubbed y-parallax
 *
 * Rules the rest of the site depends on:
 * - Initial "hidden" states are set here in JS, never in CSS, so no-JS,
 *   reduced-motion, and crawlers always see content.
 * - Everything lives inside gsap.matchMedia('prefers-reduced-motion:
 *   no-preference'); under reduced motion nothing is ever hidden.
 * - The per-page gsap.context is reverted on astro:before-swap BEFORE the
 *   View Transition snapshot is taken — otherwise mid-tween inline styles
 *   freeze into the liquid-drain snapshot.
 * - No ScrollTrigger pinning anywhere: pin spacers corrupt the root
 *   view-transition snapshot during the drain.
 * - The photography section gets the restrained editorial set: fade-only,
 *   longer durations, no parallax.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** Re-measure triggers after layout-changing DOM work (image decode, shoot-panel expansion). */
export function refreshMotion() {
	ScrollTrigger.refresh();
}

const isPhotography = () => document.documentElement.dataset.section === 'photography';

const ENTER = { start: 'top 88%' } as const;

function entrance(el: HTMLElement, preset: string, photo: boolean) {
	const delay = parseFloat(el.dataset.animateDelay ?? '0');
	const trigger = { scrollTrigger: { trigger: el, ...ENTER, once: true } } as const;

	// Editorial restraint: every preset collapses to a slow fade. The one
	// flourish: a child `.rule` hairline draws in alongside the fade.
	if (photo) {
		const rule = el.querySelector<HTMLElement>('.rule');
		const tl = gsap.timeline({ delay, ...trigger });
		gsap.set(el, { opacity: 0 });
		tl.to(el, { opacity: 1, duration: 0.6, ease: 'power2.out' }, 0);
		if (rule) {
			gsap.set(rule, { scaleX: 0, transformOrigin: 'left center' });
			tl.to(rule, { scaleX: 1, duration: 0.9, ease: 'power2.out' }, 0.15);
		}
		return;
	}

	switch (preset) {
		case 'fade':
			gsap.set(el, { opacity: 0 });
			gsap.to(el, { opacity: 1, duration: 0.8, ease: 'power2.out', delay, ...trigger });
			break;
		case 'scale':
			gsap.set(el, { opacity: 0, scale: 0.94 });
			gsap.to(el, { opacity: 1, scale: 1, duration: 0.9, ease: 'power3.out', delay, ...trigger });
			break;
		case 'clip':
			gsap.set(el, { clipPath: 'inset(12% 12% 12% 12%)', opacity: 0, scale: 1.08 });
			gsap.to(el, {
				clipPath: 'inset(0% 0% 0% 0%)',
				opacity: 1,
				scale: 1,
				duration: 1.2,
				ease: 'power4.out',
				delay,
				...trigger,
			});
			break;
		case 'work-row': {
			// Editorial index row: the top hairline draws in while the content
			// lifts up with a small internal stagger (see WorkIndexRow.astro).
			const hairline = el.querySelector<HTMLElement>('.hairline');
			const bits = el.querySelectorAll<HTMLElement>('.index, .title, .description, .meta');
			const tl = gsap.timeline({
				delay,
				scrollTrigger: { trigger: el, ...ENTER, once: true },
			});
			if (hairline) {
				gsap.set(hairline, { scaleX: 0 });
				tl.to(hairline, { scaleX: 1, duration: 0.9, ease: 'power2.out' }, 0);
			}
			if (bits.length) {
				gsap.set(bits, { opacity: 0, y: 18 });
				tl.to(bits, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.06 }, 0.1);
			}
			break;
		}
		case 'mask-lines': {
			// Markup contract: each [data-line] wrapper masks one line/word; its
			// first element child is the moving part. The component's CSS owns
			// display (inline-block for word wrappers) and overflow clipping.
			const lines = Array.from(el.querySelectorAll<HTMLElement>('[data-line]'));
			const movers = lines
				.map((line) => line.firstElementChild as HTMLElement | null)
				.filter((m): m is HTMLElement => !!m);
			if (!movers.length) break;
			gsap.set(movers, { yPercent: 112 });
			gsap.to(movers, {
				yPercent: 0,
				duration: 1.1,
				ease: 'expo.out',
				stagger: 0.12,
				delay,
				// Once revealed, drop the clip so hover effects (e.g. the brand
				// swap's falling glyph) can overflow the word box.
				onComplete: () => gsap.set(lines, { overflow: 'visible' }),
				...trigger,
			});
			break;
		}
		case 'fade-up':
		default:
			gsap.set(el, { opacity: 0, y: 24 });
			gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay, ...trigger });
	}
}

function group(el: HTMLElement, photo: boolean) {
	const children = Array.from(el.children) as HTMLElement[];
	if (!children.length) return;
	const stagger = parseFloat(el.dataset.stagger ?? '0.08');
	const delay = parseFloat(el.dataset.animateDelay ?? '0');
	if (photo) {
		gsap.set(children, { opacity: 0 });
		gsap.to(children, {
			opacity: 1,
			duration: 0.6,
			ease: 'power2.out',
			stagger,
			delay,
			scrollTrigger: { trigger: el, ...ENTER, once: true },
		});
		return;
	}
	gsap.set(children, { opacity: 0, y: 20 });
	gsap.to(children, {
		opacity: 1,
		y: 0,
		duration: 0.8,
		ease: 'power3.out',
		stagger,
		delay,
		scrollTrigger: { trigger: el, ...ENTER, once: true },
	});
}

function parallax(el: HTMLElement) {
	const strength = parseFloat(el.dataset.parallax ?? '0.15');
	gsap.fromTo(
		el,
		{ y: () => strength * 120 },
		{
			y: () => strength * -120,
			ease: 'none',
			scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
		}
	);
}

function setup() {
	const photo = isPhotography();
	document.querySelectorAll<HTMLElement>('[data-animate]').forEach((el) => {
		entrance(el, el.dataset.animate || 'fade-up', photo);
	});
	document.querySelectorAll<HTMLElement>('[data-animate-group]').forEach((el) => group(el, photo));
	// Long-form bodies (markdown content): each direct child fades up on its
	// own trigger so a tall article reveals progressively.
	document.querySelectorAll<HTMLElement>('[data-animate-body] > *').forEach((child) => {
		gsap.set(child, { opacity: 0, y: photo ? 0 : 16 });
		gsap.to(child, {
			opacity: 1,
			y: 0,
			duration: photo ? 0.6 : 0.7,
			ease: 'power2.out',
			scrollTrigger: { trigger: child, start: 'top 92%', once: true },
		});
	});
	if (!photo) {
		document.querySelectorAll<HTMLElement>('[data-parallax]').forEach(parallax);
	}
	// Reading-progress hairline (blog posts): scrubbed across the full page.
	// (.backgrounds spans the whole document; body itself is the scroller.)
	const progress = document.querySelector<HTMLElement>('[data-scroll-progress]');
	const pageRoot = document.querySelector<HTMLElement>('.backgrounds');
	if (progress && pageRoot) {
		gsap.to(progress, {
			scaleX: 1,
			ease: 'none',
			scrollTrigger: { trigger: pageRoot, start: 'top top', end: 'bottom bottom', scrub: true },
		});
	}
}

let mm: gsap.MatchMedia | null = null;

function init() {
	teardown();
	// base.css gives html/body `height: 100%`, so the BODY element is the scroll
	// container (photo-section-snap.ts depends on this) — ScrollTrigger's default
	// window scroller never sees scroll. Re-point it at the fresh body every
	// navigation (ClientRouter replaces <body> wholesale).
	ScrollTrigger.defaults({ scroller: document.body });
	mm = gsap.matchMedia();
	mm.add('(prefers-reduced-motion: no-preference)', () => {
		const ctx = gsap.context(setup);
		// matchMedia calls this cleanup when the condition flips (e.g. the user
		// enables reduced motion mid-session) — revert restores content.
		return () => ctx.revert();
	});
}

function teardown() {
	mm?.revert();
	mm = null;
	ScrollTrigger.getAll().forEach((t) => t.kill());
}

if (import.meta.env.DEV) {
	// Debug handle for inspecting trigger state from the console in dev.
	(window as unknown as Record<string, unknown>).__motion = { gsap, ScrollTrigger };
}

// Fires on first load and after every ClientRouter navigation.
document.addEventListener('astro:page-load', init);
// Revert inline styles before the View Transition snapshots the outgoing page.
document.addEventListener('astro:before-swap', teardown);
// Late image decodes shift layout; re-measure once everything has arrived.
window.addEventListener('load', () => ScrollTrigger.refresh());
