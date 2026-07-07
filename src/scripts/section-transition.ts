const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhoto = (url: URL) => url.pathname === '/photography' || url.pathname.startsWith('/photography/');
const crossesBoundary = (from: URL, to: URL) => isPhoto(from) !== isPhoto(to);

// ── MOTION LAZY LOADING ──
const motionReady = import('motion').catch(() => null);
let _animate: ((el: Element, keyframes: any, options?: any) => any) | null = null;
async function getAnimate() {
	if (!_animate) {
		const m = await motionReady;
		if (m && m.animate) {
			_animate = m.animate;
		} else if (m && m.default && m.default.animate) {
			_animate = m.default.animate;
		} else {
			_animate = () => ({ finished: Promise.resolve() });
		}
	}
	return _animate;
}

const waitFor = (anim: any) => anim.finished;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

// Abstract front-view film camera: flash unit up top (bulb + glow window),
// body with top plate, big lens with glass highlights, viewfinder, shutter
// button, wind knobs. Flat ink shapes — deliberately stylized, not literal.
const FLASH_CAMERA_SVG = `
	<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
		<rect x="46" y="30" width="14" height="14" fill="#1d1a17" />
		<rect x="30" y="6" width="46" height="30" rx="5" fill="#1d1a17" stroke="rgba(255,255,255,0.28)" stroke-width="1.5" />
		<rect x="36" y="12" width="34" height="18" rx="3" fill="#efe6d2" />
		<rect class="flash-transition__bulb-glow" x="36" y="12" width="34" height="18" rx="3" fill="#fffdf2" />
		<rect x="8" y="40" width="184" height="102" rx="14" fill="#17130f" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />
		<path d="M8 64 h184" stroke="#2c251d" stroke-width="1.5" />
		<circle cx="26" cy="52" r="5" fill="#3a332b" />
		<circle cx="110" cy="52" r="5" fill="#3a332b" />
		<rect x="128" y="46" width="30" height="13" rx="3" fill="#0c0a08" stroke="#3c352c" stroke-width="1" />
		<circle cx="176" cy="52" r="6" fill="#c34a3e" />
		<circle cx="76" cy="100" r="36" fill="#0d0b09" stroke="#4a4136" stroke-width="2" />
		<circle cx="76" cy="100" r="26" fill="#1a1511" />
		<circle cx="76" cy="100" r="16" fill="#232d3a" />
		<circle cx="70" cy="93" r="5" fill="rgba(255,255,255,0.7)" />
		<circle cx="81" cy="106" r="2.5" fill="rgba(255,255,255,0.35)" />
		<rect x="124" y="84" width="46" height="30" rx="4" fill="#201a14" stroke="#37302a" stroke-width="1" />
	</svg>
`;

const FLASH_LAYERS = `
	<div class="flash-transition__base"></div>
	<div class="flash-transition__tint"></div>
	<div class="flash-transition__bloom"></div>
	<div class="flash-transition__grain"></div>
	<div class="flash-transition__camera">${FLASH_CAMERA_SVG}</div>
	<div class="flash-transition__burst"></div>
`;

function flashOverlayMarkup() {
	return `
		<div class="flash-transition" aria-hidden="true" data-astro-transition-persist="flash-overlay">${FLASH_LAYERS}</div>
	`;
}

function flashParts(doc: Document = document) {
	let overlay = doc.querySelector<HTMLElement>('.flash-transition');
	if (!overlay) {
		doc.body.insertAdjacentHTML('afterbegin', flashOverlayMarkup());
		overlay = doc.querySelector<HTMLElement>('.flash-transition');
	}
	if (!overlay) return null;
	if (!overlay.querySelector('.flash-transition__base') || !overlay.querySelector('.flash-transition__camera'))
		overlay.innerHTML = FLASH_LAYERS;

	return {
		overlay,
		base: overlay.querySelector<HTMLElement>('.flash-transition__base'),
		tint: overlay.querySelector<HTMLElement>('.flash-transition__tint'),
		bloom: overlay.querySelector<HTMLElement>('.flash-transition__bloom'),
		grain: overlay.querySelector<HTMLElement>('.flash-transition__grain'),
		camera: overlay.querySelector<HTMLElement>('.flash-transition__camera'),
		burst: overlay.querySelector<HTMLElement>('.flash-transition__burst'),
		bulbGlow: overlay.querySelector<SVGElement>('.flash-transition__bulb-glow'),
	};
}

type FlashParts = NonNullable<ReturnType<typeof flashParts>>;

