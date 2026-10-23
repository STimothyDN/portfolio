/**
 * Ambient sky renderer — the star/cloud canvas behind the main site.
 *
 * DOM-free on purpose: it runs inside a Web Worker on an OffscreenCanvas
 * (sky.worker.ts) so its per-frame drawing never competes with the page, or
 * on the main thread where that's unsupported (index.ts). All page state —
 * size, theme, visibility, pointer, scroll — arrives as SkyMessages.
 *
 * Dark (space): three-depth twinkling starfield with pointer + scroll
 * parallax, a slow-drifting aurora band (composited with `screen`), and
 * occasional meteors. Light (clouds): depth-layered drifting clouds with the
 * same gentle pointer parallax, plus the top-left sun glow.
 *
 * Observatory mode (pages that opt in via `mode`): the random starfield is
 * replaced by the real sky over the site (realsky.ts, loaded on demand: the
 * Bright Star Catalogue, Moon, planets, Milky Way, horizon); the pointer
 * lenses nearby stars like a gravity well; scroll velocity streaks them into
 * warp trails; taps launch meteors; an active shower's meteors fly out from
 * its real radiant; by day the glow sits at the real Sun and planes leave
 * contrails (daylight.ts).
 *
 * - inactive (hidden tab / photography section) → paused and cleared
 * - reduced motion → single static frame, no drift/parallax
 * - DPR capped at 2, night frames capped at 30fps / day at 18fps
 */
import { Daylight } from './daylight';
import { type Ctx2D, type SkyCanvas, context2d, createSurface } from './surface';
import type { DrawStar, RealSky, RealSkyStats, StarSprite } from './realsky';

export type { SkyCanvas };

export type SkyMessage =
	| {
			type: 'attach';
			canvas: SkyCanvas;
			width: number;
			height: number;
			dpr: number;
			night: boolean;
			starColor: string;
			active: boolean;
			reducedMotion: boolean;
	  }
	| { type: 'resize'; width: number; height: number; dpr: number }
	| { type: 'theme'; night: boolean; starColor: string }
	| { type: 'active'; active: boolean }
	/**
	 * Observatory effects on/off; the meteor-rate multiplier (shower calendar);
	 * the active shower's radiant (degrees) and extra rate at full strength;
	 * the observing site.
	 */
	| {
			type: 'mode';
			observatory: boolean;
			meteorRate: number;
			shower?: ActiveShower | null;
			site?: { lat: number; lon: number };
	  }
	/** Pointer position, normalized to -0.5…0.5 across the viewport; `fine` = a mouse (lens-capable). */
	| { type: 'pointer'; x: number; y: number; fine?: boolean }
	| { type: 'pointer-out' }
	/** Scroll position, and the page's maximum (the real sky lowers its gaze as you go). */
	| { type: 'scroll'; top: number; max?: number }
	| { type: 'meteor' }
	/** Aimed meteor (viewport px) that arrives at `to` after `duration` seconds. */
	| { type: 'strike'; from: Point; to: Point; duration: number }
	/** Impact sparks at a viewport point. */
	| { type: 'burst'; x: number; y: number }
	/** A meteor launched from a tapped point. */
	| { type: 'launch'; x: number; y: number }
	/** Day: a cloud of `width` px condenses centred on (x, y) over `duration` seconds. */
	| { type: 'drop'; x: number; y: number; width: number; duration: number }
	/** Start/stop posting SkyStats twice a second. */
	| { type: 'hud'; on: boolean };

export type SkyStats = {
	type: 'stats';
	fps: number;
	/** Average draw cost per rendered frame, ms. */
	frameMs: number;
	capFps: number;
	stars: number;
	meteors: number;
	planes: number;
	night: boolean;
	observatory: boolean;
	meteorRate: number;
	width: number;
	height: number;
	dpr: number;
	shower: string | null;
	realSky: RealSkyStats | null;
};

export type ActiveShower = { name: string; ra: number; dec: number; extra: number };

type Point = { x: number; y: number };

type Star = {
	x: number;
	y: number;
	depth: number;
	spriteIndex: number;
	baseAlpha: number;
	alphaRange: number;
	minAlpha: number;
	phase: number;
	twinkleSpeed: number;
};

type Meteor = {
	/** Where it lit up: the tail never reaches back past this. */
	ox: number;
	oy: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	speed: number;
	length: number;
	age: number;
	maxAge: number;
};

/** Aimed meteor. `fade` (tap launches) decelerates and burns out instead of hitting. */
type Strike = { from: Point; to: Point; age: number; duration: number; fade?: boolean };

type Spark = { x: number; y: number; vx: number; vy: number; age: number; maxAge: number; size: number };

type Sprite = { canvas: SkyCanvas; width: number; height: number };

type Cloud = {
	x: number;
	y: number;
	depth: number;
	sprite: Sprite;
	speed: number;
	phase: number;
};


