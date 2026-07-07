/**
 * Work index cursor-follow preview.
 *
 * On fine pointers without reduced motion, the static thumb column is hidden
 * (matching media query in WorkIndexRow.astro) and a single floating figure
 * tracks the cursor, swapping its image per hovered row.
 *
 * View-transition handoff: the morph into the detail page must have exactly
 * one carrier of `work-image-<slug>` at navigation time. While a row is
 * hovered, its static thumb gets an inline `view-transition-name: none` and
 * the floating figure takes the name — so a click mid-hover morphs from the
 * follower. On leave, both revert. Keyboard and touch never engage any of
 * this: they keep the static thumb and its build-time transition name.
 */
import { gsap } from './motion';

const GATE = '(min-width: 50rem) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

function setup() {
	const index = document.querySelector<HTMLElement>('.work-index');
	const float = document.querySelector<HTMLElement>('.work-float');
	const floatImg = float?.querySelector('img');
	if (!index || !float || !floatImg) return;
	if (!window.matchMedia(GATE).matches) return;

	// The hidden thumb column keeps lazy images unloaded; warm them so the
	// follower never pops in empty.
	index.querySelectorAll<HTMLImageElement>('.thumb img').forEach((img) => (img.loading = 'eager'));

	gsap.set(float, { xPercent: -50, yPercent: -55, scale: 0.9, opacity: 0 });
	const xTo = gsap.quickTo(float, 'x', { duration: 0.45, ease: 'power3' });
	const yTo = gsap.quickTo(float, 'y', { duration: 0.45, ease: 'power3' });
	const rTo = gsap.quickTo(float, 'rotation', { duration: 0.5, ease: 'power2' });
	let lastX: number | null = null;
	let settle: gsap.core.Tween | null = null;

	index.addEventListener('pointermove', (e) => {
		xTo(e.clientX);
		yTo(e.clientY);
		if (lastX !== null) {
			rTo(gsap.utils.clamp(-7, 7, (e.clientX - lastX) * 0.4));
			settle?.kill();
			settle = gsap.delayedCall(0.12, () => rTo(0));
		}
		lastX = e.clientX;
	});

	let activeThumb: HTMLImageElement | null = null;

	const clearActive = () => {
		if (activeThumb) activeThumb.style.viewTransitionName = '';
		activeThumb = null;
		float.style.viewTransitionName = 'none';
	};

	index.querySelectorAll<HTMLElement>('.row').forEach((row) => {
		const thumb = row.querySelector<HTMLImageElement>('.thumb img');
		const slug = row.dataset.slug;
		if (!thumb || !slug) return;

		row.addEventListener('pointerenter', (e) => {
			if (e.pointerType !== 'mouse') return;
			clearActive();
			activeThumb = thumb;
			floatImg.src = thumb.currentSrc || thumb.src;
			floatImg.alt = '';
			thumb.style.viewTransitionName = 'none';
			float.style.viewTransitionName = `work-image-${slug}`;
			gsap.to(float, { opacity: 1, scale: 1, duration: 0.35, ease: 'power2.out' });
		});

		row.addEventListener('pointerleave', (e) => {
			if (e.pointerType !== 'mouse') return;
			clearActive();
			gsap.to(float, { opacity: 0, scale: 0.9, duration: 0.25, ease: 'power2.in' });
		});
	});
}

// Listeners live on elements that are replaced wholesale by each ClientRouter
// swap, so re-running setup per page-load is the whole lifecycle.
document.addEventListener('astro:page-load', setup);
