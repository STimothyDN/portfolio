/**
 * The Negative view, worked back from each scan. A lab's scanner reads the
 * negative's density and inverts it into the positive we have; this runs that
 * backwards. Each pixel goes back up its film stock's characteristic curve to
 * the density each dye layer held, then the stock's base (C-41's orange mask,
 * or a B&W film's gray) goes back on, as the strip would look on a light table.
 *
 * Two things set how a frame's negative looks:
 * - its stock's profile (below): base density, contrast and latitude;
 * - its exposure, estimated from the scan's tone at upload. Frames that look
 *   underexposed in the positive come out thin, mostly bare base, and
 *   overexposed ones come out dense.
 *
 * Each (profile, exposure) pair in use becomes one SVG filter (FilmDesk
 * renders them; the strips, roll previews and lightbox scan all point at them).
 */

export type RGB = [number, number, number];
/** A scan's black point, log-average and white point (sRGB luminance, 0–1). */
export type Tone = [number, number, number];

export interface NegativeProfile {
	/** Base + fog density of each layer (R, G, B): the orange mask, or a B&W film's clear base. */
	base: RGB;
	/** Contrast of each layer's characteristic curve: density gained per log10 of exposure. */
	gamma: RGB;
	/** Overexposure the film holds before its shoulder, in log10 above a normal highlight. */
	latitude: number;
	/** Exposure offset per layer (log10): tungsten film in daylight overexposes its blue layer. */
	balance?: RGB;
	/** How much of each dye's density bleeds into the other layers. Impure dyes mute a negative's colors. */
	crosstalk: number;
	mono?: boolean;
}

export const NEGATIVE_PROFILES = {
	// Kodak's consumer films (Gold, UltraMax, ColorPlus…), and, by most
	// accounts, the Kodak-made Fujifilm 200 and 400 that replaced C200 and
	// Superia in the US: a deep amber mask.
	kodak: { base: [0.28, 0.7, 1.18], gamma: [0.62, 0.66, 0.7], latitude: 1.4, crosstalk: 0.28 },
	// Portra: a paler, peachier mask, gentler curves, and a famously long
	// overexposure latitude.
	portra: { base: [0.22, 0.58, 1.02], gamma: [0.55, 0.57, 0.6], latitude: 2.4, crosstalk: 0.24 },
	ektar: { base: [0.24, 0.66, 1.1], gamma: [0.7, 0.74, 0.78], latitude: 1.2, crosstalk: 0.2 },
	// Fujicolor (Superia, C200, Pro 400H): a pinker, lighter mask than Kodak's.
	fuji: { base: [0.21, 0.66, 0.98], gamma: [0.64, 0.68, 0.7], latitude: 1.5, crosstalk: 0.26 },
	// Lucky: a dense, brownish mask with heavy fog and soft contrast.
	lucky: { base: [0.34, 0.76, 1.16], gamma: [0.55, 0.57, 0.6], latitude: 1.2, crosstalk: 0.34 },
	// Respooled motion-picture film (Vision3: CineStill, Candido): the deepest
	// mask and low contrast. Tungsten stocks shot in daylight overexpose their
	// blue layer, so the yellow dye runs dense.
	cine: { base: [0.26, 0.8, 1.22], gamma: [0.55, 0.56, 0.58], latitude: 2.2, crosstalk: 0.24 },
	cineTungsten: {
		base: [0.26, 0.8, 1.22],
		gamma: [0.55, 0.56, 0.58],
		latitude: 2.2,
		balance: [-0.05, 0, 0.2],
		crosstalk: 0.24,
	},
	// Long-discontinued stock, likely expired: extra fog, flatter curves.
	expired: { base: [0.36, 0.84, 1.26], gamma: [0.5, 0.52, 0.54], latitude: 1.2, crosstalk: 0.34 },
	// Any other C-41 film.
	color: { base: [0.26, 0.7, 1.12], gamma: [0.6, 0.64, 0.68], latitude: 1.6, crosstalk: 0.28 },
	// Black-and-white: silver, no dyes. Ilford's base is nearly clear with a
	// faint cool cast; Kodak's T-grain films keep a purple one.
	mono: { base: [0.24, 0.25, 0.22], gamma: [0.62, 0.62, 0.62], latitude: 2, crosstalk: 0, mono: true },
	kodakMono: { base: [0.25, 0.3, 0.24], gamma: [0.6, 0.6, 0.6], latitude: 2, crosstalk: 0, mono: true },
} satisfies Record<string, NegativeProfile>;

export type NegativeProfileKey = keyof typeof NEGATIVE_PROFILES;

