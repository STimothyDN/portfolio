/**
 * The real night sky over the observatory site: the Yale Bright Star
 * Catalogue (~9,100 stars, tinted by their B−V colour), the Moon at its true
 * phase, the naked-eye planets and a soft Milky Way. Loaded on demand by the
 * renderer — this module carries the catalogue.
 *
 * The view faces south through a stereographic lens whose screen diagonal
 * spans 120° of sky, looking high into the southern sky. Scrolling lowers
 * the gaze gently — the sky drifts at about an eighth of the page's speed,
 * a far-background parallax that a worker frame behind can't visibly lag —
 * and the pointer (or phone tilt) looks a degree or two around. (The
 * horizon is page content: see ObservatoryHome.astro.) Positions follow the real
 * clock: stars are re-placed every few seconds, the Moon and planets every
 * minute.
 */
import catalog from './bright-stars.json';
import {
	DEG,
	type Horizon,
	altitudeDeg,
	galacticPlane,
	julian,
	lstHours,
	moon,
	planets,
	sun,
	toHorizon,
} from './astro';
import { type Ctx2D, type SkyCanvas, context2d, createSurface } from './surface';

const DIAG_HALF_FOV = 60 * DEG;
const FACING_AZ = 180;
/** How far the pointer/tilt looks around, degrees. */
const PAN_AZ = 3;
const PAN_ALT = 2;
/** The sky drifts at this fraction of the scroll speed (at the view centre). */
const SCROLL_DRIFT = 0.12;
const STAR_SIZES = [0.95, 1.4, 2.15, 3.25, 4.15];
/** Subtle B−V tints, blue-white → orange-red. */
const TINTS = ['205, 220, 255', '236, 241, 255', '255, 251, 242', '255, 242, 218', '255, 226, 192', '255, 208, 178'];
const STARS_EVERY_MS = 5000;
const BODIES_EVERY_MS = 60000;
const MILKY_WAY_TINT = '214, 218, 255';
/**
 * The near side's maria as seen from Earth, north up: centre (x right, y
 * down) and radius on the unit disc — enough to read as the Moon, not a dot.
 */
const MARIA = [
	{ x: -0.6, y: -0.02, r: 0.32 }, // Oceanus Procellarum
	{ x: -0.28, y: -0.42, r: 0.24 }, // Imbrium
	{ x: 0.18, y: -0.36, r: 0.15 }, // Serenitatis
	{ x: 0.32, y: -0.08, r: 0.19 }, // Tranquillitatis
	{ x: 0.66, y: -0.3, r: 0.11 }, // Crisium
	{ x: 0.56, y: 0.16, r: 0.13 }, // Fecunditatis
	{ x: 0.3, y: 0.32, r: 0.09 }, // Nectaris
	{ x: -0.16, y: 0.42, r: 0.15 }, // Nubium
	{ x: -0.46, y: 0.4, r: 0.09 }, // Humorum
];

export type StarSprite = { canvas: SkyCanvas; size: number };
/** Draws one star; the renderer applies its lens and warp. `depth` 0–1 = how near/bright it reads. */
export type DrawStar = (x: number, y: number, sprite: StarSprite, alpha: number, depth: number) => void;
export type RealSkyStats = {
	stars: number;
	limit: number;
	viewAlt: number;
	moonAlt: number | null;
	planets: string[];
	radiantAlt: number | null;
};

type Body = { name: string; vec: Horizon; mag: number; color: string };
type Point = { x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};

const tintClass = (bv: number) => (bv < -0.1 ? 0 : bv < 0.25 ? 1 : bv < 0.55 ? 2 : bv < 0.9 ? 3 : bv < 1.35 ? 4 : 5);
const sizeClass = (mag: number) => (mag < 0.5 ? 4 : mag < 1.5 ? 3 : mag < 2.8 ? 2 : mag < 4.3 ? 1 : 0);

export class RealSky {
	readonly count: number;
	private catalogReady = false;
	private ra!: Float32Array;
	private sinDec!: Float32Array;
	private cosDec!: Float32Array;
	private mag!: Float32Array;
	private tint!: Uint8Array;
	private size!: Uint8Array;
	private phase!: Float32Array;
	private speed!: Float32Array;
	/** Horizon-frame unit vectors [east, north, up] per star. */
	private vec!: Float32Array;
	private starsAt = -Infinity;
	private starsComputed = false;
	private bodiesAt = -Infinity;
	private lst = 0;
	private sunVec: Horizon = [0, 0, -1];
	private moonBody: { vec: Horizon; phaseAngle: number } | null = null;
	private planetBodies: Body[] = [];
	private milky: { ra: number; dec: number; weight: number; vec: Horizon }[] | null = null;
	private radiantEq: { ra: number; dec: number } | null = null;
	private radiantVec: Horizon | null = null;
	private dpr = 1;
	private spritesDpr = 0;
	private sprites: StarSprite[][] = [];
	private milkySprite: SkyCanvas | null = null;
	private drawn = 0;
	private limit = 6.5;

