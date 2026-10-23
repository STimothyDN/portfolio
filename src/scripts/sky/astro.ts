/**
 * Low-precision positional astronomy for the observatory sky and readout:
 * sidereal time, equatorial → horizon coordinates, and the Sun, Moon and
 * naked-eye planets. Good to a fraction of a degree for decades around
 * J2000 — far finer than a pixel at the sky's scale. Precession since J2000
 * (~0.4°) is ignored. All angles in radians unless a name says Deg.
 *
 * Sources: Sun and Moon from the Astronomical Almanac's low-precision
 * formulae; planets from JPL's "Approximate Positions of the Planets"
 * (Keplerian elements, 1800–2050 AD).
 */

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const julian = (ms: number) => ms / 86400000 + 2440587.5;
/** Mean obliquity of the ecliptic. */
const obliquity = (jd: number) => (23.439 - 0.0000004 * (jd - 2451545)) * DEG;

/** Local sidereal time, in hours. */
export function lstHours(jd: number, lonDeg: number) {
	const gmst = 18.697374558 + 24.06570982441908 * (jd - 2451545);
	return mod(gmst + lonDeg / 15, 24);
}

export type Equatorial = { ra: number; dec: number };
/** Unit vector in the observer's horizon frame: [east, north, up]. */
export type Horizon = [number, number, number];

function eclipticToEquatorial(lambda: number, beta: number, jd: number): Equatorial {
	const eps = obliquity(jd);
	const x = Math.cos(beta) * Math.cos(lambda);
	const y = Math.cos(eps) * Math.cos(beta) * Math.sin(lambda) - Math.sin(eps) * Math.sin(beta);
	const z = Math.sin(eps) * Math.cos(beta) * Math.sin(lambda) + Math.cos(eps) * Math.sin(beta);
	return { ra: mod(Math.atan2(y, x), TAU), dec: Math.asin(z) };
}

/**
 * Equatorial → horizon unit vector for a site, given local sidereal time
 * (radians). Azimuth runs from north through east.
 */
export function toHorizon(ra: number, dec: number, lst: number, lat: number, out: Horizon = [0, 0, 0]): Horizon {
	const ha = lst - ra;
	const sinDec = Math.sin(dec);
	const cosDec = Math.cos(dec);
	const sinLat = Math.sin(lat);
	const cosLat = Math.cos(lat);
	const cosHa = Math.cos(ha);
	out[0] = -cosDec * Math.sin(ha);
	out[1] = sinDec * cosLat - cosDec * cosHa * sinLat;
	out[2] = sinDec * sinLat + cosDec * cosHa * cosLat;
	return out;
}