/** Force the overlay into the fully-opaque white "paper" state. */
function setFlashWhite({ overlay, base, camera, burst }: FlashParts) {
	overlay.dataset.active = 'true';
	overlay.style.opacity = '1';
	if (base) base.style.opacity = '1';
	// The flash has gone off — only the flat base should show now.
	if (camera) camera.style.opacity = '0';
	if (burst) burst.style.opacity = '0';
}

async function flashClose() {
	try {
		const animate = await getAnimate();
		const parts = flashParts();
		if (!parts) return;
		const { overlay, base, tint, bloom, grain, camera, burst, bulbGlow } = parts;

		// Overlay container on, every layer dark: the camera enters on its own.
		overlay.dataset.active = 'true';
		overlay.style.opacity = '1';
		if (base) base.style.opacity = '0';
		if (tint) tint.style.opacity = '0';
		if (grain) grain.style.opacity = '0';
		if (bloom) bloom.style.opacity = '0';

		if (camera && burst) {
			// The film camera drops in from above and settles with a slight
			// overshoot, like it was lowered on a strap.
			camera.style.opacity = '1';
			await waitFor(
				animate(
					camera,
					{ transform: ['translateY(-90vh) rotate(-6deg)', 'translateY(0vh) rotate(-6deg)'] },
					{ duration: 0.5, ease: [0.22, 1.4, 0.36, 1] }
				)
			);
			await delay(140);

			// Flash goes off: the bulb window flares, the body kicks back…
			if (bulbGlow) void waitFor(animate(bulbGlow, { opacity: [0, 1] }, { duration: 0.07, ease: 'ease-out' }));
			void waitFor(
				animate(
					camera,
					{
						transform: [
							'translateY(0vh) rotate(-6deg)',
							'translateY(1.2vh) rotate(-4.5deg)',
							'translateY(0vh) rotate(-6deg)',
						],
					},
					{ duration: 0.18, ease: 'ease-out' }
				)
			);

			// …and a ball of white erupts from the bulb until its solid core
			// swallows the viewport (burst core = 55% of a 40px circle, so
			// scale by the viewport diagonal over ~10px of core radius).
			const coverScale = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) / 10);
			await waitFor(
				animate(burst, { transform: ['scale(0)', `scale(${coverScale})`] }, { duration: 0.3, ease: [0.16, 1, 0.3, 1] })
			);
		} else {
			// Stale overlay without the camera layers: fall back to a plain pop.
			await waitFor(animate(overlay, { opacity: [0, 1] }, { duration: 0.09, ease: 'ease-out' }));
		}

		// Screen is now fully white — lock in the flat paper base and let the
		// hot centre bloom out and decay. Runs across the swap — the persisted
		// overlay keeps its WAAPI animation.
		if (base) base.style.opacity = '1';
		if (camera) camera.style.opacity = '0';
		if (burst) burst.style.opacity = '0';
		if (bloom) void waitFor(animate(bloom, { opacity: [1, 0] }, { duration: 0.55, ease: 'ease-out' }));

		// A short beat so the flash registers before the router may swap.
		await delay(160);
	} catch (e) {
		console.error('[section-transition] flashClose failed:', e);
	}
}

/** Wait until above-the-fold images have decoded, capped at `timeoutMs`. */
async function aboveFoldImagesReady(timeoutMs: number) {
	const vh = window.innerHeight;
	const imgs = Array.from(document.images).filter((img) => {
		const r = img.getBoundingClientRect();
		return r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0;
	});
	if (!imgs.length) return;
	await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), delay(timeoutMs)]);
}

async function flashOpen() {
	const parts = flashParts();
	if (!parts) return;
	const { overlay, base, tint, bloom, grain } = parts;

	try {
		const animate = await getAnimate();

		// Hold pure white while the new page settles underneath: fonts, then
		// any above-the-fold imagery, then a beat of blank paper.
		await nextFrame();
		await nextFrame();
		await Promise.race([document.fonts?.ready?.catch(() => {}) ?? Promise.resolve(), delay(350)]);
		await aboveFoldImagesReady(1500);
		await delay(250);

		// Develop. One continuous pass: the white base thins on a slow-in /
		// slow-out curve while a warm chemical tint swells and recedes and
		// film grain surfaces then dissolves. Offsets shape the curve; the
		// per-segment ease just smooths the joins.
		const DEVELOP = 2.6;
		if (bloom) bloom.style.opacity = '0';
		if (grain)
			void waitFor(
				animate(
					grain,
					{ opacity: [0, 0.12, 0.09, 0], offset: [0, 0.18, 0.7, 1] },
					{ duration: DEVELOP, ease: 'ease-in-out' }
				)
			);
		if (tint)
			void waitFor(
				animate(
					tint,
					{ opacity: [0, 0.55, 0], offset: [0, 0.45, 1] },
					{ duration: DEVELOP, ease: 'ease-in-out' }
				)
			);
		if (base)
			await waitFor(
				animate(
					base,
					{ opacity: [1, 0.96, 0.72, 0.28, 0.08, 0], offset: [0, 0.22, 0.5, 0.72, 0.88, 1] },
					{ duration: DEVELOP, ease: 'ease-in-out' }
				)
			);
		else await delay(DEVELOP * 1000);
	} catch (e) {
		console.error('[section-transition] flashOpen failed:', e);
	} finally {
		overlay.remove();
	}
}

