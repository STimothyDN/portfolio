/**
 * Ambient sky canvas — page-side controller.
 *
 * The renderer (renderer.ts) runs in a Web Worker on an OffscreenCanvas
 * wherever that's supported, so the sky's per-frame drawing (up to ~1,000
 * star sprites plus a full-screen aurora composite) never competes with the
 * page's own work; elsewhere the same renderer runs on the main thread. This
 * module only watches the page and forwards what changed: size, theme,
 * section, visibility, pointer and scroll.
 *
 * Behavior contracts:
 * - pauses & fades in the photography section (opacity handled in CSS)
 * - `prefers-reduced-motion` → single static frame, no drift/parallax
 * - star color read from the `--star-color` RGB-triple token
 * - the canvas is persisted across ClientRouter swaps (BaseLayout), so the
 *   starfield carries over between pages instead of re-randomizing, and
 *   control is transferred to the worker exactly once
 * - a page opts into observatory mode with <body data-sky="observatory">:
 *   the real sky over the site (star catalogue, Moon, planets, Milky Way,
 *   horizon), pointer lensing, scroll warp, tap-to-launch meteors, tilt
 *   parallax on phones, contrails by day, and shower meteors from their radiant
 * - telemetry: setSkyHud(true) makes the renderer report SkyStats, re-sent
 *   as a `sky:stats` window event
 * - daylight pages: the live weather (weather.ts, loaded only there, hands
 *   each reading over with setSkyWeather) goes to the renderer; the sunlight
 *   it reports back through the clouds is re-sent as `sky:sunlight`
 */
import type { SkyMessage, SkyStats, SkySunlight } from './renderer';
import { activeShower, meteorRate } from './showers';
import { syncClockFromUrl } from './clock';
import type { SkyWeather } from './weather';

declare global {
	interface Window {
		__sky?: SkyController;
	}
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)');

/** Taps on these never launch a meteor. */
const INTERACTIVE =
	'a, button, input, textarea, select, label, summary, [role="button"], [tabindex], [contenteditable], nav, .brand-word, [data-no-sky]';

const clampHalf = (v: number) => Math.min(0.5, Math.max(-0.5, v));

/** The observatory: Research Triangle Park, NC. */
const SITE = { lat: 35.9, lon: -78.86 };

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };
/** iOS gates device orientation behind a permission prompt (from a user gesture). */
const tiltNeedsPermission = () =>
	typeof (globalThis.DeviceOrientationEvent as unknown as OrientationPermission | undefined)?.requestPermission ===
	'function';

/** Reports from the renderer, re-sent as window events: `sky:stats` and `sky:sunlight`. */
const emitReport = (report: SkyStats | SkySunlight) =>
	window.dispatchEvent(
		report.type === 'sunlight'
			? new CustomEvent('sky:sunlight', { detail: report.value })
			: new CustomEvent('sky:stats', { detail: report })
	);

