/**
 * Daytime events for the light sky — the day's answer to meteors. Drawn by
 * the renderer after its clouds; DOM-free like the rest of the sky.
 *
 * - Contrails: now and then a plane crosses the upper sky (observatory mode
 *   only). Its trail forms a few px behind it, then widens and fades as it
 *   diffuses, with a faint underside for definition against the haze.
 * - Drop cloud: on request, a cloud condenses over a point, rains a few
 *   drops as it lets something fall (the hero's "3"), then drifts off and
 *   evaporates.
 */
import type { Ctx2D } from './surface';

type Sprite = { canvas: CanvasImageSource; width: number; height: number };

type TrailPoint = { x: number; y: number; age: number };
type Plane = { x: number; y: number; vx: number; vy: number; trail: TrailPoint[]; sinceSample: number; clock: number };
type Drop = { sprite: Sprite; x: number; y: number; age: number; condense: number; hold: number; rained: boolean };
type Drip = { x: number; y: number; vy: number; age: number; maxAge: number };

const TRAIL_LIFE = 14;
const SAMPLE_EVERY = 0.2;
/** Contrails form a little behind the engines. */
const CONTRAIL_GAP = 10;
const PLANE_INTERVAL: [number, number] = [26, 48];
const DROP_EVAPORATE = 2.4;
const DRIP_GRAVITY = 700;

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class Daylight {
	private planes: Plane[] = [];
	private drop: Drop | null = null;
	private drips: Drip[] = [];
	private untilPlane = randomBetween(4, 9);
	private viewWidth = 0;

	/** Something is mid-flight that wants a full frame rate. */
	get busy() {
		return !!this.drop || this.drips.length > 0;
	}

	get planeCount() {
		return this.planes.length;
	}

	clear() {
		this.planes = [];
		this.drop = null;
		this.drips = [];
	}

	/** Condense `sprite` centred on (x, y) over `condense` seconds, hold, then evaporate. */
	startDrop(sprite: Sprite, x: number, y: number, condense: number) {
		this.drop = { sprite, x, y, age: 0, condense: Math.max(0.2, condense), hold: 1.1, rained: false };
	}

	update(dt: number, width: number, height: number, planesEnabled: boolean) {
		this.viewWidth = width;
		if (planesEnabled) {
			this.untilPlane -= dt;
			if (this.untilPlane <= 0 && this.planes.length < 2) {
				this.planes.push(this.spawnPlane(width, height));
				this.untilPlane = randomBetween(...PLANE_INTERVAL);
			}
		}

		for (let i = this.planes.length - 1; i >= 0; i--) {
			const plane = this.planes[i];
			plane.x += plane.vx * dt;
			plane.y += plane.vy * dt;
			plane.clock += dt;
			plane.sinceSample += dt;
			for (const point of plane.trail) point.age += dt;
			while (plane.trail.length && plane.trail[0].age > TRAIL_LIFE) plane.trail.shift();

			const inView = plane.x > -40 && plane.x < width + 40;
			if (inView && plane.sinceSample >= SAMPLE_EVERY) {
				plane.sinceSample = 0;
				const speed = Math.hypot(plane.vx, plane.vy) || 1;
				plane.trail.push({
					x: plane.x - (plane.vx / speed) * CONTRAIL_GAP,
					y: plane.y - (plane.vy / speed) * CONTRAIL_GAP,
					age: 0,
				});
			}
			if (!inView && !plane.trail.length) this.planes.splice(i, 1);
		}

		const drop = this.drop;
		if (drop) {
			drop.age += dt;
			if (!drop.rained && drop.age >= drop.condense) {
				drop.rained = true;
				for (let i = 0; i < 5; i++) {
					this.drips.push({
						x: drop.x + randomBetween(-0.22, 0.22) * drop.sprite.width,
						y: drop.y + drop.sprite.height * 0.18,
						vy: randomBetween(90, 180),
						age: -randomBetween(0, 0.25),
						maxAge: randomBetween(0.45, 0.7),
					});
				}
			}
			if (drop.age > drop.condense + drop.hold + DROP_EVAPORATE) this.drop = null;
		}

		for (let i = this.drips.length - 1; i >= 0; i--) {
			const drip = this.drips[i];
			drip.age += dt;
			if (drip.age < 0) continue;
			drip.vy += DRIP_GRAVITY * dt;
			drip.y += drip.vy * dt;
			if (drip.age > drip.maxAge) this.drips.splice(i, 1);
		}
	}

	draw(ctx: Ctx2D) {
		this.drawContrails(ctx);
		this.drawDrop(ctx);
	}

	private spawnPlane(width: number, height: number): Plane {
		const eastbound = Math.random() < 0.5;
		const angle = randomBetween(-0.12, 0.12);
		const speed = randomBetween(55, 85);
		return {
			x: eastbound ? -30 : width + 30,
			y: randomBetween(height * 0.06, height * 0.38),
			vx: (eastbound ? 1 : -1) * Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			trail: [],
			sinceSample: 0,
			clock: 0,
		};
	}

	private drawContrails(ctx: Ctx2D) {
		if (!this.planes.length) return;
		ctx.save();
		ctx.lineCap = 'round';
		for (const plane of this.planes) {
			const points = [...plane.trail, { x: plane.x, y: plane.y, age: 0 }];
			for (let i = 1; i < points.length - 1; i++) {
				const a = points[i - 1];
				const b = points[i];
				const age = Math.max(a.age, b.age);
				const life = 1 - age / TRAIL_LIFE;
				if (life <= 0) continue;
				// Thin and bright where it forms; wider and fainter as it diffuses.
				const width = 1 + age * 0.5;
				const alpha = 0.62 * life ** 1.4;
				ctx.lineWidth = width + 0.8;
				ctx.strokeStyle = `rgba(110, 120, 150, ${alpha * 0.16})`;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y + 1.2);
				ctx.lineTo(b.x, b.y + 1.2);
				ctx.stroke();
				ctx.lineWidth = width;
				ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}

			if (plane.x > -40 && plane.x < this.viewWidth + 40) {
				ctx.fillStyle = 'rgba(60, 62, 92, 0.6)';
				ctx.beginPath();
				ctx.arc(plane.x, plane.y, 1.6, 0, Math.PI * 2);
				ctx.fill();
				// Anti-collision strobe.
				if (plane.clock % 1.3 < 0.09) {
					ctx.fillStyle = 'rgba(235, 70, 70, 0.9)';
					ctx.beginPath();
					ctx.arc(plane.x, plane.y, 1.4, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		}
		ctx.restore();
	}

	private drawDrop(ctx: Ctx2D) {
		const drop = this.drop;
		if (drop) {
			let alpha = 1;
			let scale = 1;
			let dx = 0;
			if (drop.age < drop.condense) {
				const k = easeOut(drop.age / drop.condense);
				alpha = k;
				scale = 0.8 + 0.2 * k;
				dx = (1 - k) * 30;
			} else if (drop.age > drop.condense + drop.hold) {
				const u = Math.min(1, (drop.age - drop.condense - drop.hold) / DROP_EVAPORATE);
				alpha = 1 - u;
				scale = 1 + 0.12 * u;
				dx = u * u * 70;
			}
			const bob = Math.sin(drop.age * 2.2) * 2;
			const w = drop.sprite.width * scale;
			const h = drop.sprite.height * scale;
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.drawImage(drop.sprite.canvas, drop.x + dx - w / 2, drop.y - h / 2 + bob, w, h);
			ctx.restore();
		}

		if (!this.drips.length) return;
		ctx.save();
		ctx.lineCap = 'round';
		ctx.lineWidth = 1.6;
		for (const drip of this.drips) {
			if (drip.age < 0) continue;
			ctx.strokeStyle = `rgba(110, 125, 175, ${0.55 * (1 - drip.age / drip.maxAge)})`;
			ctx.beginPath();
			ctx.moveTo(drip.x, drip.y);
			ctx.lineTo(drip.x, drip.y + 6);
			ctx.stroke();
		}
		ctx.restore();
	}
}
