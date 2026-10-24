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
 *
 * The wipe and drift are Web Animations (compositor-driven); the plate's
 * parallax is a pointer follower.
 */
import { easing } from './ease';
import { FollowGroup } from './follow';

const GATE = '(min-width: 50rem) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const DWELL_MS = 90;
const IDLE_OPACITY = 0.55;

/** Freeze an element's running animations where they are (gsap.killTweensOf semantics). */
function settle(el: Element) {
	for (const animation of el.getAnimations()) {
		try {
			animation.commitStyles();
		} catch {
			/* not rendered: nothing on screen to freeze */
		}
		animation.cancel();
	}
}

let teardown: (() => void) | null = null;

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

	// The hidden per-row thumbs are the stage's image source; warm the initial
	// stage image immediately and defer the rest to idle so they don't compete
	// with initial page assets and globe textures.
	const firstImg = rows[0]?.querySelector<HTMLImageElement>('.frame img');
	if (firstImg) firstImg.loading = 'eager';
	const warmRest = () => {
		for (let i = 1; i < rows.length; i++) {
			const img = rows[i]?.querySelector<HTMLImageElement>('.frame img');
			if (img) {
				img.fetchPriority = 'low';
				img.loading = 'eager';
			}
		}
	};
	const idleId =
		'requestIdleCallback' in window
			? window.requestIdleCallback(warmRest, { timeout: 2000 })
			: window.setTimeout(warmRest, 300);

	let front = -1; // buffer currently on top (-1 until first show)
	let shownRow = -1; // row index currently on the stage

	// Very slow push-in on the resting image so the stage never feels frozen.
	const startDrift = (img: HTMLImageElement) =>
		img.animate([{ scale: '1.13' }], {
			duration: 11000,
			easing: easing('sine.inOut'),
			iterations: Infinity,
			direction: 'alternate',
		});

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
			bufs.forEach(settle);
			// The previous image becomes the base layer; square up any clip a
			// cut-short wipe may have left on it.
			if (outgoing) {
				outgoing.style.zIndex = '1';
				outgoing.style.clipPath = 'inset(0% 0% 0% 0%)';
			}
			incoming.style.zIndex = '2';
			incoming.style.opacity = '1';
			const wipe = incoming.animate(
				[
					{ clipPath: down ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)', scale: '1.14' },
					{ clipPath: 'inset(0% 0% 0% 0%)', scale: '1.06' },
				],
				{ duration: 550, easing: easing('power3.out'), fill: 'forwards' }
			);
			wipe.finished.then(
				() => {
					wipe.commitStyles();
					wipe.cancel();
					if (outgoing) outgoing.style.opacity = '0';
					startDrift(incoming);
				},
				() => {} // cut short by the next swap
			);
			// The base layer eases away underneath instead of sitting still.
			outgoing?.animate([{ scale: '1.1' }], { duration: 550, easing: easing('power2.out'), fill: 'forwards' });
		};
		(incoming.decode?.() ?? Promise.resolve()).then(swap, swap);

		if (indexEl) {
			indexEl.textContent = String(i + 1).padStart(2, '0');
			indexEl.animate(
				[
					{ translate: '0 8px', opacity: 0 },
					{ translate: '0 0', opacity: 1 },
				],
				{ duration: 350, easing: easing('power2.out') }
			);
		}
	};

	// Stage dimming is a plain CSS transition from wherever it currently is.
	const fadeStage = (opacity: number, seconds: number) => {
		stage.style.transition = `opacity ${seconds}s ${easing('power2.out')}`;
		stage.style.opacity = String(opacity);
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
			fadeStage(1, 0.4);
			show(i);
		}
	});

	// Damped micro-parallax: the plate leans a few pixels toward the cursor.
	const lean = new FollowGroup(() => (parallax.style.translate = `${px.current}px ${py.current}px`));
	const px = lean.value(0, 0.8, 'power3.out');
	const py = lean.value(0, 0.8, 'power3.out');
	list.addEventListener('pointermove', (e) => {
		px.to((e.clientX / window.innerWidth - 0.5) * 16);
		py.to((e.clientY / window.innerHeight - 0.5) * 12);
	});

	// Off the list the stage keeps the last shoot, dimmed to recede.
	list.addEventListener('pointerenter', (e) => {
		if (e.pointerType !== 'mouse') return;
		fadeStage(1, 0.4);
	});
	list.addEventListener('pointerleave', (e) => {
		if (e.pointerType !== 'mouse') return;
		window.clearTimeout(dwell);
		fadeStage(IDLE_OPACITY, 0.6);
	});

	// Open on the first shoot so the stage is never an empty frame.
	stage.style.opacity = String(IDLE_OPACITY);
	show(0);

	// The drift loops forever: stop it (and the parallax follower) when the
	// page is swapped out, or it keeps running against a detached image.
	teardown = () => {
		window.clearTimeout(dwell);
		if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
		else window.clearTimeout(idleId);
		lean.halt();
		bufs.forEach((buf) => buf.getAnimations().forEach((a) => a.cancel()));
	};
}

document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => {
	teardown?.();
	teardown = null;
});