/** Module workers and transferable canvases, detected without spawning a worker. */
function workerCanvasSupported() {
	if (typeof Worker === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false;
	let moduleWorkers = false;
	try {
		// The options bag is read before the (deliberately invalid) URL is parsed.
		new Worker('http://[', {
			get type() {
				moduleWorkers = true;
				return 'module' as const;
			},
		});
	} catch {
		/* expected: invalid URL */
	}
	return moduleWorkers;
}

class SkyController {
	private send: (msg: SkyMessage, transfer?: Transferable[]) => void = () => {};
	private inWorker = false;
	private backendReady = false;
	private canvas: HTMLCanvasElement | null = null;
	private night = false;
	private photo = false;
	private frame = 0;
	private pointer: { x: number; y: number; fine: boolean } | null = null;
	private scrollTop: number | null = null;
	private observatory = false;
	private tapStart: { x: number; y: number; t: number } | null = null;
	private tiltOn = false;
	private tiltBase: { beta: number; gamma: number } | null = null;
	private lastW = 0;
	private lastH = 0;

	constructor() {
		// Theme and section live on <html>, which survives every swap; only
		// changes that alter the sky are forwarded (not anim-ready etc.).
		new MutationObserver(this.syncTheme).observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-section'],
		});
		document.addEventListener('visibilitychange', this.syncActive);
		window.addEventListener('resize', this.queueResize, { passive: true });
		// <body> is the scroll container and is replaced on every swap; a
		// capturing document listener outlives them all.
		document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
		if (!reducedMotion) {
			window.addEventListener('pointermove', this.onPointer, { passive: true });
			window.addEventListener('pointerout', this.onPointerOut, { passive: true });
			document.addEventListener('pointerdown', this.onPointerDown, { passive: true });
			document.addEventListener('pointerup', this.onPointerUp, { passive: true });
		}
		document.addEventListener('astro:after-swap', this.bind);
		this.bind();
	}

	private ensureBackend() {
		if (this.backendReady) return;
		this.backendReady = true;
		let worker: Worker | null = null;
		if (workerCanvasSupported()) {
			try {
				worker = new Worker(new URL('./sky.worker.ts', import.meta.url), { type: 'module', name: 'sky' });
			} catch {
				worker = null;
			}
		}
		this.inWorker = !!worker;
		if (worker) {
			this.send = (msg, transfer = []) => worker.postMessage(msg, transfer);
			worker.addEventListener('message', (event: MessageEvent<SkyStats | SkySunlight>) => emitReport(event.data));
		} else {
			// Main-thread fallback: load the renderer only here (the worker
			// bundles its own copy), queueing whatever arrives before it does.
			const queued: SkyMessage[] = [];
			this.send = (msg) => queued.push(msg);
			void import('./renderer').then(({ SkyRenderer }) => {
				const renderer = new SkyRenderer();
				renderer.emit = emitReport;
				queued.forEach((msg) => renderer.handle(msg));
				this.send = (msg) => renderer.handle(msg);
			});
		}
	}

	/** The latest reading, as the sky draws it (kept to re-send on returning to a daylight page). */
	private skyWeather: SkyWeather | null = null;

	weather(sky: SkyWeather | null) {
		this.skyWeather = sky;
		this.syncWeather();
	}

	/** The live weather, on daylight pages only (anywhere else the sky stays clear). */
	private syncWeather() {
		this.send({ type: 'weather', weather: 'daylight' in document.body.dataset ? this.skyWeather : null });
	}

	/** Public hook (e.g. the 404 page fires one on load). */
	meteor() {
		this.send({ type: 'meteor' });
	}

	strike(from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
		this.send({ type: 'strike', from, to, duration });
	}

	burst(x: number, y: number) {
		this.send({ type: 'burst', x, y });
	}

	launch(x: number, y: number) {
		this.send({ type: 'launch', x, y });
	}

	drop(x: number, y: number, width: number, duration: number) {
		this.send({ type: 'drop', x, y, width, duration });
	}

	hud(on: boolean) {
		this.send({ type: 'hud', on });
	}

	lapse(kind: 'dawn' | 'dusk', duration: number) {
		this.send({ type: 'lapse', kind, duration });
	}

	get thread() {
		return this.inWorker ? 'worker' : 'main';
	}

	get tilting() {
		return this.tiltOn;
	}

	/** Turn on tilt parallax; on iOS this must run inside a tap handler. */
	async enableTilt() {
		if (reducedMotion || !('DeviceOrientationEvent' in window)) return false;
		if (tiltNeedsPermission()) {
			const request = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission!;
			if ((await request().catch(() => 'denied')) !== 'granted') return false;
		}
		if (!this.tiltOn) {
			this.tiltOn = true;
			window.addEventListener('deviceorientation', this.onTilt);
		}
		return true;
	}

	private canvasSize() {
		const c = this.canvas;
		return {
			width: c?.clientWidth || window.innerWidth,
			height: Math.max(c?.clientHeight || 0, window.innerHeight),
		};
	}

	private bind = () => {
		const night = document.documentElement.classList.contains('theme-dark');
		const photo = document.documentElement.dataset.section === 'photography';
		this.observatory = document.body.dataset.sky === 'observatory';
		if (photo && !this.backendReady) {
			this.night = night;
			this.photo = photo;
			return;
		}
		this.ensureBackend();
		const canvas = document.querySelector<HTMLCanvasElement>('.twinkling-stars');
		if (canvas && canvas !== this.canvas) {
			// First load, or a page that didn't carry the persisted canvas.
			this.canvas = canvas;
			this.night = night;
			this.photo = photo;
			const size = this.canvasSize();
			this.lastW = size.width;
			this.lastH = size.height;
			const target = this.inWorker ? canvas.transferControlToOffscreen() : canvas;
			// The GPU star layer's canvas (observatory pages draw on it); persisted alongside.
			const glElement = document.querySelector<HTMLCanvasElement>('.sky-gl');
			const glTarget = glElement && this.inWorker ? glElement.transferControlToOffscreen() : glElement;
			this.send(
				{
					type: 'attach',
					canvas: target,
					glCanvas: glTarget ?? undefined,
					width: this.lastW,
					height: this.lastH,
					dpr: window.devicePixelRatio || 1,
					night: this.night,
					starColor: this.starColor(),
					active: this.isActive(),
					reducedMotion,
				},
				this.inWorker ? [target as OffscreenCanvas, ...(glTarget ? [glTarget as OffscreenCanvas] : [])] : []
			);
		} else {
			this.syncTheme();
		}
		this.scrollTop = null;
		this.send({ type: 'scroll', top: document.body.scrollTop || window.scrollY, snap: true });
		this.send({
			type: 'mode',
			observatory: this.observatory,
			pace: document.body.dataset.skyPace === 'calm' ? 'calm' : 'lively',
			daylight: 'daylight' in document.body.dataset,
			clockOffset: syncClockFromUrl(),
			meteorRate: this.observatory ? meteorRate() : 1,
			shower: this.observatory ? activeShower() : null,
			site: SITE,
		});
		this.syncWeather();
		// Phones get tilt parallax in place of the pointer — automatically
		// wherever no permission prompt is needed (iOS asks via enableTilt()).
		if (this.observatory && coarsePointer.matches && !tiltNeedsPermission()) void this.enableTilt();
		this.queue();
	};

	private starColor() {
		return getComputedStyle(document.documentElement).getPropertyValue('--star-color').trim() || '255, 255, 255';
	}

	private isActive() {
		return !document.hidden && !this.photo;
	}

	private syncTheme = () => {
		const night = document.documentElement.classList.contains('theme-dark');
		const photo = document.documentElement.dataset.section === 'photography';
		if (!this.backendReady) {
			if (!photo) this.bind();
			return;
		}
		if (night === this.night && photo === this.photo) return;
		this.night = night;
		if (photo !== this.photo) {
			this.photo = photo;
			this.send({ type: 'active', active: this.isActive() });
		}
		this.send({ type: 'theme', night, starColor: this.starColor() });
	};

	private syncActive = () => {
		if (this.backendReady) this.send({ type: 'active', active: this.isActive() });
	};

	private resizePending = false;
	private queueResize = () => {
		if (!this.backendReady) return;
		const { width, height } = this.canvasSize();
		// On touch devices, height-only changes are browser toolbars/keyboards
		// collapsing or expanding; the canvas is sized to 100lvh so it stays fixed.
		if (width === this.lastW && (coarsePointer.matches || height === this.lastH)) return;
		this.resizePending = true;
		this.queue();
	};

	private onScroll = (event: Event) => {
		if (!this.backendReady || this.photo) return;
		if (event.target !== document.body && event.target !== document) return;
		// Forward scroll immediately rather than waiting for main-thread rAF so
		// the worker has the latest scrollTop before its own frame tick.
		this.send({ type: 'scroll', top: document.body.scrollTop || window.scrollY });
	};

	private onPointer = (event: PointerEvent) => {
		if (!this.backendReady || this.photo) return;
		// Touch gestures are for scrolling/tapping, never hover parallax; phones use tilt.
		if (event.pointerType === 'touch' || (this.tiltOn && event.pointerType !== 'mouse')) return;
		this.pointer = {
			x: event.clientX / Math.max(1, window.innerWidth) - 0.5,
			y: event.clientY / Math.max(1, window.innerHeight) - 0.5,
			fine: event.pointerType === 'mouse',
		};
		this.queue();
	};

	/** Leaving the window drops the lens. */
	private onPointerOut = (event: PointerEvent) => {
		if (!event.relatedTarget) this.send({ type: 'pointer-out' });
	};

	/** A quick, still tap on the sky (not on anything interactive) launches a meteor from it. */
	private onPointerDown = (event: PointerEvent) => {
		this.tapStart = event.isPrimary ? { x: event.clientX, y: event.clientY, t: event.timeStamp } : null;
	};

	private onPointerUp = (event: PointerEvent) => {
		const start = this.tapStart;
		this.tapStart = null;
		if (!start || !this.observatory || this.photo) return;
		if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8 || event.timeStamp - start.t > 450) return;
		if ((event.target as Element | null)?.closest?.(INTERACTIVE)) return;
		if (window.getSelection()?.toString()) return;
		this.send({ type: 'launch', x: event.clientX, y: event.clientY });
	};

	private onTilt = (event: DeviceOrientationEvent) => {
		if (!this.observatory || event.beta == null || event.gamma == null) return;
		const base = (this.tiltBase ??= { beta: event.beta, gamma: event.gamma });
		// Drift the neutral pose toward however the phone is being held.
		base.beta += (event.beta - base.beta) * 0.01;
		base.gamma += (event.gamma - base.gamma) * 0.01;
		this.pointer = {
			x: clampHalf((event.gamma - base.gamma) / 40),
			y: clampHalf((event.beta - base.beta) / 40),
			fine: false,
		};
		this.queue();
	};

	/** At most one round of messages per frame, and only while things change. */
	private queue() {
		this.frame ||= requestAnimationFrame(this.flush);
	}

	private flush = () => {
		this.frame = 0;
		if (this.resizePending) {
			this.resizePending = false;
			const { width, height } = this.canvasSize();
			this.lastW = width;
			this.lastH = height;
			this.send({ type: 'resize', width: this.lastW, height: this.lastH, dpr: window.devicePixelRatio || 1 });
		}
		if (this.pointer) {
			this.send({ type: 'pointer', ...this.pointer });
			this.pointer = null;
		}
		if (this.scrollTop !== null) {
			this.send({ type: 'scroll', top: this.scrollTop });
			this.scrollTop = null;
		}
	};
}