	// View: centre, scale and the screen basis (right, up, forward) in the horizon frame.
	private width = 0;
	private height = 0;
	private cx = 0;
	private cy = 0;
	private K = 1;
	private viewAz = FACING_AZ;
	viewAlt = 45;
	private r: Horizon = [-1, 0, 0];
	private u: Horizon = [0, 0, 1];
	private f: Horizon = [0, -1, 0];
	private viewState = { r: this.r, u: this.u, f: this.f, K: this.K };
	private pt: Point = { x: 0, y: 0 };

	constructor(
		private latDeg: number,
		private lonDeg: number
	) {
		const data = catalog.data as number[];
		this.count = data.length / 4;
	}

	private ensureCatalog() {
		if (this.catalogReady) return;
		this.catalogReady = true;
		const data = catalog.data as number[];
		const n = this.count;
		this.ra = new Float32Array(n);
		this.sinDec = new Float32Array(n);
		this.cosDec = new Float32Array(n);
		this.mag = new Float32Array(n);
		this.tint = new Uint8Array(n);
		this.size = new Uint8Array(n);
		this.phase = new Float32Array(n);
		this.speed = new Float32Array(n);
		this.vec = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			const dec = (data[i * 4 + 1] / 100) * DEG;
			this.ra[i] = (data[i * 4] / 100) * DEG;
			this.sinDec[i] = Math.sin(dec);
			this.cosDec[i] = Math.cos(dec);
			this.mag[i] = data[i * 4 + 2] / 10;
			this.tint[i] = tintClass(data[i * 4 + 3] / 10);
			this.size[i] = sizeClass(this.mag[i]);
			// Deterministic scintillation per star.
			const h = Math.sin(i * 12.9898) * 43758.5453;
			this.phase[i] = (h - Math.floor(h)) * Math.PI * 2;
			this.speed[i] = 0.6 + Math.abs((h * 7.31) % 1) * 1.6;
		}
		this.milky = galacticPlane(6).map((p) => ({ ...p, vec: [0, 0, -1] as Horizon }));
	}

	setRadiant(radiant: { ra: number; dec: number } | null) {
		this.radiantEq = radiant ? { ra: radiant.ra * DEG, dec: radiant.dec * DEG } : null;
		this.starsAt = -Infinity;
	}

	/** Record the pixel ratio; sprites are built lazily only if the 2D fallback draws. */
	setDpr(dpr: number) {
		this.dpr = dpr;
	}

	private ensureSprites() {
		if (this.spritesDpr === this.dpr && this.milkySprite) return;
		const dpr = (this.spritesDpr = this.dpr);
		this.sprites = TINTS.map((tint) =>
			STAR_SIZES.map((size) => {
				const glow = size * 0.95 + 1.15;
				const logical = glow * 2;
				const canvas = createSurface(Math.ceil(logical * dpr), Math.ceil(logical * dpr));
				const ctx = context2d(canvas)!;
				ctx.scale(dpr, dpr);
				const c = logical / 2;
				const core = Math.max(0.28, size * 0.16);
				const gradient = ctx.createRadialGradient(c, c, core, c, c, glow);
				gradient.addColorStop(0, `rgba(${tint}, 1)`);
				gradient.addColorStop(0.24, `rgba(${tint}, 0.82)`);
				gradient.addColorStop(0.58, `rgba(${tint}, 0.24)`);
				gradient.addColorStop(1, `rgba(${tint}, 0)`);
				ctx.fillStyle = gradient;
				ctx.beginPath();
				ctx.arc(c, c, glow, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = `rgba(${tint}, 0.95)`;
				ctx.beginPath();
				ctx.arc(c, c, core, 0, Math.PI * 2);
				ctx.fill();
				return { canvas, size: logical };
			})
		);

		const blob = 128;
		this.milkySprite = createSurface(blob, blob);
		const ctx = context2d(this.milkySprite)!;
		const gradient = ctx.createRadialGradient(blob / 2, blob / 2, 0, blob / 2, blob / 2, blob / 2);
		gradient.addColorStop(0, `rgba(${MILKY_WAY_TINT}, 1)`);
		gradient.addColorStop(0.35, `rgba(${MILKY_WAY_TINT}, 0.45)`);
		gradient.addColorStop(1, `rgba(${MILKY_WAY_TINT}, 0)`);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, blob, blob);
	}

	/**
	 * Re-place everything for the current time (cheap to call every frame).
	 * `stars: false` skips the catalogue (the GPU layer turns the sky itself).
	 */
	update(now: number, stars = true) {
		const jd = julian(now);
		const lat = this.latDeg * DEG;
		// Either way: an ?at= preview can move the sky clock backwards (abs, or it would stall).
		if (Math.abs(now - this.starsAt) >= STARS_EVERY_MS || (stars && !this.starsComputed)) {
			this.starsAt = now;
			this.lst = lstHours(jd, this.lonDeg) * 15 * DEG;
			if (stars) {
				this.ensureCatalog();
				this.starsComputed = true;
				const sinLat = Math.sin(lat);
				const cosLat = Math.cos(lat);
				const v = this.vec;
				for (let i = 0; i < this.count; i++) {
					const ha = this.lst - this.ra[i];
					const cosHa = Math.cos(ha);
					v[i * 3] = -this.cosDec[i] * Math.sin(ha);
					v[i * 3 + 1] = this.sinDec[i] * cosLat - this.cosDec[i] * cosHa * sinLat;
					v[i * 3 + 2] = this.sinDec[i] * sinLat + this.cosDec[i] * cosHa * cosLat;
				}
				for (const p of this.milky!) toHorizon(p.ra, p.dec, this.lst, lat, p.vec);
			}
			this.radiantVec = this.radiantEq ? toHorizon(this.radiantEq.ra, this.radiantEq.dec, this.lst, lat) : null;
		}
		if (Math.abs(now - this.bodiesAt) >= BODIES_EVERY_MS) {
			this.bodiesAt = now;
			const s = sun(jd);
			this.sunVec = toHorizon(s.ra, s.dec, this.lst, lat);
			const m = moon(jd);
			this.moonBody = { vec: toHorizon(m.ra, m.dec, this.lst, lat), phaseAngle: m.phaseAngle };
			this.planetBodies = planets(jd).map((p) => ({
				name: p.name,
				vec: toHorizon(p.ra, p.dec, this.lst, lat),
				mag: p.mag,
				color: p.color,
			}));
		}
	}

	/**
	 * Aim the view. `scrollTop` is how far down the page (px); `panX`/`panY`
	 * are the pointer/tilt offsets (−0.5…0.5).
	 */
	setView(width: number, height: number, scrollTop: number, panX: number, panY: number) {
		this.width = width;
		this.height = height;
		this.cx = width / 2;
		this.cy = height / 2;
		this.K = Math.hypot(width, height) / 2 / Math.tan(DIAG_HALF_FOV / 2);
		this.limit = width * height >= 1.1e6 ? 6.5 : width * height >= 5e5 ? 6.0 : 5.6;
		// Top of the page: the bottom edge sits ~22° up. Scrolling lowers the
		// gaze at SCROLL_DRIFT of the page's speed (screen px per degree at the
		// centre of a stereographic view is K/2 per radian), never far enough
		// to bring the horizon itself into view.
		const toEdge = (2 * Math.atan(height / 2 / this.K)) / DEG;
		const pxPerDeg = (this.K / 2) * DEG;
		const top = Math.min(80, 22 + toEdge);
		const gaze = Math.max(toEdge + 4, top - (scrollTop * SCROLL_DRIFT) / pxPerDeg);
		this.viewAlt = gaze + panY * 2 * PAN_ALT;
		this.viewAz = FACING_AZ - panX * 2 * PAN_AZ;

		const az = this.viewAz * DEG;
		const alt = this.viewAlt * DEG;
		const sa = Math.sin(az);
		const ca = Math.cos(az);
		const sl = Math.sin(alt);
		const cl = Math.cos(alt);
		// In place: the view basis is re-aimed every frame.
		const { f, r, u } = this;
		f[0] = cl * sa;
		f[1] = cl * ca;
		f[2] = sl;
		r[0] = ca;
		r[1] = -sa;
		r[2] = 0;
		u[0] = -sa * sl;
		u[1] = -ca * sl;
		u[2] = cl;
		this.viewState.K = this.K;
	}

	/** The Sun as a horizon-frame unit vector [east, north, up] (refreshed each minute). */
	get sunVector() {
		return this.sunVec;
	}

	/** The Moon as a horizon-frame unit vector (refreshed each minute), or null before the first update. */
	get moonVector() {
		return this.moonBody?.vec ?? null;
	}

	/** The current view, for the GPU layer (glsky.ts) to project identically (live: updated in place). */
	get view() {
		return this.viewState;
	}

	/** Stereographic projection of a horizon-frame vector; false if it's behind the viewer. */
	private project(x: number, y: number, z: number, out: Point) {
		const { f, r, u } = this;
		const forward = x * f[0] + y * f[1] + z * f[2];
		if (forward < -0.5) return false;
		const k = this.K / (1 + forward);
		out.x = this.cx + k * (x * r[0] + y * r[1] + z * r[2]);
		out.y = this.cy - k * (x * u[0] + y * u[1] + z * u[2]);
		return true;
	}

	private onScreen({ x, y }: Point, margin: number) {
		return x > -margin && x < this.width + margin && y > -margin && y < this.height + margin;
	}

	drawMilkyWay(ctx: Ctx2D) {
		this.ensureCatalog();
		this.ensureSprites();
		if (!this.milkySprite || !this.milky) return;
		const size = this.K * 0.42;
		ctx.save();
		for (const p of this.milky) {
			const up = p.vec[2];
			if (up < -0.05 || !this.project(p.vec[0], p.vec[1], up, this.pt) || !this.onScreen(this.pt, size)) continue;
			ctx.globalAlpha = 0.05 * p.weight * smoothstep(-0.05, 0.25, up);
			ctx.drawImage(this.milkySprite, this.pt.x - size / 2, this.pt.y - size / 2, size, size);
		}
		ctx.restore();
	}

	drawStars(elapsed: number, draw: DrawStar) {
		this.ensureCatalog();
		this.ensureSprites();
		const v = this.vec;
		let drawn = 0;
		for (let i = 0; i < this.count; i++) {
			const mag = this.mag[i];
			if (mag > this.limit) break; // brightest first
			const up = v[i * 3 + 2];
			if (up < -0.01 || !this.project(v[i * 3], v[i * 3 + 1], up, this.pt) || !this.onScreen(this.pt, 8)) continue;
			// Fainter toward the horizon (extinction), and twinkling harder there.
			// Brightness falls off gently: even mag-6 stars stay faintly visible,
			// so the sky reads as full as the eye's rather than a scatter of beacons.
			const base = mag < 1 ? 1 : Math.max(0.26, 1 - (mag - 1) / 8);
			const scintillation = 0.1 + 0.3 * (1 - up);
			const twinkle = 1 - scintillation * (0.5 + 0.5 * Math.sin(this.phase[i] + elapsed * this.speed[i]));
			const alpha = base * smoothstep(-0.01, 0.2, up) * twinkle;
			draw(this.pt.x, this.pt.y, this.sprites[this.tint[i]][this.size[i]], alpha, clamp(1 - mag / 7, 0, 1));
			drawn++;
		}
		this.drawn = drawn;
	}

	/** Planets: steady (they don't twinkle), sized by brightness. */
	drawPlanets(ctx: Ctx2D) {
		ctx.save();
		for (const p of this.planetBodies) {
			const up = p.vec[2];
			if (up < 0 || !this.project(p.vec[0], p.vec[1], up, this.pt) || !this.onScreen(this.pt, 20)) continue;
			const r = clamp(2.2 - 0.45 * p.mag, 1.2, 4.2);
			const fade = smoothstep(-0.01, 0.2, up);
			const halo = ctx.createRadialGradient(this.pt.x, this.pt.y, 0, this.pt.x, this.pt.y, r * 3.5);
			halo.addColorStop(0, `rgba(${p.color}, ${0.5 * fade})`);
			halo.addColorStop(1, `rgba(${p.color}, 0)`);
			ctx.fillStyle = halo;
			ctx.beginPath();
			ctx.arc(this.pt.x, this.pt.y, r * 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = `rgba(${p.color}, ${fade})`;
			ctx.beginPath();
			ctx.arc(this.pt.x, this.pt.y, r * 0.55, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	/**
	 * The Moon (drawn ~3× true size): lit on the side facing the Sun, with
	 * limb darkening and its maria turned to the Moon's real north on screen.
	 */
	drawMoon(ctx: Ctx2D) {
		const m = this.moonBody;
		if (!m) return;
		const [x, y, z] = m.vec;
		if (z < -0.02 || !this.project(x, y, z, this.pt) || !this.onScreen(this.pt, 60)) return;
		const mx = this.pt.x;
		const my = this.pt.y;
		// Screen directions from the Moon: step a little along the great
		// circle toward the Sun (the bright limb) and toward the celestial
		// pole (the Moon's north, near enough).
		const directionTo = (t: Horizon) => {
			if (!this.project(x + (t[0] - x) * 0.02, y + (t[1] - y) * 0.02, z + (t[2] - z) * 0.02, this.pt)) return null;
			return Math.atan2(this.pt.y - my, this.pt.x - mx);
		};
		const lat = this.latDeg * DEG;
		const angle = directionTo(this.sunVec);
		const north = directionTo([0, Math.cos(lat), Math.sin(lat)]);
		if (angle === null || north === null) return;
		const radius = clamp(this.K * 0.016, 7, 14);
		const fade = smoothstep(-0.02, 0.15, z);

		ctx.save();
		ctx.translate(mx, my);
		const halo = ctx.createRadialGradient(0, 0, radius, 0, 0, radius * 5);
		halo.addColorStop(0, `rgba(235, 235, 255, ${0.16 * fade * (1 + Math.cos(m.phaseAngle)) * 0.5})`);
		halo.addColorStop(1, 'rgba(235, 235, 255, 0)');
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(0, 0, radius * 5, 0, Math.PI * 2);
		ctx.fill();

		// Earthshine on the dark limb.
		ctx.fillStyle = `rgba(200, 205, 235, ${0.1 * fade})`;
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, Math.PI * 2);
		ctx.fill();

		// Lit part: the sunward semicircle, closed by the terminator ellipse —
		// bulging away from the Sun when gibbous, toward it when a crescent.
		ctx.rotate(angle);
		const terminator = Math.cos(m.phaseAngle);
		ctx.beginPath();
		ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
		if (terminator >= 0) ctx.ellipse(0, 0, radius * terminator, radius, 0, Math.PI / 2, (3 * Math.PI) / 2);
		else ctx.ellipse(0, 0, radius * -terminator, radius, 0, Math.PI / 2, -Math.PI / 2, true);
		ctx.closePath();
		ctx.clip();

		// Inside the lit part, turn to the Moon's own frame (north up).
		ctx.rotate(north + Math.PI / 2 - angle);
		ctx.globalAlpha = fade;
		const surface = ctx.createRadialGradient(-radius * 0.2, -radius * 0.2, 0, 0, 0, radius);
		surface.addColorStop(0, 'rgb(244, 242, 236)');
		surface.addColorStop(0.75, 'rgb(226, 224, 220)');
		surface.addColorStop(1, 'rgb(196, 195, 194)');
		ctx.fillStyle = surface;
		ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
		for (const mare of MARIA) {
			const cx = mare.x * radius;
			const cy = mare.y * radius;
			// Slightly oversized and soft-edged, so neighbouring seas run together.
			const r = mare.r * radius * 1.2;
			const patch = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
			patch.addColorStop(0, 'rgba(118, 120, 130, 0.38)');
			patch.addColorStop(0.6, 'rgba(118, 120, 130, 0.24)');
			patch.addColorStop(1, 'rgba(118, 120, 130, 0)');
			ctx.fillStyle = patch;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}

	/** Screen position of the active shower's radiant, if it's above the horizon. */
	radiantOnScreen(out: Point) {
		const v = this.radiantVec;
		return !!v && v[2] > 0 && this.project(v[0], v[1], v[2], out);
	}

	/** Shower rates scale with the radiant's height: 0 below the horizon, 1 from ~50° up. */
	get radiantFactor() {
		const v = this.radiantVec;
		return v ? clamp(v[2] * 1.3, 0, 1) : 0;
	}

	/** Screen position of the Sun, if it's up and in front of the view. */
	sunOnScreen(out: Point) {
		const v = this.sunVec;
		const forward = v[0] * this.f[0] + v[1] * this.f[1] + v[2] * this.f[2];
		return v[2] > -0.02 && forward > 0 && this.project(v[0], v[1], v[2], out);
	}

	stats(): RealSkyStats {
		const visible = (v: Horizon) => v[2] > 0;
		return {
			stars: this.drawn,
			limit: this.limit,
			viewAlt: this.viewAlt,
			moonAlt: this.moonBody ? altitudeDeg(this.moonBody.vec) : null,
			planets: this.planetBodies.filter((p) => visible(p.vec)).map((p) => p.name),
			radiantAlt: this.radiantVec ? altitudeDeg(this.radiantVec) : null,
		};
	}
}
