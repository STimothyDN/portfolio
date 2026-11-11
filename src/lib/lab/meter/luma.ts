/**
 * From a phone photo's pixels to light: each pixel as stops from the phone's
 * own exposure, with the phone's tone curve undone, so a spot or an area can
 * be read the way a spot meter would read it.
 *
 * The chain, per pixel: sRGB → linear → luminance (Rec. 709 weights) →
 * "display stops" (log2 of luminance over 18% gray) → scene stops (an
 * inverse filmic curve: phones render mid-tones with a little extra contrast
 * and squeeze about four stops of highlights into the top of the range).
 * A reading is then the camera's EV plus the scene stops plus the meter
 * offset (below), plus the user's calibration.
 */

/** Middle gray as a JPEG renders it (sRGB 118). */
export const DISPLAY_MID = 0.18;

/**
 * A reflected meter (calibration constant K = 12.5) puts the tone it reads
 * at about 81% of the exposure a camera rated by ISO 12232's standard output
 * sensitivity needs to render sRGB 118: 0.18 × 8.125 / 10. So a pixel at
 * 118 is about 0.3 stop brighter than what that camera's settings metered.
 */
export const METER_OFFSET = Math.log2(DISPLAY_MID / 0.14625);

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
	const c = i / 255;
	LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export const srgbToLinear = (byte: number) => LIN[byte & 255];

/** Mid-tone contrast of a phone's rendering (slope of its curve at middle gray, in stops). */
const MID_CONTRAST = 1.1;
/** How far up (display stops over gray) the highlight shoulder tends towards; white is 2.47. */
const SHOULDER = 2.6;
/** And down, for the shadow toe. */
const TOE = 12;

/**
 * Scene stops from display stops: the inverse of d = A·tanh(s·x / A), with a
 * tighter A above gray (the shoulder) than below (the toe). Near gray it is
 * about x = d / 1.1; at sRGB 245 it gives about +3.5, at sRGB 20 about −4.5.
 */
export function sceneStops(display: number): number {
	const A = display >= 0 ? SHOULDER : TOE;
	const r = Math.max(-0.995, Math.min(0.995, display / A));
	return (A / MID_CONTRAST) * Math.atanh(r);
}

export interface LumaMap {
	w: number;
	h: number;
	/** Scene stops from what the phone exposed for, per pixel. */
	stops: Float32Array;
	/** 1: the phone clipped it (a channel at 250+); 2: crushed (every channel at 4 or under). */
	clip: Uint8Array;
}

/** Read RGBA pixels (row-major) into a luminance map. */
export function lumaMap(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): LumaMap {
	const n = w * h;
	const stops = new Float32Array(n);
	const clip = new Uint8Array(n);
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		const r = rgba[p];
		const g = rgba[p + 1];
		const b = rgba[p + 2];
		const y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
		stops[i] = sceneStops(Math.log2(Math.max(y, 1e-5) / DISPLAY_MID));
		const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
		clip[i] = mx >= 250 ? 1 : mx <= 4 ? 2 : 0;
	}
	return { w, h, stops, clip };
}

/* ---------- where to read ---------- */

/** Normalised to the picture: x and y from 0 to 1; a spot's radius as a share of the longer side. */
export type Region =
	| { kind: 'spot'; x: number; y: number; r: number }
	| { kind: 'area'; x0: number; y0: number; x1: number; y1: number }
	| { kind: 'frame' };

/** A box inside the picture (normalised), e.g. what the film camera's lens sees. */
export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export const FULL: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };

export interface RegionReading {
	/** Scene stops (from the phone's exposure) of the light averaged over the region. */
	stops: number;
	/** Share of the region the phone clipped white, and crushed black. */
	hi: number;
	lo: number;
	n: number;
}

/**
 * The light over a region, averaged as a meter does: in linear light, not in
 * stops (one bright patch counts for what it is). A whole-frame reading is
 * centre-weighted inside `box`, like a camera's averaging meter.
 */