/** Fire a meteor on demand (dark mode only; used by the 404 page). */
export function spawnMeteor() {
	window.__sky?.meteor();
}

/**
 * Fire an aimed meteor between two viewport points, arriving after `duration`
 * seconds — the caller times its own impact effect to match. Works in both
 * themes (violet by day); a no-op under reduced motion or off the main site.
 */
export function strikeMeteor(from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
	window.__sky?.strike(from, to, duration);
}

/** Impact sparks at a viewport point. */
export function burstSparks(x: number, y: number) {
	window.__sky?.burst(x, y);
}

/**
 * Light sky: condense a cloud `width` px wide centred on a viewport point
 * over `duration` seconds; it rains a few drops, then evaporates.
 */
export function dropFromCloud(at: { x: number; y: number }, width: number, duration: number) {
	window.__sky?.drop(at.x, at.y, width, duration);
}

/** A meteor launched from a viewport point (observatory pages; both themes). */
export function launchMeteor(x: number, y: number) {
	window.__sky?.launch(x, y);
}

/** Daylight pages: a new weather reading (weather.ts), as the sky should draw it. */
export function setSkyWeather(sky: SkyWeather | null) {
	window.__sky?.weather(sky);
}

/**
 * Daylight pages, on a theme switch: replay the morning sky ('dawn') or bring
 * the stars out ('dusk') over `duration` seconds (ThemeToggle's sweep).
 */
export function skyLapse(kind: 'dawn' | 'dusk', duration: number) {
	window.__sky?.lapse(kind, duration);
}

/** Telemetry on/off: the renderer reports as `sky:stats` window events. */
export function setSkyHud(on: boolean) {
	window.__sky?.hud(on);
}

export const skyThread = () => window.__sky?.thread ?? 'main';
export const skyTilting = () => window.__sky?.tilting ?? false;
export const skyTiltNeedsPermission = tiltNeedsPermission;
export const enableSkyTilt = () => window.__sky?.enableTilt() ?? Promise.resolve(false);

if (!window.__sky) {
	window.__sky = new SkyController();
}
