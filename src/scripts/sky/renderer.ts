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
 * - inactive (hidden tab / photography section) → paused and cleared
 * - reduced motion → single static frame, no drift/parallax
 * - DPR capped at 2, night frames capped at 30fps / day at 18fps
 */

export type SkyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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
	/** Pointer position, normalized to -0.5…0.5 across the viewport. */
	| { type: 'pointer'; x: number; y: number }
	| { type: 'scroll'; top: number }
	| { type: 'meteor' };

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
	x: number;
	y: number;
	vx: number;
	vy: number;
	speed: number;
	length: number;
	age: number;
	maxAge: number;
};

type Sprite = { canvas: SkyCanvas; width: number; height: number };

type Cloud = {
	x: number;
	y: number;
	depth: number;
	sprite: Sprite;
	speed: number;
	phase: number;
};

type StarSprite = { canvas: SkyCanvas; size: number };

const STAR_DENSITY = 1000 / (1440 * 900);
const MIN_STARS = 280;
const MAX_STARS = 1000;
const MAX_DPR = 2;
const TARGET_FRAME_MS = 1000 / 30;
const DAY_TARGET_FRAME_MS = 1000 / 18;
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

/** Sprite surfaces: OffscreenCanvas wherever it exists (always, in a worker). */
function createSurface(width: number, height: number): SkyCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

const context2d = (canvas: SkyCanvas) => canvas.getContext('2d') as Ctx2D | null;

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
			case 'pointer':
				this.pointerTargetX = msg.x;
				this.pointerTargetY = msg.y;
				break;
			case 'scroll':
				this.scrollTop = msg.top;
				break;
			case 'meteor':
				if (this.ctx && this.night && this.active && !this.reducedMotion) this.spawnMeteor();
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

	private spawnMeteor() {
		if (this.meteors.length >= MAX_METEORS) return;

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

	private tick = (now: number) => {
		const targetFrameMs = this.night ? TARGET_FRAME_MS : DAY_TARGET_FRAME_MS;

		if (now - this.lastFrame < targetFrameMs) {
			this.rafId = nextFrame(this.tick);
			return;
		}

		const deltaSeconds = Math.min((now - this.lastFrame) / 1000, 0.05);
		this.lastFrame = now;
		this.render(deltaSeconds, now / 1000);
		this.rafId = nextFrame(this.tick);
	};

	private render(deltaSeconds: number, elapsedSeconds: number) {
		if (!this.ctx) return;

		// Ease the pointer offset toward its target for a weighty, lagged feel.
		const lerp = Math.min(1, deltaSeconds * 3.5);
		this.pointerX += (this.pointerTargetX - this.pointerX) * lerp;
		this.pointerY += (this.pointerTargetY - this.pointerY) * lerp;

		this.clear();
		if (!this.night) {
			this.drawDaySky(deltaSeconds, elapsedSeconds);
			return;
		}

		this.drawAurora(elapsedSeconds);
		this.drawStars(elapsedSeconds);

		if (Math.random() < METEORS_PER_SECOND * deltaSeconds) {
			this.spawnMeteor();
		}

		this.updateMeteors(deltaSeconds);
		this.drawMeteors();
	}

	private drawStaticFrame() {
		if (!this.ctx || !this.active) return;
		this.clear();
		if (!this.night) {
			this.drawDaySky(0, performance.now() / 1000);
			return;
		}
		this.drawAurora(0);
		this.drawStars(performance.now() / 1000);
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
			const x = star.x * this.width + px - sprite.size / 2;
			const y = yBase + py - sprite.size / 2;

			this.ctx.globalAlpha = alpha;
			this.ctx.drawImage(sprite.canvas, x, y, sprite.size, sprite.size);
		}

		this.ctx.restore();
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
			const tailX = meteor.x - (meteor.vx / meteor.speed) * meteor.length;
			const tailY = meteor.y - (meteor.vy / meteor.speed) * meteor.length;
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