export function horizonFromAltAz(altDeg: number, azDeg: number): Horizon {
	const alt = altDeg * DEG;
	const az = azDeg * DEG;
	return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

export const altitudeDeg = (v: Horizon) => Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG;

/* ── Sun ─────────────────────────────────────────────────────────────── */

export function sun(jd: number) {
	const n = jd - 2451545;
	const L = mod(280.46 + 0.9856474 * n, 360);
	const g = mod(357.528 + 0.9856003 * n, 360) * DEG;
	const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
	return { lambda, ...eclipticToEquatorial(lambda, 0, jd) };
}

/* ── Moon ────────────────────────────────────────────────────────────── */

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = 2451550.1; // 2000-01-06 18:14 UTC

const MOON_PHASES = [
	'New',
	'Waxing crescent',
	'First quarter',
	'Waxing gibbous',
	'Full',
	'Waning gibbous',
	'Last quarter',
	'Waning crescent',
];

/** Phase by lunar age — for naming; `moon()` has the geometry. */
export function moonPhase(jd: number) {
	const age = mod(jd - KNOWN_NEW_MOON, SYNODIC);
	return {
		name: MOON_PHASES[Math.floor((age / SYNODIC) * 8 + 0.5) % 8],
		illumination: (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2,
	};
}

/** Geocentric Moon (≈0.3°), plus its phase angle (0 = full, π = new). */
export function moon(jd: number) {
	const T = (jd - 2451545) / 36525;
	const s = (deg: number) => Math.sin(deg * DEG);
	const lambda =
		(218.32 +
			481267.881 * T +
			6.29 * s(135.0 + 477198.87 * T) -
			1.27 * s(259.3 - 413335.36 * T) +
			0.66 * s(235.7 + 890534.22 * T) +
			0.21 * s(269.9 + 954397.74 * T) -
			0.19 * s(357.5 + 35999.05 * T) -
			0.11 * s(186.5 + 966404.03 * T)) *
		DEG;
	const beta =
		(5.13 * s(93.3 + 483202.02 * T) +
			0.28 * s(228.2 + 960400.89 * T) -
			0.28 * s(318.3 + 6003.15 * T) -
			0.17 * s(217.6 - 407332.21 * T)) *
		DEG;
	const elongation = Math.acos(Math.cos(beta) * Math.cos(lambda - sun(jd).lambda));
	return { ...eclipticToEquatorial(lambda, beta, jd), phaseAngle: Math.PI - elongation };
}

/* ── Planets ─────────────────────────────────────────────────────────── */

type Elements = [a: number, e: number, I: number, L: number, peri: number, node: number];

/** JPL Table 1: J2000 elements and their rates per Julian century (au, deg). */
const ELEMENTS: Record<string, [Elements, Elements]> = {
	Mercury: [
		[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
		[0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
	],
	Venus: [
		[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
		[0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
	],
	Earth: [
		[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
		[0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
	],
	Mars: [
		[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
		[0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
	],
	Jupiter: [
		[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
		[-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
	],
	Saturn: [
		[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
		[-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
	],
};

/** Absolute magnitude and phase-angle correction (degrees in) per planet. */
const BRIGHTNESS: Record<string, { H: number; phase: (i: number) => number; color: string }> = {
	Mercury: { H: -0.42, phase: (i) => 3.8 * (i / 100) - 2.73 * (i / 100) ** 2 + 2 * (i / 100) ** 3, color: '230, 225, 215' },
	Venus: { H: -4.4, phase: (i) => 0.09 * (i / 100) + 2.39 * (i / 100) ** 2 - 0.65 * (i / 100) ** 3, color: '255, 250, 232' },
	Mars: { H: -1.52, phase: (i) => 0.016 * i, color: '255, 190, 150' },
	Jupiter: { H: -9.4, phase: (i) => 0.005 * i, color: '255, 244, 225' },
	Saturn: { H: -8.88, phase: (i) => 0.044 * i, color: '250, 235, 195' },
};

/** Heliocentric ecliptic position (au) from Keplerian elements. */
function heliocentric([base, rate]: [Elements, Elements], T: number): [number, number, number] {
	const [a, e, I, L, peri, node] = base.map((v, k) => v + rate[k] * T);
	const M = mod(L - peri + 180, 360) - 180;
	const w = (peri - node) * DEG;
	const i = I * DEG;
	const o = node * DEG;
	let E = M * DEG + e * Math.sin(M * DEG);
	for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M * DEG) / (1 - e * Math.cos(E));
	const xp = a * (Math.cos(E) - e);
	const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
	const [cw, sw, co, so, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(o), Math.sin(o), Math.cos(i), Math.sin(i)];
	return [
		(cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
		(cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
		sw * si * xp + cw * si * yp,
	];
}

export type Planet = Equatorial & { name: string; mag: number; color: string };

export function planets(jd: number): Planet[] {
	const T = (jd - 2451545) / 36525;
	const eps = obliquity(jd);
	const earth = heliocentric(ELEMENTS.Earth, T);
	const R = Math.hypot(...earth);
	return Object.keys(BRIGHTNESS).map((name) => {
		const p = heliocentric(ELEMENTS[name], T);
		const g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
		const r = Math.hypot(...p);
		const delta = Math.hypot(...g);
		const phaseDeg = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)))) / DEG;
		const { H, phase, color } = BRIGHTNESS[name];
		const Y = g[1] * Math.cos(eps) - g[2] * Math.sin(eps);
		const Z = g[1] * Math.sin(eps) + g[2] * Math.cos(eps);
		return {
			name,
			ra: mod(Math.atan2(Y, g[0]), TAU),
			dec: Math.atan2(Z, Math.hypot(g[0], Y)),
			mag: H + 5 * Math.log10(r * delta) + phase(phaseDeg),
			color,
		};
	});
}

/* ── Milky Way ───────────────────────────────────────────────────────── */

/** Points along the galactic equator (b = 0), with a rough surface brightness. */
export function galacticPlane(stepDeg: number) {
	const raNgp = 192.85948 * DEG;
	const decNgp = 27.12825 * DEG;
	const lNcp = 122.93192 * DEG;
	const points: (Equatorial & { weight: number })[] = [];
	for (let l = 0; l < 360; l += stepDeg) {
		const d = lNcp - l * DEG;
		const dec = Math.asin(Math.cos(decNgp) * Math.cos(d));
		const ra = mod(raNgp + Math.atan2(Math.sin(d), -Math.sin(decNgp) * Math.cos(d)), TAU);
		// Brightest toward the galactic centre (Sagittarius), a second swell in Cygnus.
		const centre = Math.max(0, Math.cos(l * DEG)) ** 1.5;
		const cygnus = Math.exp(-(((l - 78) / 22) ** 2));
		points.push({ ra, dec, weight: 0.35 + 0.65 * centre + 0.35 * cygnus });
	}
	return points;
}
