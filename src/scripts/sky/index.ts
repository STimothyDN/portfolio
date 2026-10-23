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
 */
import type { SkyMessage, SkyStats } from './renderer';
import { activeShower, meteorRate } from './showers';

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

const emitStats = (stats: SkyStats) => window.dispatchEvent(new CustomEvent('sky:stats', { detail: stats }));

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
	private send: (msg: SkyMessage, transfer?: Transferable[]) => void;
	private readonly inWorker: boolean;
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

	constructor() {
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
			worker.addEventListener('message', (event: MessageEvent<SkyStats>) => emitStats(event.data));
		} else {
			// Main-thread fallback: load the renderer only here (the worker
			// bundles its own copy), queueing whatever arrives before it does.
			const queued: SkyMessage[] = [];
			this.send = (msg) => queued.push(msg);
			void import('./renderer').then(({ SkyRenderer }) => {
				const renderer = new SkyRenderer();
				renderer.emit = emitStats;
				queued.forEach((msg) => renderer.handle(msg));
				this.send = (msg) => renderer.handle(msg);
			});
		}

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

	private bind = () => {
		const canvas = document.querySelector<HTMLCanvasElement>('.twinkling-stars');
		if (canvas && canvas !== this.canvas) {
			// First load, or a page that didn't carry the persisted canvas.
			this.canvas = canvas;
			this.night = document.documentElement.classList.contains('theme-dark');
			this.photo = document.documentElement.dataset.section === 'photography';
			const target = this.inWorker ? canvas.transferControlToOffscreen() : canvas;
			this.send(
				{
					type: 'attach',
					canvas: target,
					width: window.innerWidth,
					height: window.innerHeight,
					dpr: window.devicePixelRatio || 1,
					night: this.night,
					starColor: this.starColor(),
					active: this.isActive(),
					reducedMotion,
				},
				this.inWorker ? [target as OffscreenCanvas] : []
			);
		}
		this.scrollTop = document.body.scrollTop;
		this.observatory = document.body.dataset.sky === 'observatory';
		this.send({
			type: 'mode',
			observatory: this.observatory,
			meteorRate: this.observatory ? meteorRate() : 1,
			shower: this.observatory ? activeShower() : null,
			site: SITE,
		});
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
		if (night === this.night && photo === this.photo) return;
		this.night = night;
		if (photo !== this.photo) {
			this.photo = photo;
			this.send({ type: 'active', active: this.isActive() });
		}
		this.send({ type: 'theme', night, starColor: this.starColor() });
	};

	private syncActive = () => this.send({ type: 'active', active: this.isActive() });

	private resizePending = false;
	private queueResize = () => {
		this.resizePending = true;
		this.queue();
	};

	private onScroll = (event: Event) => {
		if (event.target !== document.body && event.target !== document) return;
		this.scrollTop = document.body.scrollTop;
		this.queue();
	};

	private onPointer = (event: PointerEvent) => {
		// Tilt owns the parallax on phones once it's on.
		if (this.tiltOn && event.pointerType !== 'mouse') return;
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
			this.send({ type: 'resize', width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 });
		}
		if (this.pointer) {
			this.send({ type: 'pointer', ...this.pointer });
			this.pointer = null;
		}
		if (this.scrollTop !== null) {
			const body = document.body;
			this.send({ type: 'scroll', top: this.scrollTop, max: Math.max(0, body.scrollHeight - body.clientHeight) });
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