const STAR_DENSITY = 1000 / (1440 * 900);
const MIN_STARS = 280;
const MAX_STARS = 1000;
const MAX_DPR = 2;
const TARGET_FRAME_MS = 1000 / 30;
const DAY_TARGET_FRAME_MS = 1000 / 18;
/** Strikes and sparks move tens of px per frame; run them at full rate. */
const FAST_FRAME_MS = 1000 / 60;
/** Daytime strikes can't be white-on-white: they borrow the aurora violet. */
const DAY_STRIKE_COLOR = '124, 58, 237';
const STRIKE_TAIL = 210;
const SPARK_GRAVITY = 900;
const METEORS_PER_SECOND = 0.35;
const MAX_METEORS = 1;
const PERIMETER_OFFSET = 24;
const OUTER_PADDING = 72;
const STAR_SIZES = [0.95, 1.4, 2.15, 3.25, 4.15];
const CLOUD_DENSITY = 1 / (420 * 320);
const MIN_CLOUDS = 4;
const MAX_CLOUDS = 11;
/** Max pointer-parallax shift (px) for the nearest layer. */
const POINTER_PARALLAX = 16;
/** Scroll-parallax rate for the nearest layer (px shifted per px scrolled). */
const SCROLL_PARALLAX = 0.08;
/** Gravity-well lens around the pointer (observatory): radius and max push, px. */
const LENS_RADIUS = 180;
const LENS_PUSH = 34;
/** Warp trails (observatory): px of streak per px/s of scroll, and the cap. */
const WARP_SHUTTER = 0.014;
const WARP_MAX = 70;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

// Workers get rAF in every engine that gives them OffscreenCanvas; the
// timeout fallback is just a safety net (frames are capped at 30fps anyway).
const nextFrame: (cb: (now: number) => void) => number =
	typeof requestAnimationFrame === 'function'
		? (cb) => requestAnimationFrame(cb)
		: (cb) => setTimeout(() => cb(performance.now()), TARGET_FRAME_MS) as unknown as number;
const cancelFrame: (id: number) => void =
	typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

export class SkyRenderer {
	private canvas: SkyCanvas | null = null;
	private ctx: Ctx2D | null = null;
	private stars: Star[] = [];
	private meteors: Meteor[] = [];
	private strikes: Strike[] = [];
	private sparks: Spark[] = [];
	private clouds: Cloud[] = [];
	private starSprites: StarSprite[] = [];
	private sunlightSprite: Sprite | null = null;
	private auroraSprite: Sprite | null = null;
	private rafId = 0;
	private width = 0;
	private height = 0;
	private dpr = 1;
	private lastFrame = 0;
	private night = true;
	private starColor = '255, 255, 255';
	private active = false;
	private reducedMotion = false;
	private scrollTop = 0;
	// Pointer parallax: target follows the pointer, current lerps toward it.
	private pointerTargetX = 0;
	private pointerTargetY = 0;
	private pointerX = 0;
	private pointerY = 0;
	// Observatory mode.
	private observatory = false;
	private meteorRate = 1;
	private lensOn = false;
	private lensAmount = 0;
	private lensX = 0;
	private lensY = 0;
	private warp = 0;
	private lastScrollTop = 0;
	private daylight = new Daylight();
	private shower: ActiveShower | null = null;
	private site = { lat: 35.9, lon: -78.86 };
	private realSky: RealSky | null = null;
	private realSkyLoading = false;
	private scrollMax = 0;
	// Per-frame lens/warp state for drawStarPoint.
	private lensPx = 0;
	private lensPy = 0;
	private warpNow = 0;
	private radiantPt: Point = { x: 0, y: 0 };
	private sunPt: Point = { x: 0, y: 0 };
	// Telemetry.
	private hud = false;
	private statFrames = 0;
	private statCost = 0;
	private statSince = 0;
	/** Where stats go: the worker posts them, the main-thread fallback dispatches them. */
	emit: ((stats: SkyStats) => void) | null = null;

	handle(msg: SkyMessage) {
		switch (msg.type) {
			case 'attach':
				this.night = msg.night;
				this.starColor = msg.starColor;
				this.active = msg.active;
				this.reducedMotion = msg.reducedMotion;
				this.attach(msg.canvas, msg.width, msg.height, msg.dpr);
				break;
			case 'resize':
				this.fit(msg.width, msg.height, msg.dpr, false);
				this.drawStaticFrame();
				break;
			case 'theme':
				this.night = msg.night;
				if (msg.starColor !== this.starColor) {
					this.starColor = msg.starColor;
					this.createStarSprites();
				}
				this.sync();
				break;
			case 'active':
				this.active = msg.active;
				this.sync();
				break;
			case 'mode':
				this.observatory = msg.observatory;
				this.meteorRate = Math.max(0, msg.meteorRate);
				this.shower = msg.shower ?? null;
				if (msg.site) this.site = msg.site;
				if (!this.observatory) this.lensOn = false;
				if (this.observatory) this.loadRealSky();
				this.realSky?.setRadiant(this.shower);
				this.drawStaticFrame();
				break;
			case 'pointer':
				this.pointerTargetX = msg.x;
				this.pointerTargetY = msg.y;
				this.lensOn = this.observatory && !!msg.fine;
				break;
			case 'pointer-out':
				this.lensOn = false;
				break;
			case 'scroll':
				this.scrollTop = msg.top;
				if (msg.max !== undefined) this.scrollMax = msg.max;
				break;
			case 'meteor':
				if (this.ctx && this.night && this.active && !this.reducedMotion) this.spawnMeteor();
				break;
			case 'strike':
				if (this.ctx && this.active && !this.reducedMotion) {
					this.strikes.push({ from: msg.from, to: msg.to, age: 0, duration: Math.max(0.1, msg.duration) });
				}
				break;
			case 'burst':
				if (this.ctx && this.active && !this.reducedMotion) this.spawnSparks(msg.x, msg.y);
				break;
			case 'launch':
				if (this.ctx && this.active && !this.reducedMotion) this.launch(msg.x, msg.y);
				break;
			case 'drop':
				if (this.ctx && this.active && !this.reducedMotion && !this.night) {
					const width = Math.max(80, msg.width);
					this.daylight.startDrop(this.createCloudSprite(width, width * 0.42, 0.88), msg.x, msg.y, msg.duration);
				}
				break;
			case 'hud':
				this.hud = msg.on;
				this.statFrames = 0;
				this.statCost = 0;
				this.statSince = performance.now();
				break;
		}
	}

