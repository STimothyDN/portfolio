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
import { FollowGroup } from './follow';

const GATE = '(min-width: 50rem) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const FLOAT_Y_OFFSET = 28;

let motion: FollowGroup | null = null;
let settle = 0;

function setup() {
	const index = document.querySelector<HTMLElement>('.work-index');
	const float = document.querySelector<HTMLElement>('.work-float');
	const floatImg = float?.querySelector('img');
	const floatOverlay = float?.querySelector<HTMLElement>('.work-float-overlay');
	if (!index || !float || !floatImg || !floatOverlay) return;
	if (!window.matchMedia(GATE).matches) return;

	// The hidden thumb column keeps lazy images unloaded; warm them so the
	// follower never pops in empty.
	index.querySelectorAll<HTMLImageElement>('.thumb img').forEach((img) => (img.loading = 'eager'));

	// Position chases the cursor; the tilt swings with horizontal speed and
	// settles once the pointer rests. Everything lands in one transform write
	// per frame, and the loop sleeps whenever nothing is moving.
	float.style.transformOrigin = '50% 0%';
	const group = new FollowGroup(() => {
		float.style.transform = `translate(${x.current}px, ${y.current}px) translate(-50%, 0) rotate(${rotation.current}deg) scale(${scale.current})`;
		float.style.opacity = String(opacity.current);
	});
	motion = group;
	const x = group.value(0, 0.45, 'power3.out');
	const y = group.value(0, 0.45, 'power3.out');
	const rotation = group.value(0, 0.5, 'power2.out');
	const scale = group.value(0.9, 0.35, 'power2.out');
	const opacity = group.value(0, 0.35, 'power2.out');
	scale.set(0.9); // paints the resting state before the first hover

	let lastX: number | null = null;
	index.addEventListener('pointermove', (e) => {
		x.to(e.clientX);
		y.to(e.clientY + FLOAT_Y_OFFSET);
		if (lastX !== null) {
			rotation.to(Math.min(7, Math.max(-7, (e.clientX - lastX) * 0.4)));
			window.clearTimeout(settle);
			settle = window.setTimeout(() => rotation.to(0), 120);
		}
		lastX = e.clientX;
	});

	let activeThumb: HTMLImageElement | null = null;

	const clearActive = () => {
		if (activeThumb) activeThumb.style.viewTransitionName = '';
		activeThumb = null;
		float.style.viewTransitionName = 'none';
		floatOverlay.querySelectorAll<HTMLElement>('[data-preview-vt]').forEach((el) => {
			el.style.viewTransitionName = 'none';
		});
	};

	index.querySelectorAll<HTMLElement>('.row').forEach((row) => {
		const thumb = row.querySelector<HTMLImageElement>('.thumb img');
		const overlay = row.querySelector<HTMLElement>('.thumb-overlay');
		const slug = row.dataset.slug;
		if (!thumb || !overlay || !slug) return;

		row.addEventListener('pointerenter', (e) => {
			if (e.pointerType !== 'mouse') return;
			clearActive();
			activeThumb = thumb;
			floatImg.src = thumb.currentSrc || thumb.src;
			floatImg.alt = '';
			floatOverlay.replaceChildren(...Array.from(overlay.children, (child) => child.cloneNode(true)));
			floatOverlay.querySelectorAll<HTMLElement>('[data-preview-vt]').forEach((el) => {
				el.style.viewTransitionName = el.dataset.previewVt ?? 'none';
			});
			thumb.style.viewTransitionName = 'none';
			float.style.viewTransitionName = `work-image-${slug}`;
			opacity.to(1, 0.35);
			scale.to(1, 0.35);
		});

		row.addEventListener('pointerleave', (e) => {
			if (e.pointerType !== 'mouse') return;
			clearActive();
			opacity.to(0, 0.25, 'power2.in');
			scale.to(0.9, 0.25, 'power2.in');
		});
	});
}

// Listeners live on elements that are replaced wholesale by each ClientRouter
// swap, so re-running setup per page-load is the whole lifecycle.
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => {
	window.clearTimeout(settle);
	motion?.halt();
	motion = null;
});
