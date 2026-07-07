/**
 * Photography shoot index — pinned preview stage.
 *
 * Fine-pointer users get a sticky preview plate beside the typographic list
 * instead of a cursor-chasing image: hovering (or keyboard-focusing) a shoot
 * reveals its cover in the stage with a direction-aware wipe, a slow Ken
 * Burns drift, and damped cursor micro-parallax. A short dwell delay keeps
 * sweeps across the list from thrashing the stage, and with no row hovered
 * the stage rests dimmed on the last shoot shown. Touch, reduced-motion, and
 * no-JS users keep the static thumbnail in each row.
 */
import { gsap } from './motion';

const GATE = '(min-width: 50rem) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const DWELL_MS = 90;
const IDLE_OPACITY = 0.55;

function setup() {
	const list = document.querySelector<HTMLElement>('[data-shoot-list]');
	const stage = document.querySelector<HTMLElement>('[data-shoot-preview]');
	if (!list || !stage) return;
	if (!window.matchMedia(GATE).matches) return;

	const bufs = Array.from(stage.querySelectorAll<HTMLImageElement>('.preview-buf'));
	const parallax = stage.querySelector<HTMLElement>('.preview-parallax');
	const indexEl = stage.querySelector<HTMLElement>('[data-preview-index]');
	const rows = Array.from(list.querySelectorAll<HTMLElement>('.shoot-row'));
	if (bufs.length < 2 || !parallax || !rows.length) return;

	// The hidden per-row thumbs are the stage's image source; force them to
	// load now so swaps decode instantly.
	rows.forEach((row) => {
		const img = row.querySelector<HTMLImageElement>('.frame img');
		if (img) img.loading = 'eager';
	});

	let front = -1; // buffer currently on top (-1 until first show)
	let shownRow = -1; // row index currently on the stage
	let drift: gsap.core.Tween | null = null;

	// Very slow push-in on the resting image so the stage never feels frozen.
	const startDrift = (img: HTMLImageElement) => {
		drift?.kill();
		drift = gsap.to(img, { scale: 1.13, duration: 11, ease: 'sine.inOut', yoyo: true, repeat: -1 });
	};

	const show = (i: number) => {
		if (i === shownRow) return;
		const thumb = rows[i]?.querySelector<HTMLImageElement>('.frame img');
		if (!thumb) return;
		// The wipe follows reading direction: moving down the list reveals
		// downward, moving back up reveals upward.
		const down = i > shownRow;
		shownRow = i;

		const incoming = bufs[front === 0 ? 1 : 0];
		const outgoing = front >= 0 ? bufs[front] : null;
		front = front === 0 ? 1 : 0;

		incoming.src = thumb.currentSrc || thumb.src;
		const swap = () => {
			drift?.kill();
			gsap.killTweensOf(bufs);
			// The previous image becomes the base layer; square up any clip a
			// killed mid-wipe tween may have left on it.
			if (outgoing) gsap.set(outgoing, { zIndex: 1, clipPath: 'inset(0% 0% 0% 0%)' });
			gsap.set(incoming, { zIndex: 2, opacity: 1 });
			gsap.fromTo(
				incoming,
				{ clipPath: down ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)', scale: 1.14 },
				{
					clipPath: 'inset(0% 0% 0% 0%)',
					scale: 1.06,
					duration: 0.55,
					ease: 'power3.out',
					onComplete: () => {
						if (outgoing) gsap.set(outgoing, { opacity: 0 });
						startDrift(incoming);
					},
				}
			);
			// The base layer eases away underneath instead of sitting still.
			if (outgoing) gsap.to(outgoing, { scale: 1.1, duration: 0.55, ease: 'power2.out' });
		};
		(incoming.decode?.() ?? Promise.resolve()).then(swap, swap);

		if (indexEl) {
			indexEl.textContent = String(i + 1).padStart(2, '0');
			gsap.fromTo(indexEl, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' });
		}
	};

	// Hover with intent: a row has to hold the cursor briefly before it takes
	// the stage, so sweeping across the list on the way somewhere costs nothing.
	let dwell: number | undefined;
	rows.forEach((row, i) => {
		row.addEventListener('pointerenter', (e) => {
			if (e.pointerType !== 'mouse') return;
			window.clearTimeout(dwell);
			dwell = window.setTimeout(() => show(i), DWELL_MS);
		});
		row.addEventListener('pointerleave', (e) => {
			if (e.pointerType !== 'mouse') return;
			window.clearTimeout(dwell);
		});
	});

	// Keyboard drives the stage too (the inline frame stays hidden under this
	// gate — see ShootCover.astro). No dwell: focus is already intentional.
	list.addEventListener('focusin', (e) => {
		const row = (e.target as HTMLElement).closest?.('.shoot-row');
		const i = row ? rows.indexOf(row as HTMLElement) : -1;
		if (i >= 0) {
			gsap.to(stage, { opacity: 1, duration: 0.4, ease: 'power2.out' });
			show(i);
		}
	});

	// Damped micro-parallax: the plate leans a few pixels toward the cursor.
	const px = gsap.quickTo(parallax, 'x', { duration: 0.8, ease: 'power3' });
	const py = gsap.quickTo(parallax, 'y', { duration: 0.8, ease: 'power3' });
	list.addEventListener('pointermove', (e) => {
		px((e.clientX / window.innerWidth - 0.5) * 16);
		py((e.clientY / window.innerHeight - 0.5) * 12);
	});

	// Off the list the stage keeps the last shoot, dimmed to recede.
	list.addEventListener('pointerenter', (e) => {
		if (e.pointerType !== 'mouse') return;
		gsap.to(stage, { opacity: 1, duration: 0.4, ease: 'power2.out' });
	});
	list.addEventListener('pointerleave', (e) => {
		if (e.pointerType !== 'mouse') return;
		window.clearTimeout(dwell);
		gsap.to(stage, { opacity: IDLE_OPACITY, duration: 0.6, ease: 'power2.out' });
	});

	// Open on the first shoot so the stage is never an empty frame.
	gsap.set(stage, { opacity: IDLE_OPACITY });
	show(0);
}

document.addEventListener('astro:page-load', setup);