	private attach(canvas: SkyCanvas, width: number, height: number, dpr: number) {
		this.stop();
		this.canvas = canvas;
		this.ctx = context2d(canvas);
		this.meteors = [];
		this.fit(width, height, dpr, true);
		this.sync();
	}

	/** Run, freeze on a static frame, or pause and clear, per the page's state. */
	private sync() {
		if (!this.ctx || !this.active) {
			this.stop();
			this.clear();
			this.strikes = [];
			this.sparks = [];
			this.daylight.clear();
			return;
		}
		if (this.reducedMotion) {
			this.stop();
			this.drawStaticFrame();
			return;
		}
		this.start();
	}

	private start() {
		if (this.rafId) return;
		this.lastFrame = performance.now();
		this.rafId = nextFrame(this.tick);
	}

	private stop() {
		if (!this.rafId) return;
		cancelFrame(this.rafId);
		this.rafId = 0;
	}

	private fit(width: number, height: number, dpr: number, forceRebuild: boolean) {
		if (!this.canvas || !this.ctx) return;

		const nextWidth = Math.max(1, Math.ceil(width));
		const nextHeight = Math.max(1, Math.ceil(height));
		const nextDpr = clamp(dpr || 1, 1, MAX_DPR);
		const sizeChanged = nextWidth !== this.width || nextHeight !== this.height || nextDpr !== this.dpr;

		if (!sizeChanged && !forceRebuild) return;

		this.width = nextWidth;
		this.height = nextHeight;
		this.dpr = nextDpr;
		this.canvas.width = Math.ceil(nextWidth * nextDpr);
		this.canvas.height = Math.ceil(nextHeight * nextDpr);
		this.ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
		this.createStarSprites();
		this.realSky?.setDpr(nextDpr);
		this.createSunlightSprite();
		this.createAuroraSprite();
		this.reconcileStars(forceRebuild);
		this.reconcileClouds(forceRebuild || sizeChanged);
	}

	private reconcileStars(forceRebuild: boolean) {
		const targetCount = clamp(Math.round(this.width * this.height * STAR_DENSITY), MIN_STARS, MAX_STARS);

		if (forceRebuild) {
			this.stars = [];
		}

		if (this.stars.length > targetCount) {
			this.stars.length = targetCount;
		}

		while (this.stars.length < targetCount) {
			this.stars.push(this.createStar());
		}
	}

	private createStar(): Star {
		const depth = Math.pow(Math.random(), 2.75);
		const depthGlow = Math.pow(depth, 1.3);

		return {
			x: Math.random(),
			y: Math.random(),
			depth,
			spriteIndex: clamp(Math.floor(depth * STAR_SIZES.length), 0, STAR_SIZES.length - 1),
			baseAlpha: clamp(randomBetween(0.025, 0.11) + depthGlow * 0.9, 0.02, 0.98),
			alphaRange: randomBetween(0.04, 0.13) + depth * 0.34,
			minAlpha: 0.01 + depth * 0.09,
			phase: randomBetween(0, Math.PI * 2),
			twinkleSpeed: randomBetween(0.35, 0.95 + depth * 1.9) * (Math.random() < 0.5 ? -1 : 1),
		};
	}

	private createStarSprites() {
		this.starSprites = STAR_SIZES.map((size) => {
			const glowRadius = size * 0.95 + 1.15;
			const logicalSize = glowRadius * 2;
			const canvas = createSurface(Math.ceil(logicalSize * this.dpr), Math.ceil(logicalSize * this.dpr));
			const ctx = context2d(canvas)!;
			ctx.scale(this.dpr, this.dpr);

			const center = logicalSize / 2;
			const coreRadius = Math.max(0.28, size * 0.16);
			const gradient = ctx.createRadialGradient(center, center, coreRadius, center, center, glowRadius);
			gradient.addColorStop(0, `rgba(${this.starColor}, 1)`);
			gradient.addColorStop(0.24, `rgba(${this.starColor}, 0.82)`);
			gradient.addColorStop(0.58, `rgba(${this.starColor}, 0.24)`);
			gradient.addColorStop(1, `rgba(${this.starColor}, 0)`);

			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(center, center, glowRadius, 0, Math.PI * 2);
			ctx.fill();

			ctx.fillStyle = `rgba(${this.starColor}, 0.92)`;
			ctx.beginPath();
			ctx.arc(center, center, coreRadius, 0, Math.PI * 2);
			ctx.fill();

			return { canvas, size: logicalSize };
		});
	}