export function readRegion(map: LumaMap, region: Region, box: Box = FULL): RegionReading {
	const { w, h, stops, clip } = map;
	let sum = 0;
	let wsum = 0;
	let hi = 0;
	let lo = 0;
	let n = 0;
	const take = (i: number, weight: number) => {
		sum += weight * 2 ** stops[i];
		wsum += weight;
		if (clip[i] === 1) hi += weight;
		else if (clip[i] === 2) lo += weight;
		n++;
	};
	if (region.kind === 'spot') {
		const L = Math.max(w, h);
		const cx = region.x * w;
		const cy = region.y * h;
		const r = Math.max(1, region.r * L);
		for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
			for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
				if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) take(y * w + x, 1);
	} else {
		const b = region.kind === 'area' ? region : box;
		const x0 = Math.max(0, Math.floor(Math.min(b.x0, b.x1) * w));
		const x1 = Math.min(w, Math.ceil(Math.max(b.x0, b.x1) * w));
		const y0 = Math.max(0, Math.floor(Math.min(b.y0, b.y1) * h));
		const y1 = Math.min(h, Math.ceil(Math.max(b.y0, b.y1) * h));
		const mx = (x0 + x1) / 2;
		const my = (y0 + y1) / 2;
		// Centre-weighted: a soft bell over the box, a third of its size each way.
		const sx = Math.max(1, (x1 - x0) * 0.33);
		const sy = Math.max(1, (y1 - y0) * 0.33);
		for (let y = y0; y < y1; y++)
			for (let x = x0; x < x1; x++) {
				const weight = region.kind === 'frame' ? Math.exp(-(((x + 0.5 - mx) / sx) ** 2 + ((y + 0.5 - my) / sy) ** 2) / 2) : 1;
				take(y * w + x, weight);
			}
	}
	if (!n || !wsum) return { stops: 0, hi: 0, lo: 0, n: 0 };
	return { stops: Math.log2(sum / wsum), hi: hi / wsum, lo: lo / wsum, n };
}

export interface FrameSpread {
	/** Scene stops at these percentiles of the picture's pixels. */
	p2: number;
	p5: number;
	p50: number;
	p95: number;
	p98: number;
	/** Share the phone clipped white, and crushed black. */
	hi: number;
	lo: number;
}

const BIN = 8; // bins per stop
const LOW = -16;
const HIGH = 8;

/** How the light is spread across the picture (inside `box`): shadows to highlights. */
export function spread(map: LumaMap, box: Box = FULL): FrameSpread {
	const { w, h, stops, clip } = map;
	const bins = new Uint32Array((HIGH - LOW) * BIN);
	let n = 0;
	let hi = 0;
	let lo = 0;
	const x0 = Math.floor(box.x0 * w);
	const x1 = Math.ceil(box.x1 * w);
	const y0 = Math.floor(box.y0 * h);
	const y1 = Math.ceil(box.y1 * h);
	for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
		for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
			const i = y * w + x;
			const b = Math.round((stops[i] - LOW) * BIN);
			bins[Math.max(0, Math.min(bins.length - 1, b))]++;
			if (clip[i] === 1) hi++;
			else if (clip[i] === 2) lo++;
			n++;
		}
	const at = (q: number) => {
		const target = q * n;
		let run = 0;
		for (let b = 0; b < bins.length; b++) {
			run += bins[b];
			if (run >= target) return b / BIN + LOW;
		}
		return HIGH;
	};
	return { p2: at(0.02), p5: at(0.05), p50: at(0.5), p95: at(0.95), p98: at(0.98), hi: n ? hi / n : 0, lo: n ? lo / n : 0 };
}

/**
 * Where to put a spot to read the brightest (or darkest) part of the picture
 * that still has detail: a coarse grid of spot-sized cells, skipping cells
 * the phone mostly clipped or crushed.
 */
export function findSpot(map: LumaMap, which: 'brightest' | 'darkest', r: number, box: Box = FULL): Region | null {
	const L = Math.max(map.w, map.h);
	const step = Math.max(2, Math.round(r * L * 1.4));
	let best: { x: number; y: number; v: number } | null = null;
	const x0 = Math.floor(box.x0 * map.w);
	const x1 = Math.ceil(box.x1 * map.w);
	const y0 = Math.floor(box.y0 * map.h);
	const y1 = Math.ceil(box.y1 * map.h);
	for (let cy = y0 + step / 2; cy < y1; cy += step)
		for (let cx = x0 + step / 2; cx < x1; cx += step) {
			const spot: Region = { kind: 'spot', x: cx / map.w, y: cy / map.h, r };
			const read = readRegion(map, spot);
			if (!read.n || read.hi > 0.2 || read.lo > 0.2) continue;
			const v = which === 'brightest' ? read.stops : -read.stops;
			if (!best || v > best.v) best = { x: spot.x, y: spot.y, v };
		}
	return best ? { kind: 'spot', x: best.x, y: best.y, r } : null;
}

/* ---------- what the film camera sees ---------- */

/** A film frame: its size in mm (landscape) and diagonal. */
export interface Gate {
	w: number;
	h: number;
	label: string;
}

const diag = (g: { w: number; h: number }) => Math.hypot(g.w, g.h);

