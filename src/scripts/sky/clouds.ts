/**
 * The daylight sky's weather, for the GPU (glsky.ts): two cloud layers on
 * flat sheets over the site, ray-cast per pixel, driven by the live reading
 * (weather.ts) — plus rain, snow, fog and lightning.
 *
 * - Cumulus (low/mid, 1.5 or 3.6 km): billowy cells from a tileable
 *   Worley/Perlin noise texture, four octaves, with a broad patchiness on
 *   top. The live cloud cover becomes a density threshold through the
 *   noise's own measured distribution, so "40% cover" covers ~40% of the
 *   sheet. Above ~85% the cells close into a flat grey deck.
 * - Cirrus (9 km): the same noise stretched along the wind into long
 *   fibrous streaks, gathered into bands.
 * - Both drift with the wind aloft (time-lapsed 4×; the finer octaves a
 *   little faster and off-axis, so the cells evolve as they go).
 *
 * The density function is mirrored on the CPU (same texture data, same
 * octaves) to ask one question per half-second: how much of the Sun gets
 * through right now? The page's sun-cast shadows fade as a cloud crosses it.
 */
import type { SkyWeather } from './weather';
import { skyNow } from './clock';

export const NOISE_SIZE = 256;
/** Metres of cloud sheet per repeat of the base octave. */
export const CLOUD_TILE = 14000;
export const CIRRUS_ALT = 9000;
export const CIRRUS_LEN = 64000;
export const CIRRUS_WID = 5000;
/** Cells per tile: Worley (billows, G) and Perlin (R). */
const WORLEY_CELLS = 8;
const PERLIN_CELLS = 8;
/** The clouds drift this many times faster than the real wind. */
const TIMELAPSE = 4;
/** Edge softness, in units of the noise. */
export const CLOUD_SOFT = 0.035;
/** Weather changes ease in over a few seconds. */
const EASE_RATE = 1.1;

/**
 * Cumulus octaves, shared by both mirrors: texture channel, scale, weight
 * (weights sum to 1). The finest are tens of metres: crisp, fluffy edges
 * even overhead. Plus how far the broad patchiness shifts the threshold.
 */
export const OCTAVES = [
	['g', 1, 0.4],
	['r', 2, 0.22],
	['g', 4, 0.16],
	['r', 8, 0.1],
	['g', 16, 0.07],
	['r', 32, 0.05],
] as const;
export const PATCH = 0.18;
/**
 * Layout of `offsets()` (vec2 each, the shader's uOff[]): 0 base, 1 patch,
 * 2–6 the finer octaves, 7 cirrus ×1 / ×2, 8 cirrus bands ×¼.
 */
export const OFFSETS = 9;
/** Which uOff[] entry an octave reads. */
export const octaveOffset = (i: number) => (i === 0 ? 0 : i + 1);

const fract = (v: number) => v - Math.floor(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};
const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function seeded(seed: number) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Tileable gradient noise, `cells` per side, mapped to roughly 0–1. */
function perlin(size: number, cells: number, rand: () => number) {
	const count = cells * cells;
	const gx = new Float32Array(count);
	const gy = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const a = rand() * Math.PI * 2;
		gx[i] = Math.cos(a);
		gy[i] = Math.sin(a);
	}
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const dot = (ix: number, iy: number, dx: number, dy: number) => {
		const idx = ((iy + cells) % cells) * cells + ((ix + cells) % cells);
		return gx[idx] * dx + gy[idx] * dy;
	};
	const out = new Float32Array(size * size);
	for (let y = 0; y < size; y++) {
		const py = ((y + 0.5) / size) * cells;
		const iy = Math.floor(py);
		const fy = py - iy;
		const v = fade(fy);
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const px = ((x + 0.5) / size) * cells;
			const ix = Math.floor(px);
			const fx = px - ix;
			const u = fade(fx);
			const d00 = dot(ix, iy, fx, fy);
			const d10 = dot(ix + 1, iy, fx - 1, fy);
			const d01 = dot(ix, iy + 1, fx, fy - 1);
			const d11 = dot(ix + 1, iy + 1, fx - 1, fy - 1);
			const top = d00 + (d10 - d00) * u;
			const bottom = d01 + (d11 - d01) * u;
			out[row + x] = clamp01(0.5 + (top + (bottom - top) * v) * 0.85);
		}
	}
	return out;
}

