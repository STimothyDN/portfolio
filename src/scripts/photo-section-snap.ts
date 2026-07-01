declare global {
	interface Window {
		__photoSectionSnapController?: AbortController;
		__photoSectionSnapPageLoad?: boolean;
	}
}

const prefersReducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Photography routes stack two full-height sections: a landing masthead and the
// content stage. The snap between them is handled natively by CSS
// (`scroll-snap-type: y proximity`), which stays soft — it only eases toward a
// section when the scroll comes to rest near it, and never fights an in-progress
// gesture. All this script adds on top is keyboard section-jumps.
function initPhotoSectionSnap() {
	window.__photoSectionSnapController?.abort();

	const root = document.querySelector<HTMLElement>('[data-photo-snap-root]');
	const stage = document.querySelector<HTMLElement>('[data-photo-stage]');
	if (!root || !stage || document.documentElement.dataset.section !== 'photography') return;

	const controller = new AbortController();
	window.__photoSectionSnapController = controller;

	// The stage's scroll offset within the scroll container (`offsetTop` resolves
	// against `.content`, a positioned ancestor, so it can't be used here).
	const stageTop = () =>
		Math.round(stage.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop);

	const scrollToSection = (targetTop: number) =>
		root.scrollTo({ top: targetTop, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const contentTop = stageTop();
		const downKeys = new Set(['ArrowDown', 'PageDown', ' ']);
		const upKeys = new Set(['ArrowUp', 'PageUp']);

		// Jump landing → content, and back, but leave the keys alone once the reader
		// is browsing the grid so it scrolls normally.
		if (downKeys.has(event.key) && root.scrollTop < contentTop - 4) {
			event.preventDefault();
			scrollToSection(contentTop);
		} else if (upKeys.has(event.key) && root.scrollTop > 0 && root.scrollTop < contentTop) {
			event.preventDefault();
			scrollToSection(0);
		}
	};

	document.addEventListener('keydown', handleKeydown, { capture: true, signal: controller.signal });

	root.scrollTop = 0;
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