	/**
	 * Aurora band: large pre-blurred violet/indigo blobs rendered once to an
	 * offscreen surface, drawn with `screen` compositing and a very slow
	 * sinusoidal drift. Hues match the accent ramp (310/284).
	 */
	private createAuroraSprite() {
		const w = Math.max(1, this.width);
		const h = Math.max(1, Math.round(this.height * 0.8));
		const spriteDpr = Math.min(this.dpr, 1.5);
		const canvas = createSurface(Math.ceil(w * spriteDpr), Math.ceil(h * spriteDpr));
		const ctx = context2d(canvas)!;
		ctx.scale(spriteDpr, spriteDpr);

		const blobs = [
			{ x: 0.22, y: 0.18, rx: 0.42, ry: 0.3, color: '124, 58, 237', alpha: 0.09 },
			{ x: 0.72, y: 0.34, rx: 0.4, ry: 0.26, color: '76, 17, 198', alpha: 0.1 },
			{ x: 0.5, y: 0.08, rx: 0.3, ry: 0.2, color: '197, 97, 246', alpha: 0.05 },
		];

		for (const blob of blobs) {
			const cx = w * blob.x;
			const cy = h * blob.y;
			const r = Math.max(w * blob.rx, h * blob.ry);
			const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			gradient.addColorStop(0, `rgba(${blob.color}, ${blob.alpha})`);
			gradient.addColorStop(0.6, `rgba(${blob.color}, ${blob.alpha * 0.4})`);
			gradient.addColorStop(1, `rgba(${blob.color}, 0)`);
			ctx.fillStyle = gradient;
			ctx.save();
			ctx.translate(cx, cy);
			ctx.scale(1, (h * blob.ry) / r || 1);
			ctx.translate(-cx, -cy);
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		this.auroraSprite = { canvas, width: w, height: h };
	}

	private drawAurora(elapsedSeconds: number) {
		if (!this.ctx || !this.auroraSprite) return;
		const driftX = Math.sin(elapsedSeconds * 0.05) * this.width * 0.05;
		const driftY = Math.cos(elapsedSeconds * 0.037) * this.height * 0.02;
		this.ctx.save();
		this.ctx.globalCompositeOperation = 'screen';
		this.ctx.drawImage(
			this.auroraSprite.canvas,
			driftX - this.width * 0.03,
			driftY - this.height * 0.04,
			this.auroraSprite.width * 1.1,
			this.auroraSprite.height
		);
		this.ctx.restore();
	}

	private randomPerimeterPoint() {
		const side = Math.floor(Math.random() * 4);

		if (side === 0) return { x: Math.random() * this.width, y: -PERIMETER_OFFSET };
		if (side === 1) return { x: this.width + PERIMETER_OFFSET, y: Math.random() * this.height };
		if (side === 2) return { x: Math.random() * this.width, y: this.height + PERIMETER_OFFSET };
		return { x: -PERIMETER_OFFSET, y: Math.random() * this.height };
	}

	/** The real sky, while this page is in observatory mode and it has loaded. */
	private get sky() {
		return this.observatory ? this.realSky : null;
	}

	private loadRealSky() {
		if (this.realSky || this.realSkyLoading) return;
		this.realSkyLoading = true;
		void import('./realsky').then(({ RealSky }) => {
			this.realSky = new RealSky(this.site.lat, this.site.lon);
			this.realSky.setDpr(this.dpr);
			this.realSky.setRadiant(this.shower);
			this.drawStaticFrame();
		});
	}

	/** With the real sky: sporadic rate plus the shower's, scaled by its radiant's height. */
	private get effectiveMeteorRate() {
		const sky = this.sky;
		if (sky) return 1 + (this.shower ? this.shower.extra * sky.radiantFactor : 0);
		return this.meteorRate;
	}

	private spawnMeteor() {
		const rate = this.effectiveMeteorRate;
		if (this.meteors.length >= Math.max(MAX_METEORS, Math.ceil(rate))) return;
		// Shower members fly out from the radiant; the rest are sporadic.
		if (rate > 1 && Math.random() < (rate - 1) / rate && this.sky?.radiantOnScreen(this.radiantPt)) {
			if (this.spawnShowerMeteor(this.radiantPt.x, this.radiantPt.y)) return;
		}

		const start = this.randomPerimeterPoint();
		let end = this.randomPerimeterPoint();

		while (Math.hypot(end.x - start.x, end.y - start.y) < 120) {
			end = this.randomPerimeterPoint();
		}

		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const angle = Math.atan2(dy, dx);
		const speed = randomBetween(420, 680);

		this.meteors.push({
			ox: start.x,
			oy: start.y,
			x: start.x,
			y: start.y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			speed,
			length: randomBetween(90, 170),
			age: 0,
			maxAge: randomBetween(0.55, 0.9),
		});
	}

	/**
	 * A shower meteor lights up somewhere in view and flies directly away
	 * from the radiant — short near it (foreshortened), long far from it.
	 */
	private spawnShowerMeteor(rx: number, ry: number) {
		for (let tries = 0; tries < 8; tries++) {
			const x = randomBetween(0.05, 0.95) * this.width;
			const y = randomBetween(0.05, 0.8) * this.height;
			const d = Math.hypot(x - rx, y - ry);
			if (d < 70) continue;
			const speed = randomBetween(520, 760);
			this.meteors.push({
				ox: x,
				oy: y,
				x,
				y,
				vx: ((x - rx) / d) * speed,
				vy: ((y - ry) / d) * speed,
				speed,
				length: clamp(d * 0.3, 40, 170),
				age: 0,
				maxAge: randomBetween(0.45, 0.8),
			});
			return true;
		}
		return false;
	}

	private tick = (now: number) => {
		const targetFrameMs = this.capFrameMs;

		if (now - this.lastFrame < targetFrameMs) {
			this.rafId = nextFrame(this.tick);
			return;
		}

		const deltaSeconds = Math.min((now - this.lastFrame) / 1000, 0.05);
		this.lastFrame = now;
		const start = performance.now();
		this.render(deltaSeconds, now / 1000);
		if (this.hud) this.recordFrame(now, performance.now() - start);
		this.rafId = nextFrame(this.tick);
	};

	private get capFrameMs() {
		if (this.strikes.length || this.sparks.length || this.daylight.busy) return FAST_FRAME_MS;
		return this.night ? TARGET_FRAME_MS : DAY_TARGET_FRAME_MS;
	}

	private recordFrame(now: number, cost: number) {
		this.statFrames++;
		this.statCost += cost;
		const elapsed = now - this.statSince;
		if (elapsed < 500) return;
		this.emit?.({
			type: 'stats',
			fps: (this.statFrames * 1000) / elapsed,
			frameMs: this.statCost / this.statFrames,
			capFps: Math.round(1000 / this.capFrameMs),
			stars: this.night ? (this.sky?.stats().stars ?? this.stars.length) : 0,
			meteors: this.meteors.length + this.strikes.length,
			planes: this.daylight.planeCount,
			night: this.night,
			observatory: this.observatory,
			meteorRate: this.effectiveMeteorRate,
			width: this.width,
			height: this.height,
			dpr: this.dpr,
			shower: this.shower?.name ?? null,
			realSky: this.sky?.stats() ?? null,
		});
		this.statFrames = 0;
		this.statCost = 0;
		this.statSince = now;
	}

	private render(deltaSeconds: number, elapsedSeconds: number) {
		if (!this.ctx) return;

		// Ease the pointer offset toward its target for a weighty, lagged feel.
		const lerp = Math.min(1, deltaSeconds * 3.5);
		this.pointerX += (this.pointerTargetX - this.pointerX) * lerp;
		this.pointerY += (this.pointerTargetY - this.pointerY) * lerp;

		if (this.observatory) {
			// The lens tracks the pointer much more tightly than the parallax.
			const follow = Math.min(1, deltaSeconds * 12);
			this.lensX += (this.pointerTargetX - this.lensX) * follow;
			this.lensY += (this.pointerTargetY - this.lensY) * follow;
			this.lensAmount += ((this.lensOn ? 1 : 0) - this.lensAmount) * Math.min(1, deltaSeconds * 4);
			// Scroll velocity (px/s), smoothed so a single jumpy frame can't flash a streak.
			const velocity = deltaSeconds > 0 ? (this.scrollTop - this.lastScrollTop) / deltaSeconds : 0;
			this.warp += (velocity - this.warp) * Math.min(1, deltaSeconds * 10);
		} else {
			this.lensAmount = 0;
			this.warp = 0;
		}
		this.lastScrollTop = this.scrollTop;
		this.lensPx = (this.lensX + 0.5) * this.width;
		this.lensPy = (this.lensY + 0.5) * this.height;
		this.warpNow = Math.abs(this.warp) > 40 ? this.warp : 0;

		this.clear();
		if (!this.night) {
			this.drawDaySky(deltaSeconds, elapsedSeconds);
		} else {
			this.drawAurora(elapsedSeconds);
			if (this.sky) this.drawRealSky(elapsedSeconds);
			else this.drawStars(elapsedSeconds);

			if (Math.random() < METEORS_PER_SECOND * this.effectiveMeteorRate * deltaSeconds) {
				this.spawnMeteor();
			}

			this.updateMeteors(deltaSeconds);
			this.drawMeteors();
		}

		if (!this.night) {
			this.daylight.update(deltaSeconds, this.width, this.height, this.observatory);
			this.daylight.draw(this.ctx);
		}

		this.drawStrikes(deltaSeconds);
		this.drawSparks(deltaSeconds);
	}

	/** Tap-launched meteor: shoots off downward-ish from the point and burns out. */
	private launch(x: number, y: number) {
		const angle = (Math.random() < 0.5 ? randomBetween(20, 65) : randomBetween(115, 160)) * (Math.PI / 180);
		const dist = randomBetween(240, 380);
		this.strikes.push({
			from: { x, y },
			to: { x: x + Math.cos(angle) * dist, y: y + Math.sin(angle) * dist },
			age: 0,
			duration: dist / 760,
			fade: true,
		});
		this.spawnSparks(x, y, 6, 0.55);
	}

	/** The colour strikes and sparks are drawn in: starlight by night, violet by day. */
	private get strikeColor() {
		return this.night ? this.starColor : DAY_STRIKE_COLOR;
	}

	private drawStrikes(deltaSeconds: number) {
		if (!this.ctx || !this.strikes.length) return;
		const ctx = this.ctx;
		const color = this.strikeColor;

		ctx.save();
		ctx.lineCap = 'round';
		for (let i = this.strikes.length - 1; i >= 0; i--) {
			const strike = this.strikes[i];
			strike.age += deltaSeconds;
			// Strikes ease in (falling, gathering speed into the hit); launches
			// ease out and burn away.
			const t = clamp(strike.age / strike.duration, 0, 1);
			const p = strike.fade ? 1 - (1 - t) ** 2 : t * (0.55 + 0.45 * t);
			const life = strike.fade ? 1 - t * t : 1;
			const dx = strike.to.x - strike.from.x;
			const dy = strike.to.y - strike.from.y;
			const dist = Math.hypot(dx, dy) || 1;
			const x = strike.from.x + dx * p;
			const y = strike.from.y + dy * p;
			// The tail never reaches back past the launch point.
			const tail = Math.min(STRIKE_TAIL, dist * p);
			const tailX = x - (dx / dist) * tail;
			const tailY = y - (dy / dist) * tail;

			const gradient = ctx.createLinearGradient(x, y, tailX, tailY);
			gradient.addColorStop(0, `rgba(${color}, ${life})`);
			gradient.addColorStop(0.3, `rgba(${color}, ${0.5 * life})`);
			gradient.addColorStop(1, `rgba(${color}, 0)`);
			ctx.shadowBlur = 14;
			ctx.shadowColor = `rgba(${color}, ${0.8 * life})`;
			ctx.lineWidth = 2.6;
			ctx.strokeStyle = gradient;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(tailX, tailY);
			ctx.stroke();

			// Bright head: swells into a hit, dwindles as a launch burns out.
			const headR = strike.fade ? 2 + 5 * (1 - t) : 7 + 5 * t;
			const head = ctx.createRadialGradient(x, y, 0, x, y, headR);
			head.addColorStop(0, `rgba(${color}, ${0.95 * life})`);
			head.addColorStop(1, `rgba(${color}, 0)`);
			ctx.shadowBlur = 0;
			ctx.fillStyle = head;
			ctx.beginPath();
			ctx.arc(x, y, headR, 0, Math.PI * 2);
			ctx.fill();

			if (t >= 1) this.strikes.splice(i, 1);
		}
		ctx.restore();
	}

	private spawnSparks(x: number, y: number, count = 14, power = 1) {
		for (let i = 0; i < count; i++) {
			// Mostly up and outward, like grit kicked off the word.
			const angle = -Math.PI / 2 + randomBetween(-1.25, 1.25);
			const speed = randomBetween(140, 360) * power;
			this.sparks.push({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				age: 0,
				maxAge: randomBetween(0.45, 0.85),
				size: randomBetween(0.9, 2.1),
			});
		}
	}

	private drawSparks(deltaSeconds: number) {
		if (!this.ctx || !this.sparks.length) return;
		const ctx = this.ctx;
		const color = this.strikeColor;

		ctx.save();
		for (let i = this.sparks.length - 1; i >= 0; i--) {
			const spark = this.sparks[i];
			spark.age += deltaSeconds;
			spark.vy += SPARK_GRAVITY * deltaSeconds;
			spark.x += spark.vx * deltaSeconds;
			spark.y += spark.vy * deltaSeconds;
			const life = 1 - spark.age / spark.maxAge;
			if (life <= 0) {
				this.sparks.splice(i, 1);
				continue;
			}
			ctx.globalAlpha = life;
			ctx.fillStyle = `rgba(${color}, 1)`;
			ctx.beginPath();
			ctx.arc(spark.x, spark.y, spark.size * (0.6 + 0.4 * life), 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	private drawStaticFrame() {
		if (!this.ctx || !this.active) return;
		this.clear();
		if (!this.night) {
			this.drawDaySky(0, performance.now() / 1000);
			return;
		}
		this.drawAurora(0);
		if (this.sky) this.drawRealSky(performance.now() / 1000);
		else this.drawStars(performance.now() / 1000);
	}

	private clear() {
		this.ctx?.clearRect(0, 0, this.width, this.height);
	}

	private drawStars(elapsedSeconds: number) {
		if (!this.ctx) return;

		const scrollTop = this.reducedMotion ? 0 : this.scrollTop;

		this.ctx.save();

		for (const star of this.stars) {
			const alpha = clamp(
				star.baseAlpha + Math.sin(star.phase + elapsedSeconds * star.twinkleSpeed) * star.alphaRange,
				star.minAlpha,
				1
			);
			const sprite = this.starSprites[star.spriteIndex];
			if (!sprite) continue;

			// Depth-weighted parallax: nearer (larger) stars shift further.
			const px = this.pointerX * 2 * POINTER_PARALLAX * star.depth;
			const py = this.pointerY * 2 * POINTER_PARALLAX * star.depth;
			const scrollShift = scrollTop * SCROLL_PARALLAX * star.depth;
			// Wrap vertically so scrolled-off stars re-enter from the other edge.
			const yBase = (((star.y * this.height - scrollShift) % this.height) + this.height) % this.height;
			this.drawStarPoint(star.x * this.width + px, yBase + py, sprite, alpha, star.depth);
		}

		this.ctx.restore();
	}

	/**
	 * One star at its centre (cx, cy), through the observatory effects: the
	 * gravity-well lens pushes stars near the pointer outward (hardest closest
	 * in, leaving a small dark core) and magnifies them; warp streaks them
	 * along the scroll, trailing where they came from (scrolling down moves
	 * the sky up, so the trail hangs below). Both are off outside observatory.
	 */
	private drawStarPoint: DrawStar = (cx, cy, sprite, alpha, depth) => {
		const ctx = this.ctx!;
		if (this.lensAmount > 0.01) {
			const dx = cx - this.lensPx;
			const dy = cy - this.lensPy;
			const d2 = dx * dx + dy * dy;
			if (d2 < LENS_RADIUS * LENS_RADIUS) {
				const d = Math.sqrt(d2) || 0.001;
				const f = 1 - d / LENS_RADIUS;
				const push = LENS_PUSH * f * f * this.lensAmount;
				cx += (dx / d) * push;
				cy += (dy / d) * push;
				alpha = Math.min(1, alpha * (1 + 0.8 * f * this.lensAmount));
			}
		}

		const x = cx - sprite.size / 2;
		const y = cy - sprite.size / 2;
		const warp = this.warpNow;
		const streak = warp ? Math.min(WARP_MAX, Math.abs(warp) * WARP_SHUTTER * (0.15 + depth)) : 0;
		if (streak > 1.5) {
			ctx.globalAlpha = alpha * (1 - Math.min(0.6, streak / 120));
			ctx.drawImage(sprite.canvas, x, warp > 0 ? y : y - streak, sprite.size, sprite.size + streak);
		} else {
			ctx.globalAlpha = alpha;
			ctx.drawImage(sprite.canvas, x, y, sprite.size, sprite.size);
		}
	};

	/** Where the real sky is looking: down the page lowers the gaze; the pointer looks around. */
	private aimRealSky(sky: RealSky) {
		sky.update(Date.now());
		const progress = this.reducedMotion || this.scrollMax <= 0 ? 0 : clamp(this.scrollTop / this.scrollMax, 0, 1);
		sky.setView(this.width, this.height, progress, this.pointerX, this.pointerY);
	}

	private drawRealSky(elapsedSeconds: number) {
		const sky = this.sky;
		if (!this.ctx || !sky) return;
		this.aimRealSky(sky);
		sky.drawMilkyWay(this.ctx);
		this.ctx.save();
		sky.drawStars(elapsedSeconds, this.drawStarPoint);
		this.ctx.restore();
		sky.drawPlanets(this.ctx);
		sky.drawMoon(this.ctx);
		sky.drawHorizon(this.ctx);
	}

	private reconcileClouds(forceRebuild: boolean) {
		const targetCount = clamp(Math.round(this.width * this.height * CLOUD_DENSITY), MIN_CLOUDS, MAX_CLOUDS);

		if (forceRebuild) {
			this.clouds = [];
		}

		if (this.clouds.length > targetCount) {
			this.clouds.length = targetCount;
		}

		while (this.clouds.length < targetCount) {
			this.clouds.push(this.createCloud(true));
		}
	}

	private createCloud(spreadAcrossViewport = false): Cloud {
		// Two depth layers: far clouds are smaller, slower, fainter.
		const depth = Math.random() < 0.45 ? randomBetween(0.35, 0.6) : randomBetween(0.75, 1);
		const width = randomBetween(160, 390) * clamp(this.width / 1180, 0.78, 1.28) * depth;
		const height = width * randomBetween(0.28, 0.44);
		const sprite = this.createCloudSprite(width, height, randomBetween(0.18, 0.34) * clamp(depth + 0.25, 0.5, 1));
		const topSkyLimit = Math.min(this.height * 0.36, 330);
		const upperSkyY = randomBetween(this.height * 0.035, topSkyLimit);
		const lowerSkyY = randomBetween(topSkyLimit, Math.min(this.height * 0.58, topSkyLimit + 170));

		return {
			x: spreadAcrossViewport
				? randomBetween(-width * 1.2, this.width + width * 1.2)
				: this.width + randomBetween(24, this.width * 0.34 + width),
			y: Math.random() < 0.82 ? upperSkyY : lowerSkyY,
			depth,
			sprite,
			speed: randomBetween(4, 15) * clamp(this.width / 1180, 0.75, 1.2) * depth,
			phase: randomBetween(0, Math.PI * 2),
		};
	}

	private createCloudSprite(width: number, height: number, alpha: number): Sprite {
		const padding = 28;
		const logicalWidth = width + padding * 2;
		const logicalHeight = height + padding * 2;
		const spriteDpr = Math.min(this.dpr, 1.5);
		const canvas = createSurface(Math.ceil(logicalWidth * spriteDpr), Math.ceil(logicalHeight * spriteDpr));
		const ctx = context2d(canvas)!;
		const puffs = [
			{ x: 0.16, y: 0.58, w: 0.36, h: 0.42 },
			{ x: 0.34, y: 0.42, w: 0.42, h: 0.56 },
			{ x: 0.52, y: 0.34, w: 0.46, h: 0.66 },
			{ x: 0.72, y: 0.5, w: 0.38, h: 0.46 },
			{ x: 0.46, y: 0.62, w: 0.72, h: 0.32 },
		];

		ctx.scale(spriteDpr, spriteDpr);

		const x = padding;
		const y = padding;
		const highlight = ctx.createLinearGradient(x, y, x + width, y + height);
		highlight.addColorStop(0, `rgba(255, 255, 255, ${alpha * 1.05})`);
		highlight.addColorStop(0.52, `rgba(255, 255, 255, ${alpha})`);
		highlight.addColorStop(1, `rgba(202, 211, 223, ${alpha * 0.36})`);

		ctx.filter = 'blur(0.45px)';
		ctx.fillStyle = `rgba(117, 132, 154, ${alpha * 0.08})`;
		for (const puff of puffs) {
			ctx.beginPath();
			ctx.ellipse(
				x + width * puff.x + 13,
				y + height * puff.y + 15,
				width * puff.w * 0.5,
				height * puff.h * 0.5,
				0,
				0,
				Math.PI * 2
			);
			ctx.fill();
		}

		ctx.fillStyle = highlight;
		for (const puff of puffs) {
			ctx.beginPath();
			ctx.ellipse(x + width * puff.x, y + height * puff.y, width * puff.w * 0.5, height * puff.h * 0.5, 0, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.filter = 'none';

		return { canvas, width: logicalWidth, height: logicalHeight };
	}

	private drawDaySky(deltaSeconds: number, elapsedSeconds: number) {
		if (!this.ctx) return;

		this.reconcileClouds(false);
		this.meteors = [];
		this.drawSunlight();

		for (const cloud of this.clouds) {
			cloud.x -= cloud.speed * deltaSeconds;
			const drift = Math.sin(elapsedSeconds * 0.16 + cloud.phase) * 5;
			const px = this.pointerX * 2 * POINTER_PARALLAX * 0.6 * cloud.depth;
			const py = this.pointerY * 2 * POINTER_PARALLAX * 0.35 * cloud.depth;
			this.drawCloud(cloud, drift + py, px);

			if (cloud.x + cloud.sprite.width < -OUTER_PADDING) {
				Object.assign(cloud, this.createCloud(false));
			}
		}
	}

	private createSunlightSprite() {
		const canvas = createSurface(Math.ceil(this.width * this.dpr), Math.ceil(this.height * this.dpr));
		const ctx = context2d(canvas)!;
		ctx.scale(this.dpr, this.dpr);

		const sunX = this.width * 0.16;
		const sunY = -this.height * 0.12;
		const radius = Math.max(this.width, this.height) * 0.72;
		const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, radius);

		glow.addColorStop(0, 'rgba(255, 244, 194, 0.18)');
		glow.addColorStop(0.28, 'rgba(255, 230, 166, 0.08)');
		glow.addColorStop(0.72, 'rgba(255, 255, 255, 0.018)');
		glow.addColorStop(1, 'rgba(255, 255, 255, 0)');

		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, this.width, this.height);
		this.sunlightSprite = { canvas, width: this.width, height: this.height };
	}

	private drawSunlight() {
		if (!this.ctx) return;

		// Observatory: the glow sits on the real Sun while it's up and in view.
		const sky = this.sky;
		if (sky) {
			this.aimRealSky(sky);
			if (sky.sunOnScreen(this.sunPt)) {
				const { x, y } = this.sunPt;
				const radius = Math.max(this.width, this.height) * 0.72;
				const glow = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
				glow.addColorStop(0, 'rgba(255, 244, 194, 0.24)');
				glow.addColorStop(0.28, 'rgba(255, 230, 166, 0.1)');
				glow.addColorStop(0.72, 'rgba(255, 255, 255, 0.018)');
				glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
				this.ctx.fillStyle = glow;
				this.ctx.fillRect(0, 0, this.width, this.height);
				return;
			}
		}

		if (!this.sunlightSprite) {
			this.createSunlightSprite();
		}

		this.ctx.drawImage(this.sunlightSprite!.canvas, 0, 0, this.width, this.height);
	}

	private drawCloud(cloud: Cloud, offsetY: number, offsetX = 0) {
		if (!this.ctx) return;

		this.ctx.drawImage(cloud.sprite.canvas, cloud.x + offsetX, cloud.y + offsetY, cloud.sprite.width, cloud.sprite.height);
	}

	private updateMeteors(deltaSeconds: number) {
		for (let i = this.meteors.length - 1; i >= 0; i--) {
			const meteor = this.meteors[i];
			meteor.x += meteor.vx * deltaSeconds;
			meteor.y += meteor.vy * deltaSeconds;
			meteor.age += deltaSeconds;

			if (
				meteor.age >= meteor.maxAge ||
				meteor.x < -OUTER_PADDING ||
				meteor.x > this.width + OUTER_PADDING ||
				meteor.y < -OUTER_PADDING ||
				meteor.y > this.height + OUTER_PADDING
			) {
				this.meteors.splice(i, 1);
			}
		}
	}

	private drawMeteors() {
		if (!this.ctx) return;

		this.ctx.save();
		this.ctx.lineCap = 'round';
		this.ctx.lineWidth = 1.8;
		this.ctx.shadowBlur = 9;
		this.ctx.shadowColor = `rgba(${this.starColor}, 0.55)`;

		for (const meteor of this.meteors) {
			const progress = meteor.age / meteor.maxAge;
			const opacity = clamp(1 - progress, 0, 1);
			// The trail grows from where the meteor lit up, never past it.
			const length = Math.min(meteor.length, Math.hypot(meteor.x - meteor.ox, meteor.y - meteor.oy));
			const tailX = meteor.x - (meteor.vx / meteor.speed) * length;
			const tailY = meteor.y - (meteor.vy / meteor.speed) * length;
			const gradient = this.ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);

			gradient.addColorStop(0, `rgba(${this.starColor}, ${opacity})`);
			gradient.addColorStop(0.35, `rgba(${this.starColor}, ${opacity * 0.42})`);
			gradient.addColorStop(1, `rgba(${this.starColor}, 0)`);

			this.ctx.beginPath();
			this.ctx.moveTo(meteor.x, meteor.y);
			this.ctx.lineTo(tailX, tailY);
			this.ctx.strokeStyle = gradient;
			this.ctx.stroke();
		}

		this.ctx.restore();
	}
}