/** Which profile a stock's negatives follow, from its display name and brand. */
export function negativeProfileKey(stockLabel: string, brand: string, mono: boolean): NegativeProfileKey {
	const name = stockLabel.toLowerCase();
	if (mono) return /t-?max|tri-?x|double-x/.test(name) ? 'kodakMono' : 'mono';
	if (name.includes('portra')) return 'portra';
	if (name.includes('ektar')) return 'ektar';
	if (/cinestill|candido|vision ?3|\b\d{2,3}[dt]\b/.test(name)) {
		return /\b\d{2,3}t\b|tungsten|candido/.test(name) ? 'cineTungsten' : 'cine';
	}
	if (/ektacolor|expired/.test(name)) return 'expired';
	if (brand === 'Lucky') return 'lucky';
	if (brand === 'Kodak' || /^fujifilm (200|400)$/.test(name)) return 'kodak';
	if (brand === 'Fujifilm') return 'fuji';
	return 'color';
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const LOG10_2 = Math.log10(2);

// The median scan's log-average luminance, and a clean black point.
const KEY_REF = 0.12;
const BLACK_REF = 0.006;

/**
 * A frame's exposure in stops from normal (to the half stop), estimated
 * from its scan's tone.
 */
export function frameExposure([black, key]: Tone): number {
	// The camera's meter and the lab's scanner both pull frames toward mid gray,
	// so a dark scan came from a thinner negative, though not as much thinner
	// as its pixels alone suggest. Call it half.
	const metered = 0.5 * Math.log2(KEY_REF / Math.max(toLinear(key), 1e-3));
	// Muddy, lifted shadows in a dark scan mean the scanner had to stretch a
	// thin negative: the shadows fell on the film's toe. In a bright scan
	// they're haze or flare, which add density rather than take it away.
	const murky = clamp((0.6 - key) / 0.25, 0, 1);
	const thin = 0.5 * murky * Math.max(0, Math.log2(toLinear(black) / BLACK_REF));
	return clamp(Math.round((metered - thin) * 2) / 2, -3, 2);
}

// Where a stock's curve leaves its toe (log10 exposure, relative to a normal
// highlight at 0): mid gray lands around 0.7 over base, as on a well-exposed
// C-41 negative.
const SPEED_POINT = -1.9;
const TOE = 0.22;
const SHOULDER = 0.15;
// Image density spans 0–D_RANGE in the filter's intermediate (8-bit) channel.
const D_RANGE = 2.4;
// The light table: a base of this density shows as sRGB 0.95.
const LIGHT = toLinear(0.95) * 10 ** 0.18;
const TABLE_STEPS = 33;

/** Smooth max(0, u), easing in over `w`. */
const softplus = (u: number, w: number) => (u > 20 * w ? u : w * Math.log1p(Math.exp(u / w)));
/** Smooth min(a, b), easing over `w`. */
const softmin = (a: number, b: number, w: number) => b - softplus(b - a, w);

/** Image density (above base) one layer holds for a positive's sRGB value. */
function layerDensity(v: number, gamma: number, latitude: number, offset: number): number {
	const x = Math.log10(Math.max(toLinear(v), 3e-4)) + offset;
	const d = gamma * softplus(x - SPEED_POINT, TOE);
	return softmin(d, gamma * (latitude - SPEED_POINT), SHOULDER);
}

/** sRGB a light table shows through `density` (base included). */
const shown = (density: number) => toSrgb(Math.min(1, LIGHT * 10 ** -density));

const table = (f: (t: number) => number) =>
	Array.from({ length: TABLE_STEPS }, (_, i) => +f(i / (TABLE_STEPS - 1)).toFixed(4)).join(' ');

export interface NegativeFilter {
	id: string;
	mono: boolean;
	/** feComponentTransfer tables, R/G/B: positive sRGB → image density / D_RANGE. */
	density: string[];
	/** feColorMatrix values: dye crosstalk, in density. */
	matrix: string;
	/** feComponentTransfer tables, R/G/B: image density / D_RANGE → sRGB through base + image. */
	transmit: string[];
}

export const negativeFilterId = (profile: NegativeProfileKey, exposure: number) =>
	`film-neg-${profile}-${exposure < 0 ? 'm' : 'p'}${Math.abs(exposure * 2)}`;

export function negativeFilter(key: NegativeProfileKey, exposure: number): NegativeFilter {
	const p: NegativeProfile = NEGATIVE_PROFILES[key];
	const k = p.crosstalk;
	const own = 1 - k + k / 3;
	const bleed = k / 3;
	const rows = [0, 1, 2].map((c) => [0, 1, 2].map((j) => (j === c ? own : bleed)).join(' ') + ' 0 0');
	return {
		id: negativeFilterId(key, exposure),
		mono: Boolean(p.mono),
		density: [0, 1, 2].map((c) =>
			table((v) => {
				const offset = exposure * LOG10_2 + (p.balance?.[c] ?? 0);
				return clamp(layerDensity(v, p.gamma[c], p.latitude, offset) / D_RANGE, 0, 1);
			})
		),
		matrix: [...rows, '0 0 0 1 0'].join(' '),
		transmit: [0, 1, 2].map((c) => table((d) => shown(p.base[c] + d * D_RANGE))),
	};
}

const hex = (rgb: number[]) =>
	'#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

const baseVars = new Map<NegativeProfileKey, Record<string, string>>();

/**
 * The bare film around the frames, as the custom properties the Negative
 * view's CSS reads: `--stock-frame` is unexposed base (what a frame's deepest
 * shadows thin out to), `--stock-rail` a touch denser for the sprocket edges,
 * and `--stock-ink` the dense edge printing. One shared object per stock.
 */
export function negativeBaseVars(key: NegativeProfileKey): Record<string, string> {
	let vars = baseVars.get(key);
	if (!vars) {
		const { base } = NEGATIVE_PROFILES[key];
		vars = {
			'--stock-frame': hex(base.map((d) => shown(d))),
			'--stock-rail': hex(base.map((d) => shown(d + 0.14))),
			'--stock-ink': hex(base.map((d) => shown(d + 1.3))),
		};
		baseVars.set(key, vars);
	}
	return vars;
}
