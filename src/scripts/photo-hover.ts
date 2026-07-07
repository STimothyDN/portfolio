/**
 * Photography shoot index cursor-follow preview.
 *
 * Fine-pointer users get a larger floating cover image while the list stays
 * typographic. Touch, keyboard, reduced-motion, and no-JS users keep the
 * static thumbnail in each row.
 */
import { gsap } from './motion';

const GATE = '(min-width: 50rem) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const FLOAT_Y_OFFSET = 30;

function setup() {
	const list = document.querySelector<HTMLElement>('[data-shoot-list]');
	const float = document.querySelector<HTMLElement>('.shoot-float');
	const floatImg = float?.querySelector('img');
	if (!list || !float || !floatImg) return;
	if (!window.matchMedia(GATE).matches) return;

	list.querySelectorAll<HTMLImageElement>('.frame img').forEach((img) => (img.loading = 'eager'));

	gsap.set(float, { xPercent: -50, yPercent: 0, scale: 0.94, opacity: 0, transformOrigin: '50% 0%' });
	const xTo = gsap.quickTo(float, 'x', { duration: 0.45, ease: 'power3' });
	const yTo = gsap.quickTo(float, 'y', { duration: 0.45, ease: 'power3' });
	const rTo = gsap.quickTo(float, 'rotation', { duration: 0.5, ease: 'power2' });
	let lastX: number | null = null;
	let settle: gsap.core.Tween | null = null;

	list.addEventListener('pointermove', (e) => {
		xTo(e.clientX);
		yTo(e.clientY + FLOAT_Y_OFFSET);
		if (lastX !== null) {
			rTo(gsap.utils.clamp(-4, 4, (e.clientX - lastX) * 0.25));
			settle?.kill();
			settle = gsap.delayedCall(0.12, () => rTo(0));
		}
		lastX = e.clientX;
	});

	list.querySelectorAll<HTMLElement>('.shoot-row').forEach((row) => {
		const thumb = row.querySelector<HTMLImageElement>('.frame img');
		if (!thumb) return;

		row.addEventListener('pointerenter', (e) => {
			if (e.pointerType !== 'mouse') return;
			floatImg.src = thumb.currentSrc || thumb.src;
			floatImg.alt = '';
			gsap.to(float, { opacity: 1, scale: 1, duration: 0.35, ease: 'power2.out' });
		});

		row.addEventListener('pointerleave', (e) => {
			if (e.pointerType !== 'mouse') return;
			gsap.to(float, { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power2.in' });
		});
	});
}

document.addEventListener('astro:page-load', setup);