function dslrOverlayMarkup() {
	return `
		<div class="dslr-shutdown__blackout" aria-hidden="true" data-astro-transition-persist="dslr-blackout"></div>
		<div class="dslr-shutdown" aria-hidden="true" data-astro-transition-persist="dslr-modal">
			<div class="dslr-shutdown__panel">
				<span class="dslr-shutdown__bracket dslr-shutdown__bracket--tl"></span>
				<span class="dslr-shutdown__bracket dslr-shutdown__bracket--tr"></span>
				<span class="dslr-shutdown__bracket dslr-shutdown__bracket--bl"></span>
				<span class="dslr-shutdown__bracket dslr-shutdown__bracket--br"></span>
				<div class="dslr-shutdown__icon">⏻</div>
				<div class="dslr-shutdown__text">Camera Powering Off</div>
				<div class="dslr-shutdown__subtext">Directing you to your next destination&hellip;</div>
				<div class="dslr-shutdown__bar">
					<div class="dslr-shutdown__bar-fill"></div>
				</div>
			</div>
		</div>
		<div class="dslr-shutdown__crt" aria-hidden="true" data-astro-transition-persist="dslr-crt"></div>
	`;
}

function ensureDslrOverlay(doc: Document = document, mode: 'hidden' | 'visible' | 'blacked-out' = 'hidden') {
	let modal = doc.querySelector<HTMLElement>('.dslr-shutdown');
	let blackout = doc.querySelector<HTMLElement>('.dslr-shutdown__blackout');
	let crt = doc.querySelector<HTMLElement>('.dslr-shutdown__crt');

	if (!modal || !blackout || !crt) {
		modal?.remove();
		blackout?.remove();
		crt?.remove();
		doc.body.insertAdjacentHTML('afterbegin', dslrOverlayMarkup());
		modal = doc.querySelector<HTMLElement>('.dslr-shutdown');
		blackout = doc.querySelector<HTMLElement>('.dslr-shutdown__blackout');
		crt = doc.querySelector<HTMLElement>('.dslr-shutdown__crt');
	}
	if (!modal || !blackout || !crt) return null;

	const panel = modal.querySelector<HTMLElement>('.dslr-shutdown__panel');
	const text = modal.querySelector<HTMLElement>('.dslr-shutdown__text');
	const icon = modal.querySelector<HTMLElement>('.dslr-shutdown__icon');
	const barFill = modal.querySelector<HTMLElement>('.dslr-shutdown__bar-fill');

	if (mode === 'hidden') {
		modal.dataset.active = 'false';
		modal.style.opacity = '0';
		crt.dataset.active = 'false';
		crt.style.opacity = '0';
		blackout.style.opacity = '0';
	} else {
		modal.dataset.active = 'true';
		modal.style.opacity = '1';
		crt.dataset.active = 'true';
		crt.style.opacity = '1';
		blackout.style.opacity = mode === 'blacked-out' ? '1' : '0';
	}

	return { modal, blackout, crt, panel, text, icon, barFill };
}

async function blinkContent(els: (HTMLElement | null)[], count: number, onMs = 250, offMs = 250) {
	for (let i = 0; i < count; i++) {
		for (const el of els) if (el) el.style.opacity = '0';
		await delay(offMs);
		for (const el of els) if (el) el.style.opacity = '1';
		if (i < count - 1) await delay(onMs);
	}
}

