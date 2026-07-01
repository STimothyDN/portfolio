type Star = {
	x: number;
	y: number;
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

type StarSprite = {
	canvas: HTMLCanvasElement;
	size: number;
};

declare global {
	interface Window {
		__softStarfield?: boolean;
	}
}

const STAR_DENSITY = 1000 / (1440 * 900);
const MIN_STARS = 280;
const MAX_STARS = 1000;
const MAX_DPR = 2;
const TARGET_FRAME_MS = 1000 / 30;
const METEORS_PER_SECOND = 0.35;
const MAX_METEORS = 1;
const PERIMETER_OFFSET = 24;
const OUTER_PADDING = 72;
const STAR_SIZES = [0.95, 1.4, 2.15, 3.25, 4.15];

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const randomBetween = (min: number, max: number) =>
	Math.random() * (max - min) + min;

const prefersReducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const currentStarColor = () =>
	getComputedStyle(document.documentElement).getPropertyValue('--star-color').trim() || '255, 255, 255';

const starsAreHidden = () => document.documentElement.dataset.section === 'photography';

class SoftStarfield {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private stars: Star[] = [];
	private meteors: Meteor[] = [];
	private starSprites: StarSprite[] = [];
	private rafId = 0;
	private resizeRafId = 0;
	private width = 0;
	private height = 0;
	private dpr = 1;
	private lastFrame = 0;
	private starColor = currentStarColor();
	private readonly reducedMotion = prefersReducedMotion();
	private readonly themeObserver = new MutationObserver(() => {
		this.starColor = currentStarColor();
		this.createStarSprites();
		this.syncVisibility();
	});

	constructor() {
		window.addEventListener('resize', this.queueResize, { passive: true });
		document.addEventListener('visibilitychange', this.syncVisibility);
		document.addEventListener('astro:after-swap', this.bind);
		this.observeRoot();
		this.bind();
	}

	private bind = () => {
		this.observeRoot();
		const nextCanvas = document.querySelector<HTMLCanvasElement>('.twinkling-stars');
		if (!nextCanvas) {
			this.stop();
			this.canvas = null;
			this.ctx = null;
			return;
		}

		if (nextCanvas !== this.canvas) {
			this.canvas = nextCanvas;
			this.ctx = nextCanvas.getContext('2d');
			this.meteors = [];
			this.fitCanvas(true);
		}

		this.starColor = currentStarColor();
		this.createStarSprites();
		this.syncVisibility();
	};

	private observeRoot() {
		this.themeObserver.disconnect();
		this.themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-section'],
		});
	}

	private queueResize = () => {
		if (this.resizeRafId) return;
		this.resizeRafId = requestAnimationFrame(() => {
			this.resizeRafId = 0;
			this.fitCanvas(false);
			this.drawStaticFrame();
		});
	};

	private syncVisibility = () => {
		if (!this.canvas || !this.ctx || document.hidden || starsAreHidden()) {
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
	};

	private start() {
		if (this.rafId) return;
		this.lastFrame = performance.now();
		this.rafId = requestAnimationFrame(this.tick);
	}

	private stop() {
		if (!this.rafId) return;
		cancelAnimationFrame(this.rafId);
		this.rafId = 0;
	}

	private fitCanvas(forceRebuild: boolean) {
		if (!this.canvas || !this.ctx) return;

		const nextWidth = Math.max(1, Math.ceil(window.innerWidth));
		const nextHeight = Math.max(1, Math.ceil(window.innerHeight));
		const nextDpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
		const sizeChanged =
			nextWidth !== this.width || nextHeight !== this.height || nextDpr !== this.dpr;

		if (!sizeChanged && !forceRebuild) return;

		this.width = nextWidth;
		this.height = nextHeight;
		this.dpr = nextDpr;
		this.canvas.width = Math.ceil(nextWidth * nextDpr);
		this.canvas.height = Math.ceil(nextHeight * nextDpr);
		this.ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
		this.createStarSprites();
		this.reconcileStars(forceRebuild);
	}

	private reconcileStars(forceRebuild: boolean) {
		const targetCount = clamp(
			Math.round(this.width * this.height * STAR_DENSITY),
			MIN_STARS,
			MAX_STARS,
		);

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
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d')!;

			canvas.width = Math.ceil(logicalSize * this.dpr);
			canvas.height = Math.ceil(logicalSize * this.dpr);
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
		if (now - this.lastFrame < TARGET_FRAME_MS) {
			this.rafId = requestAnimationFrame(this.tick);
			return;
		}

		const deltaSeconds = Math.min((now - this.lastFrame) / 1000, 0.05);
		this.lastFrame = now;
		this.render(deltaSeconds, now / 1000);
		this.rafId = requestAnimationFrame(this.tick);
	};

	private render(deltaSeconds: number, elapsedSeconds: number) {
		if (!this.ctx) return;

		this.clear();
		this.drawStars(elapsedSeconds);

		if (Math.random() < METEORS_PER_SECOND * deltaSeconds) {
			this.spawnMeteor();
		}

		this.updateMeteors(deltaSeconds);
		this.drawMeteors();
	}

	private drawStaticFrame() {
		if (!this.ctx || starsAreHidden()) return;
		this.clear();
		this.drawStars(performance.now() / 1000);
	}

	private clear() {
		this.ctx?.clearRect(0, 0, this.width, this.height);
	}

	private drawStars(elapsedSeconds: number) {
		if (!this.ctx) return;

		this.ctx.save();

		for (const star of this.stars) {
			const alpha = clamp(
				star.baseAlpha + Math.sin(star.phase + elapsedSeconds * star.twinkleSpeed) * star.alphaRange,
				star.minAlpha,
				1,
			);
			const sprite = this.starSprites[star.spriteIndex];
			if (!sprite) continue;
			const x = star.x * this.width - sprite.size / 2;
			const y = star.y * this.height - sprite.size / 2;

			this.ctx.globalAlpha = alpha;
			this.ctx.drawImage(sprite.canvas, x, y, sprite.size, sprite.size);
		}

		this.ctx.restore();
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

if (!window.__softStarfield) {
	window.__softStarfield = true;
	new SoftStarfield();
}