/** The frame a camera exposes, from the film format and (for 120) the camera's name. */
export function filmGate(format: string | null | undefined, camera: string | null | undefined): Gate {
	const name = camera ?? '';
	if (format === '120') {
		if (/645|etr|6\s*[x×]\s*4\.5/i.test(name)) return { w: 56, h: 41.5, label: '6×4.5' };
		if (/\b67\b|6\s*[x×]\s*7|mamiya\s*7|rb\s*67|rz\s*67|pentax\s*67/i.test(name)) return { w: 70, h: 56, label: '6×7' };
		if (/6\s*[x×]\s*9|690|gw\s*69/i.test(name)) return { w: 84, h: 56, label: '6×9' };
		return { w: 56, h: 56, label: '6×6' };
	}
	if (format === '110') return { w: 17, h: 13, label: '110' };
	if (/\bhalf\b|\bpen\s*(f|ee|d|s)?\b|\bdemi\b|\bh35\b|ektar\s*h/i.test(name)) return { w: 24, h: 18, label: 'half frame' };
	return { w: 36, h: 24, label: '35mm' };
}

/** A focal length on this gate as its 35mm equivalent (by diagonal). */
export const equivalent35 = (focal: number, gate: Gate) => (focal * Math.hypot(36, 24)) / diag(gate);

/**
 * What the film camera's lens sees, drawn on the phone's picture: same
 * centre, the film frame's shape (turned to match the picture), sized by
 * the two diagonal angles of view. `wider` when the lens sees more than
 * the phone did (the box is then the whole picture).
 */
export function lensBox(photoW: number, photoH: number, phone35: number, lens35: number, gate: Gate): { box: Box; wider: boolean } {
	const scale = phone35 / lens35; // the lens's diagonal as a share of the phone's
	const portrait = photoH > photoW;
	const gw = portrait ? Math.min(gate.w, gate.h) : Math.max(gate.w, gate.h);
	const gh = portrait ? Math.max(gate.w, gate.h) : Math.min(gate.w, gate.h);
	const d = Math.hypot(photoW, photoH) * scale;
	const bw = (d * gw) / Math.hypot(gw, gh) / photoW;
	const bh = (d * gh) / Math.hypot(gw, gh) / photoH;
	const wider = bw > 1.001 || bh > 1.001;
	const cw = Math.min(1, bw);
	const ch = Math.min(1, bh);
	return { box: { x0: (1 - cw) / 2, y0: (1 - ch) / 2, x1: (1 + cw) / 2, y1: (1 + ch) / 2 }, wider };
}

/* ---------- false colour ---------- */

/** Film latitude around middle gray, in stops: the darkest and brightest tones that keep detail. */
export interface Latitude {
	toe: number;
	shoulder: number;
}

export const FALSE_COLOUR = [
	{ key: 'black', label: 'Goes black', rgb: [92, 40, 140] },
	{ key: 'dark', label: 'Darkest detail', rgb: [40, 110, 220] },
	{ key: 'mid', label: 'Middle gray', rgb: [60, 175, 80] },
	{ key: 'skin', label: 'A stop over', rgb: [230, 120, 175] },
	{ key: 'bright', label: 'Brightest detail', rgb: [245, 205, 55] },
	{ key: 'blown', label: 'Blows out', rgb: [225, 50, 45] },
] as const;

/**
 * A false-colour picture of where every part of the scene lands on the film
 * at an exposure: `offset` turns a pixel's scene stops into stops from the
 * film's middle gray. Everything between the marked bands shows as gray.
 */
export function falseColour(map: LumaMap, offset: number, lat: Latitude, out = new Uint8ClampedArray(map.w * map.h * 4)): Uint8ClampedArray {
	const [black, dark, mid, skin, bright, blown] = FALSE_COLOUR.map((c) => c.rgb);
	for (let i = 0, p = 0; i < map.stops.length; i++, p += 4) {
		const z = map.stops[i] + offset;
		let c: readonly number[];
		if (map.clip[i] === 1 && z >= lat.shoulder - 1) c = blown;
		else if (z >= lat.shoulder) c = blown;
		else if (z >= lat.shoulder - 1) c = bright;
		else if (z < lat.toe - 0.5) c = black;
		else if (z < lat.toe + 0.5) c = dark;
		else if (z >= -0.5 && z < 0.5) c = mid;
		else if (z >= 0.5 && z < 1.5) c = skin;
		else {
			const g = Math.round(40 + Math.max(0, Math.min(1, (z + 5) / 10)) * 190);
			c = [g, g, g];
		}
		out[p] = c[0];
		out[p + 1] = c[1];
		out[p + 2] = c[2];
		out[p + 3] = 255;
	}
	return out;
}