async function dslrClose() {
	try {
		const animate = await getAnimate();
		const parts = ensureDslrOverlay(document, 'hidden');
		if (!parts) return;
		const { modal, blackout, crt, panel, text, icon, barFill } = parts;

		// The retro-screen treatment snaps on the instant the transition kicks
		// off — the whole page is now a camera LCD (scanlines, flicker, sweep).
		crt.dataset.active = 'true';
		crt.style.opacity = '1';

		modal.dataset.active = 'true';

		await waitFor(animate(modal, { opacity: [0, 1] }, { duration: 0.2, ease: 'ease-out' }));
		if (panel) void waitFor(animate(panel, { transform: ['scale(0.92)', 'scale(1)'] }, { duration: 0.25, ease: [0.16, 1, 0.3, 1] }));

		await delay(200);
		await blinkContent([text, icon], 3, 250, 250);

		if (barFill) void waitFor(animate(barFill, { transform: ['scaleX(1)', 'scaleX(0)'] }, { duration: 0.9, ease: 'ease-in' }));
		await waitFor(animate(blackout, { opacity: [0, 1] }, { duration: 0.9, ease: 'ease-in' }));
		await delay(150);
	} catch (e) {
		console.error('[section-transition] dslrClose failed:', e);
	}
}

async function dslrOpen() {
	const animate = await getAnimate();
	const modal = document.querySelector<HTMLElement>('.dslr-shutdown');
	const blackout = document.querySelector<HTMLElement>('.dslr-shutdown__blackout');
	const crt = document.querySelector<HTMLElement>('.dslr-shutdown__crt');
	const backgrounds = document.querySelector<HTMLElement>('.backgrounds');

	try {
		await nextFrame();
		await nextFrame();
		await Promise.race([document.fonts?.ready?.catch(() => {}) ?? Promise.resolve(), delay(50)]);

		// The CRT treatment dies with the modal — the "tube" switches off
		// before the new page fades up from black.
		if (crt) void waitFor(animate(crt, { opacity: [1, 0] }, { duration: 0.3, ease: 'ease-in' }));
		if (modal) await waitFor(animate(modal, { opacity: [1, 0] }, { duration: 0.3, ease: 'ease-in' }));

		if (backgrounds) {
			backgrounds.classList.add('is-populating');
			void backgrounds.offsetHeight;
			requestAnimationFrame(() => backgrounds.classList.add('is-populated'));
		}

		if (blackout) await waitFor(animate(blackout, { opacity: [1, 0] }, { duration: 0.8, ease: [0.16, 1, 0.3, 1] }));
	} finally {
		modal?.remove();
		blackout?.remove();
		crt?.remove();
		if (backgrounds) {
			const onEnd = () => {
				backgrounds.classList.remove('is-populating', 'is-populated');
				backgrounds.removeEventListener('transitionend', onEnd);
			};
			backgrounds.addEventListener('transitionend', onEnd);
			setTimeout(() => backgrounds.classList.remove('is-populating', 'is-populated'), 1200);
		}
	}
}

let pending: 'in' | 'out' | null = null;
let opening: 'in' | 'out' | null = null;

function register() {
	if (window.__sectionTransition) return;
	window.__sectionTransition = true;

	document.addEventListener('astro:before-preparation', (event: any) => {
		const from: URL = event.from;
		const to: URL = event.to;

		pending =
			from && to && crossesBoundary(from, to) && !prefersReducedMotion()
				? isPhoto(to)
					? 'in'
					: 'out'
				: null;
		
		opening = null;

		if (!pending) return;

		const direction = pending;
		const loader = event.loader;
		event.loader = async () => {
			const loading = loader();
			if (direction === 'in') {
				await Promise.all([loading, flashClose()]);
			} else {
				await Promise.all([loading, dslrClose()]);
			}
		};
	});

	document.addEventListener('astro:before-swap', (event: any) => {
		if (!pending) return;
		const vt = event.viewTransition;
		if (vt) {
			try { vt.skipTransition(); } catch {}
			vt.ready?.catch?.(() => {});
			vt.finished?.catch?.(() => {});
			vt.updateCallbackDone?.catch?.(() => {});
		}
	});

	document.addEventListener('astro:after-swap', () => {
		if (pending) {
			opening = pending;
			pending = null;

			// Entering photography: the persisted overlay should have crossed
			// the swap, but re-assert the opaque white state synchronously
			// (before first paint) so the new page never peeks through early.
			if (opening === 'in') {
				const parts = flashParts();
				if (parts) setFlashWhite(parts);
			}
		}
	});

	document.addEventListener('astro:page-load', () => {
		if (!opening) return;
		const direction = opening;
		opening = null;
		void (async () => {
			if (direction === 'in') {
				await flashOpen();
			} else {
				await dslrOpen();
			}
		})();
	});
}

register();
