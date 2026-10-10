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
 */
import type { SkyMessage } from './renderer';

declare global {
	interface Window {
		__sky?: SkyController;
	}
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
	private pointer: { x: number; y: number } | null = null;
	private scrollTop: number | null = null;

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
		} else {
			// Main-thread fallback: load the renderer only here (the worker
			// bundles its own copy), queueing whatever arrives before it does.
			const queued: SkyMessage[] = [];
			this.send = (msg) => queued.push(msg);
			void import('./renderer').then(({ SkyRenderer }) => {
				const renderer = new SkyRenderer();
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
		if (!reducedMotion) window.addEventListener('pointermove', this.onPointer, { passive: true });
		document.addEventListener('astro:after-swap', this.bind);
		this.bind();
	}

	/** Public hook (e.g. the 404 page fires one on load). */
	meteor() {
		this.send({ type: 'meteor' });
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
		this.pointer = {
			x: event.clientX / Math.max(1, window.innerWidth) - 0.5,
			y: event.clientY / Math.max(1, window.innerHeight) - 0.5,
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
			this.send({ type: 'scroll', top: this.scrollTop });
			this.scrollTop = null;
		}
	};
}

/** Fire a meteor on demand (dark mode only; used by the 404 page). */
export function spawnMeteor() {
	window.__sky?.meteor();
}

if (!window.__sky) {
	window.__sky = new SkyController();
}