/** Tileable inverted Worley (distance to the nearest cell point): puffs. */
function worley(size: number, cells: number, rand: () => number) {
	const count = cells * cells;
	const pxArr = new Float32Array(count);
	const pyArr = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		pxArr[i] = rand();
		pyArr[i] = rand();
	}
	const out = new Float32Array(size * size);
	for (let y = 0; y < size; y++) {
		const py = ((y + 0.5) / size) * cells;
		const iy = Math.floor(py);
		const row = y * size;
		for (let x = 0; x < size; x++) {
			const px = ((x + 0.5) / size) * cells;
			const ix = Math.floor(px);
			let bestSq = 81;
			for (let oy = -1; oy <= 1; oy++) {
				const cy = iy + oy;
				const rIdx = ((cy + cells) % cells) * cells;
				for (let ox = -1; ox <= 1; ox++) {
					const cx = ix + ox;
					const idx = rIdx + ((cx + cells) % cells);
					const dx = cx + pxArr[idx] - px;
					const dy = cy + pyArr[idx] - py;
					const dSq = dx * dx + dy * dy;
					if (dSq < bestSq) bestSq = dSq;
				}
			}
			out[row + x] = clamp01(1 - Math.sqrt(bestSq) / 0.9);
		}
	}
	return out;
}

type Eased = { cover: number; overcast: number; altitude: number; cirrus: number; rain: number; snow: number; fog: number };

const CALM: Eased = { cover: 0, overcast: 0, altitude: 1500, cirrus: 0, rain: 0, snow: 0, fog: 0 };

export class CloudField {
	/** RGBA8 noise: R Perlin, G Worley billows (B, A unused). */
	readonly texture: Uint8Array;
	private r: Float32Array;
	private g: Float32Array;
	/** Noise value at each percentile of its own distribution (0…100). */
	private quantiles: Float32Array;
	private state: Eased = { ...CALM };
	private target: Eased = { ...CALM };
	private wind: [number, number] = [0, 0];
	private storm = false;
	/** Accumulated drift, m [east, north]; double precision on the CPU, wrapped per octave for the GPU. */
	private drift: [number, number] | null = null;
	private cirrusDir: [number, number] | null = null;
	private cirrusDrift = 0;
	private offsetData = new Float32Array(OFFSETS * 2);
	// Lightning: one event = one or two quick flickers somewhere in the deck.
	private untilFlash = 6;
	private flashAge = Infinity;
	private flashAt: [number, number] = [0, 0];
	reducedMotion = false;

	constructor() {
		const rand = seeded(20261023);
		const size = NOISE_SIZE;
		this.r = perlin(size, PERLIN_CELLS, rand);
		this.g = worley(size, WORLEY_CELLS, rand);
		this.texture = new Uint8Array(size * size * 4);
		for (let i = 0; i < size * size; i++) {
			this.texture[i * 4] = Math.round(this.r[i] * 255);
			this.texture[i * 4 + 1] = Math.round(this.g[i] * 255);
			this.texture[i * 4 + 3] = 255;
		}
		// The CPU mirror reads the same 8-bit values the GPU does.
		for (let i = 0; i < size * size; i++) {
			this.r[i] = this.texture[i * 4] / 255;
			this.g[i] = this.texture[i * 4 + 1] / 255;
		}
		this.quantiles = this.measure();
	}

	/** Bilinear, wrapping — as the GPU's LINEAR + REPEAT samples mip 0. */
	private sample(channel: Float32Array, u: number, v: number) {
		const size = NOISE_SIZE;
		const mask = size - 1;
		const x = fract(u) * size - 0.5;
		const y = fract(v) * size - 0.5;
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const fx = x - x0;
		const fy = y - y0;
		const ix0 = x0 & mask;
		const ix1 = (x0 + 1) & mask;
		const r0 = (y0 & mask) * size;
		const r1 = ((y0 + 1) & mask) * size;
		const v00 = channel[r0 + ix0];
		const v10 = channel[r0 + ix1];
		const v01 = channel[r1 + ix0];
		const v11 = channel[r1 + ix1];
		const top = v00 + (v10 - v00) * fx;
		const bottom = v01 + (v11 - v01) * fx;
		return top + (bottom - top) * fy;
	}

	/** The cumulus noise at sheet position (u, v) in tiles, with the given octave offsets (see `offsets`). */
	private billows(u: number, v: number, o: ArrayLike<number>) {
		let n = 0;
		for (let i = 0; i < OCTAVES.length; i++) {
			const [channel, scale, weight] = OCTAVES[i];
			const k = octaveOffset(i) * 2;
			n += weight * this.sample(channel === 'g' ? this.g : this.r, u * scale + o[k], v * scale + o[k + 1]);
		}
		const patch = this.sample(this.r, u * 0.25 + o[2], v * 0.25 + o[3]);
		return n - (patch - 0.5) * PATCH;
	}

	/**
	 * Cirrus opacity at (u, v) in its wind-aligned frame (along / CIRRUS_LEN,
	 * across / CIRRUS_WID): fibres, bent by the broad bands they gather in.
	 */
	private cirrus(u: number, v: number, o: ArrayLike<number>, amount: number) {
		const broad = this.sample(this.r, u * 0.25 + o[16], v * 0.5 + 0.13);
		const w = v + (broad - 0.5) * 0.8;
		const fibres =
			0.55 * this.sample(this.r, u + o[14], w) + 0.3 * this.sample(this.r, u * 2 + o[15], w * 4 + 0.31) + 0.15 * this.sample(this.g, u + o[14], w * 8 + 0.67);
		const bands = smoothstep(0.38, 0.68, broad + amount * 0.3 - 0.15);
		const thr = 0.74 + (0.44 - 0.74) * amount;
		const strands = 0.55 + 0.45 * this.sample(this.r, u + o[14], w * 20 + 0.5);
		return smoothstep(thr, thr + 0.2, fibres) * bands * strands * 0.34;
	}

	/** Sample the noise's distribution once, so cover maps to an honest threshold. */
	private measure() {
		const steps = 96;
		const values = new Float32Array(steps * steps);
		const zero = new Float32Array(OFFSETS * 2);
		for (let j = 0; j < steps; j++) {
			const v = (j / steps) * 4;
			const row = j * steps;
			for (let i = 0; i < steps; i++) values[row + i] = this.billows((i / steps) * 4, v, zero);
		}
		values.sort();
		return Float32Array.from({ length: 101 }, (_, p) => values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))]);
	}

	/** Density threshold for a cover fraction (cover 0 → above every value). */
	private threshold(cover: number) {
		if (cover <= 0.002) return 2;
		const p = (1 - clamp01(cover)) * 100;
		const i = Math.min(99, Math.floor(p));
		const q = this.quantiles[i] + (this.quantiles[i + 1] - this.quantiles[i]) * (p - i);
		// Shift so the half-dense edge, not the faintest wisp, encloses `cover`.
		return q - CLOUD_SOFT * 0.5;
	}

	setWeather(weather: SkyWeather | null, snap: boolean) {
		const w = weather;
		this.target = w
			? { cover: w.cover, overcast: w.overcast, altitude: w.altitude, cirrus: w.cirrus, rain: w.rain, snow: w.snow, fog: w.fog }
			: { ...CALM };
		this.wind = w ? w.wind : [0, 0];
		this.storm = !!w?.storm;
		if (snap) this.state = { ...this.target };
	}

	/** Ease toward the reading, drift with the wind, run the lightning. */
	advance(dt: number, width: number, height: number) {
		const k = approach(EASE_RATE, dt);
		const s = this.state;
		const tgt = this.target;
		s.cover += (tgt.cover - s.cover) * k;
		s.overcast += (tgt.overcast - s.overcast) * k;
		s.altitude += (tgt.altitude - s.altitude) * k;
		s.cirrus += (tgt.cirrus - s.cirrus) * k;
		s.rain += (tgt.rain - s.rain) * k;
		s.snow += (tgt.snow - s.snow) * k;
		s.fog += (tgt.fog - s.fog) * k;
		const [we, wn] = this.wind;
		if (!this.drift) {
			// Start where the wind would have carried it by now: the same sky on every reload.
			const t = (skyNow() / 1000) * TIMELAPSE;
			this.drift = [we * t, wn * t];
		}
		this.drift[0] += we * dt * TIMELAPSE;
		this.drift[1] += wn * dt * TIMELAPSE;
		const speed = Math.hypot(we, wn);
		if (!this.cirrusDir && speed > 0.1) this.cirrusDir = [we / speed, wn / speed];
		const dir = this.cirrusDir ?? [1, 0];
		// Higher, faster: the jet-level wind runs ahead of the low clouds.
		this.cirrusDrift += (we * dir[0] + wn * dir[1]) * 1.6 * dt * TIMELAPSE;

		this.flashAge += dt;
		if (this.storm && !this.reducedMotion && this.state.overcast > 0.5) {
			this.untilFlash -= dt;
			if (this.untilFlash <= 0) {
				this.untilFlash = 5 + Math.random() * 11;
				this.flashAge = 0;
				this.flashAt = [width * (0.1 + Math.random() * 0.8), height * (0.05 + Math.random() * 0.55)];
			}
		}
	}

	/**
	 * Octave offsets, each wrapped within its own scale so wrapping never
	 * jumps (layout: OFFSETS). The finer octaves run a little faster and
	 * off-axis: the cells evolve as they drift.
	 */
	offsets() {
		const [dx, dy] = this.drift ?? [0, 0];
		const ex = dx * 1.3 - dy * 0.12;
		const ey = dy * 1.3 + dx * 0.12;
		const wrap = (metres: number, scale: number) => fract((-metres * scale) / CLOUD_TILE);
		const out = this.offsetData;
		out[0] = wrap(dx, 1);
		out[1] = wrap(dy, 1);
		out[2] = wrap(dx, 0.25);
		out[3] = wrap(dy, 0.25);
		for (let i = 1; i < OCTAVES.length; i++) {
			const scale = OCTAVES[i][1];
			const k = octaveOffset(i) * 2;
			out[k] = wrap(ex, scale);
			out[k + 1] = wrap(ey, scale);
		}
		out[14] = fract(-this.cirrusDrift / CIRRUS_LEN);
		out[15] = fract((-this.cirrusDrift * 2) / CIRRUS_LEN);
		out[16] = fract((-this.cirrusDrift * 0.25) / CIRRUS_LEN);
		return out;
	}

	/** Cumulus threshold, overcast, base altitude, cirrus. */
	get cloud(): [number, number, number, number] {
		const s = this.state;
		return [this.threshold(s.cover), s.overcast, s.altitude, s.cirrus];
	}

	/** A trace of cover fades in as a few faint wisps rather than stark fragments. */
	get cumulusOpacity() {
		return smoothstep(0.01, 0.15, this.state.cover);
	}

	/** The eased cover of each layer (telemetry). */
	get coverage() {
		return { cover: this.state.cover, cirrus: this.state.cirrus };
	}

	get precipitation(): [number, number, number] {
		const s = this.state;
		return [s.rain, s.snow, s.fog];
	}

	get cirrusDirection() {
		return this.cirrusDir ?? [1, 0];
	}

	/** How far rain leans: the screen-horizontal wind (view right `r`) over the fall speed. */
	slant(r: number[]) {
		const sideways = (this.wind[0] / 1.8) * r[0] + (this.wind[1] / 1.8) * r[1];
		return Math.max(-0.35, Math.min(0.35, sideways / 20));
	}

	/** Lightning: screen point (px) and brightness, 0 when quiet. */
	get flash(): [number, number, number] {
		const t = this.flashAge;
		// A flicker, a gap, a second flicker, a slow fade: two flashes, never more.
		let pulse = 0;
		if (t < 0.06) pulse = t / 0.06;
		else if (t < 0.14) pulse = 1 - ((t - 0.06) / 0.08) * 0.85;
		else if (t < 0.5) pulse = 0.15 + 0.85 * Math.exp(-((t - 0.32) ** 2) / 0.004);
		else if (t < 1.2) pulse = 0.15 * Math.exp(-(t - 0.5) / 0.15);
		return [this.flashAt[0], this.flashAt[1], pulse];
	}

	/** Something on screen is moving fast enough to want full frame rate. */
	get busy() {
		return this.flashAge < 1.2;
	}

	/** Rain or snow is falling (streaks want at least 30fps). */
	get falling() {
		return this.state.rain > 0.02 || this.state.snow > 0.02;
	}

	/** Weather is still easing in (wants frames, nothing more). */
	get settling() {
		const s = this.state;
		const t = this.target;
		return Math.abs(s.cover - t.cover) + Math.abs(s.overcast - t.overcast) + Math.abs(s.cirrus - t.cirrus) + Math.abs(s.fog - t.fog) > 0.01;
	}

	/** Share of direct sunlight reaching the ground (the CPU mirror of the shader's layers). */
	sunTransmittance(sun: number[]) {
		const [threshold, overcast, altitude, cirrus] = this.cloud;
		const o = this.offsets();
		const up = Math.max(sun[2], 0.03);
		const t = altitude / up;
		const n = this.billows((sun[0] * t) / CLOUD_TILE, (sun[1] * t) / CLOUD_TILE, o);
		let d = smoothstep(threshold, threshold + CLOUD_SOFT, n);
		d = d + (0.93 + 0.07 * smoothstep(0.3, 0.7, n) - d) * overcast;
		const cumulus = d * Math.exp(-t / 50000) * this.cumulusOpacity;
		let streaks = 0;
		if (cirrus > 0.001) {
			const tc = CIRRUS_ALT / up;
			const [ax, ay] = this.cirrusDirection;
			const px = sun[0] * tc;
			const py = sun[1] * tc;
			const u = (px * ax + py * ay) / CIRRUS_LEN;
			const v = (-px * ay + py * ax) / CIRRUS_WID;
			streaks = this.cirrus(u, v, o, cirrus);
		}
		const fog = this.state.fog;
		return clamp01((1 - 0.96 * cumulus) * (1 - 0.6 * streaks) * (1 - 0.75 * fog));
	}
}
