/**
 * The observatory's night sky on the GPU (WebGL2), on its own canvas under
 * the 2D one (which keeps the Moon, planets, meteors and daytime sky).
 *
 * Stars: the Bright Star Catalogue plus a few tens of thousands of fainter
 * background stars crowded toward the galactic plane — the Milky Way
 * resolves into stars. Each is one instanced quad. Their equatorial unit
 * vectors are uploaded once; every frame the vertex shader turns the sky
 * (one 3×3 matrix: sidereal time × latitude × view), projects
 * stereographically to match realsky.ts pixel for pixel, and applies the
 * twinkle, the pointer's gravity-well lens and the scroll-warp streak. The
 * CPU does no per-star work at all.
 *
 * Milky Way: a texture in galactic coordinates (banded, cloudy, with a
 * dark rift through Cygnus–Aquila), generated once on the GPU, then sampled
 * per pixel through the inverse projection.
 *
 * By day (pages with body[data-daylight]): the atmosphere instead — see
 * "Daytime: the atmosphere" below — the real Sun, and the live weather
 * (clouds.ts): clouds, fog, rain, snow and lightning.
 */
import catalog from './bright-stars.json';
import { DEG, julian, lstHours } from './astro';
import { skyNow } from './clock';
import { CIRRUS_ALT, CIRRUS_LEN, CIRRUS_WID, CLOUD_SOFT, CLOUD_TILE, CloudField, NOISE_SIZE, OCTAVES, OFFSETS, PATCH, octaveOffset } from './clouds';
import type { SkyCanvas } from './surface';
import type { SkyWeather } from './weather';

/** J2000 equatorial → galactic rotation (rows: toward the centre, l = 90°, north galactic pole). */
const GALACTIC = [
	[-0.0548755604, -0.8734370902, -0.4838350155],
	[0.4941094279, -0.44482963, 0.7469822445],
	[-0.867666149, -0.1980763734, 0.4559837762],
];

const LENS_RADIUS = 180;
const LENS_PUSH = 34;
const MILKY_WAY_W = 1024;
const MILKY_WAY_H = 256;
/** Half-height of the Milky Way texture in galactic latitude (radians). */
const MILKY_WAY_B = 0.6;
/**
 * The day sky renders at up to one pixel per CSS px (the browser scales it
 * up): it is all soft gradients and cloud, and that keeps the per-pixel
 * weather cheap on retina screens.
 */
const DAY_MAX_DPR = 1;
/** How often the CPU re-checks the clouds in front of the Sun, s. */
const SUNLIGHT_EVERY = 0.5;

type Mat3 = number[][];
const mul = (a: Mat3, b: Mat3): Mat3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const transpose = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
/** GLSL wants column-major. */
const columnMajor = (m: Mat3, out = new Float32Array(9)) => {
	out[0] = m[0][0];
	out[1] = m[1][0];
	out[2] = m[2][0];
	out[3] = m[0][1];
	out[4] = m[1][1];
	out[5] = m[2][1];
	out[6] = m[0][2];
	out[7] = m[1][2];
	out[8] = m[2][2];
	return out;
};

export type GLView = { r: number[]; u: number[]; f: number[]; K: number };
/**
 * A daytime frame: the view, the Sun as a horizon-frame unit vector [east,
 * north, up], seconds since the last frame (0 for a still) and a clock (s)
 * for the rain.
 */
export type GLDayFrame = {
	view: GLView;
	width: number;
	height: number;
	sun: number[];
	dt: number;
	time: number;
	/** The Moon as a horizon-frame unit vector, or null while it's not computed. */
	moon: number[] | null;
	/** Lens flare: the optical centre it pivots on (px) and its strength (0–1). */
	flare: { x: number; y: number; amount: number };
	/** A long read (skyPace 'calm'): no lightning, and softer rain and snow behind the text. */
	calm: boolean;
};

export type GLFrame = {
	view: GLView;
	width: number;
	height: number;
	time: number;
	lens: { x: number; y: number; amount: number };
	warp: number;
	/** The stars coming out after a switch to dark: 0 → 1 (brightest first); 1 when settled. */
	twilight: number;
};

const STAR_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aDir;
layout(location = 2) in float aMag;
layout(location = 3) in vec3 aColor;
layout(location = 4) in vec2 aTwinkle;
uniform mat3 uEqToView;
uniform vec3 uUpView;
uniform vec2 uViewport;
uniform float uK;
uniform float uTime;
uniform vec3 uLens;
uniform float uWarp;
uniform float uLimitMag;
uniform float uTwilight;
out vec2 vUv;
out vec3 vColor;
out float vAlpha;

void main() {
	vec3 v = uEqToView * aDir;
	float up = dot(v, uUpView);
	// Dusk time-lapse: the limit sweeps from the brightest stars down to the faintest.
	float limit = uTwilight < 1.0 ? mix(-1.5, uLimitMag, uTwilight) : uLimitMag;
	if (aMag > limit || up < -0.01 || v.z < -0.5) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec2 s = uK * v.xy / (1.0 + v.z);
	vec2 p = uViewport * 0.5 + vec2(s.x, -s.y);

	float alpha = aMag < 1.0 ? 1.0 : max(0.06, 1.0 - (aMag - 1.0) / 8.5);
	if (uTwilight < 1.0) alpha *= smoothstep(limit, limit - 0.8, aMag);
	if (uLens.z > 0.01) {
		vec2 d = p - uLens.xy;
		float dist = length(d);
		if (dist < ${LENS_RADIUS.toFixed(1)} && dist > 0.001) {
			float f = 1.0 - dist / ${LENS_RADIUS.toFixed(1)};
			p += d / dist * ${LENS_PUSH.toFixed(1)} * f * f * uLens.z;
			alpha = min(1.0, alpha * (1.0 + 0.8 * f * uLens.z));
		}
	}

	float scintillation = 0.1 + 0.3 * (1.0 - up);
	alpha *= 1.0 - scintillation * (0.5 + 0.5 * sin(aTwinkle.x + uTime * aTwinkle.y));
	alpha *= smoothstep(-0.01, 0.2, up);

	float bright = clamp((7.0 - aMag) / 8.5, 0.0, 1.0);
	float radius = 1.5 + 5.5 * pow(bright, 1.6);
	float depth = clamp(1.0 - aMag / 7.0, 0.0, 1.0);
	float streak = min(70.0, abs(uWarp) * 0.014 * (0.15 + depth));
	alpha *= 1.0 - min(0.6, streak / 120.0);
	// Scrolling down moves the sky up: the trail hangs below the star.
	vec2 centre = p + vec2(0.0, sign(uWarp) * streak * 0.5);
	vec2 pos = centre + aCorner * vec2(radius, radius + streak * 0.5);

	vUv = aCorner;
	vColor = aColor;
	vAlpha = alpha;
	gl_Position = vec4(pos.x / uViewport.x * 2.0 - 1.0, 1.0 - pos.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const STAR_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
	float d2 = dot(vUv, vUv);
	if (d2 > 1.0) discard;
	// A broad core and a soft halo — the 2D sprites' profile.
	float a = vAlpha * (exp(-d2 * 7.0) + 0.35 * exp(-d2 * 2.5));
	outColor = vec4(vColor * a, a);
}`;

const FULLSCREEN_VS = /* glsl */ `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
	vec2 c = corners[gl_VertexID];
	vUv = c * 0.5 + 0.5;
	gl_Position = vec4(c, 0.0, 1.0);
}`;

/** One-time pass: the Milky Way's surface brightness in galactic (l, b). */
const MILKY_GEN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
const float TAU = 6.283185307;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}
float fbm(vec3 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
	return v;
}
float wrapped(float a) { return atan(sin(a), cos(a)); }

void main() {
	float l = vUv.x * TAU;
	float b = (vUv.y - 0.5) * 2.0 * ${MILKY_WAY_B.toFixed(3)};
	vec3 dir = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
	float toCentre = pow(max(cos(l), 0.0), 1.5);
	// Thicker toward the bulge.
	float sigma = 0.1 + 0.11 * pow(max(cos(l), 0.0), 3.0);
	float band = exp(-(b * b) / (sigma * sigma));
	float cygnus = exp(-pow(wrapped(l - 1.361) / 0.384, 2.0));
	float along = 0.35 + 0.65 * toCentre + 0.35 * cygnus;
	float clouds = 0.35 + 1.25 * fbm(dir * 3.2);
	// The Great Rift: a dusty lane just north of the plane, Cygnus to the centre.
	float riftSpan = smoothstep(-0.35, -0.1, wrapped(l)) * (1.0 - smoothstep(1.35, 1.6, wrapped(l)));
	float rift = exp(-pow((b - 0.035) / 0.035, 2.0)) * riftSpan * smoothstep(0.35, 0.65, fbm(dir * 7.0 + 3.7));
	// Stored at 0.45× so the bright core fits 8-bit; the sky pass scales back up.
	float bright = band * along * clouds * (1.0 - 0.75 * rift) * 0.45;
	vec3 colour = mix(vec3(0.72, 0.78, 1.0), vec3(1.0, 0.88, 0.74), toCentre * band);
	outColor = vec4(colour * bright, 1.0);
}`;

/** Per frame: each pixel back through the projection into galactic (l, b). */
const MILKY_SKY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform mat3 uViewToGal;
uniform vec3 uUpView;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uK;
uniform float uIntensity;
uniform sampler2D uMilky;
out vec4 outColor;
const float TAU = 6.283185307;
void main() {
	vec2 s = (gl_FragCoord.xy / uDpr - uViewport * 0.5) / uK;
	float ss = dot(s, s);
	vec3 v = vec3(2.0 * s, 1.0 - ss) / (1.0 + ss);
	float up = dot(v, uUpView);
	if (up < -0.02) discard;
	vec3 g = uViewToGal * v;
	float b = asin(clamp(g.z, -1.0, 1.0));
	if (abs(b) > ${MILKY_WAY_B.toFixed(3)}) discard;
	float l = atan(g.y, g.x);
	vec2 uv = vec2(l / TAU + 1.0, b / ${(2 * MILKY_WAY_B).toFixed(3)} + 0.5);
	vec3 c = texture(uMilky, uv).rgb * uIntensity * smoothstep(-0.02, 0.25, up);
	outColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

/* ── Daytime: the atmosphere ─────────────────────────────────────────────
 * Single scattering (Rayleigh + Mie) through a 100 km atmosphere over the
 * site, integrated into a small sky lookup table (relative azimuth to the
 * Sun × altitude, denser near the horizon) whenever the Sun moves. Each
 * frame, every pixel finds its direction through the same projection as the
 * stars and looks its colour up. */

const SKY_LUT_W = 192;
const SKY_LUT_H = 108;

const SKY_LUT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uSunAlt;
// 1 when the table is half-float (store radiance as is), 0 for 8-bit (tonemap to fit).
uniform float uFloat;
const float PI = 3.14159265;
const float R_PLANET = 6371e3;
const float R_ATMOS = 6471e3;
const vec3 K_RLH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_MIE = 21e-6;
const float SH_RLH = 8e3;
const float SH_MIE = 1.2e3;
const float G = 0.758;
const float I_SUN = 22.0;

// Ray-sphere intersection (sphere at the origin): near and far distances.
vec2 rsi(vec3 r0, vec3 rd, float sr) {
	float b = 2.0 * dot(rd, r0);
	float c = dot(r0, r0) - sr * sr;
	float d = b * b - 4.0 * c;
	if (d < 0.0) return vec2(1e5, -1e5);
	return vec2((-b - sqrt(d)) * 0.5, (-b + sqrt(d)) * 0.5);
}

vec3 scatter(vec3 dir, vec3 sunDir) {
	vec3 r0 = vec3(0.0, 0.0, R_PLANET + 100.0);
	vec2 p = rsi(r0, dir, R_ATMOS);
	if (p.x > p.y) return vec3(0.0);
	vec2 ground = rsi(r0, dir, R_PLANET);
	float end = ground.x > 0.0 ? min(p.y, ground.x) : p.y;
	float stepLen = end / 16.0;
	float mu = dot(dir, sunDir);
	float gg = G * G;
	float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
	float phaseM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mu * mu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * G, 1.5) * (2.0 + gg));
	vec3 sumR = vec3(0.0);
	vec3 sumM = vec3(0.0);
	float odR = 0.0;
	float odM = 0.0;
	for (int i = 0; i < 16; i++) {
		vec3 pos = r0 + dir * (stepLen * (float(i) + 0.5));
		float h = length(pos) - R_PLANET;
		float dR = exp(-h / SH_RLH) * stepLen;
		float dM = exp(-h / SH_MIE) * stepLen;
		odR += dR;
		odM += dM;
		float lightLen = rsi(pos, sunDir, R_ATMOS).y / 8.0;
		float lR = 0.0;
		float lM = 0.0;
		for (int j = 0; j < 8; j++) {
			vec3 lp = pos + sunDir * (lightLen * (float(j) + 0.5));
			float lh = length(lp) - R_PLANET;
			lR += exp(-lh / SH_RLH) * lightLen;
			lM += exp(-lh / SH_MIE) * lightLen;
		}
		vec3 atten = exp(-(K_MIE * (odM + lM) + K_RLH * (odR + lR)));
		sumR += dR * atten;
		sumM += dM * atten;
	}
	return I_SUN * (phaseR * K_RLH * sumR + phaseM * K_MIE * sumM);
}

void main() {
	// u: azimuth away from the Sun, 0…π. v: altitude, squared toward the horizon.
	float phi = vUv.x * PI;
	float t = (vUv.y - 0.5) * 2.0;
	float alt = sign(t) * t * t * PI * 0.5;
	vec3 dir = vec3(sin(phi) * cos(alt), cos(phi) * cos(alt), sin(alt));
	vec3 sunDir = vec3(0.0, cos(uSunAlt), sin(uSunAlt));
	// Exposure rises as the Sun sinks, like an eye adapting into twilight.
	float exposure = mix(1.0, 6.0, smoothstep(0.15, -0.1, uSunAlt));
	vec3 radiance = scatter(dir, sunDir) * exposure;
	outColor = vec4(uFloat > 0.5 ? radiance : 1.0 - exp(-radiance), 1.0);
}`;

/**
 * Per frame: look each pixel up, grade it pastel, then the weather — cirrus,
 * cumulus (ray-cast onto their sheets), fog — the Sun, and rain or snow.
 * No texture reads sit behind per-pixel branches, so the mipmapped noise
 * stays well defined right down to the horizon.
 */
const DAY_SKY_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uLut;
uniform sampler2D uNoise;
uniform vec3 uR;
uniform vec3 uU;
uniform vec3 uF;
uniform vec3 uSun;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uK;
uniform float uSunRadius;
// Weather (clouds.ts): cumulus threshold, overcast, cumulus base (m), cirrus; cumulus opacity.
uniform vec4 uCloud;
uniform float uCumulus;
// Octave offsets (clouds.ts OFFSETS): base, patch, finer octaves, cirrus ×1/×2, cirrus bands.
uniform vec2 uOff[${OFFSETS}];
uniform vec2 uCirrusDir;
// Rain, snow, fog (0–1).
uniform vec3 uFall;
// Share of direct sunlight getting through the clouds.
uniform float uSunT;
uniform float uSlant;
uniform float uTime;
// Lightning: screen point (px, y down) and brightness.
uniform vec3 uFlash;
// The Moon (horizon frame); w = 1 to draw it.
uniform vec4 uMoon;
// Lens flare: the optical centre it pivots on (px, y down) and its strength.
uniform vec3 uFlare;
// 1 on long reads: rain and snow streaks softened behind the text.
uniform float uCalm;
const float PI = 3.14159265;
const float TILE = ${CLOUD_TILE.toFixed(1)};
const float SOFT = ${CLOUD_SOFT.toFixed(3)};

vec3 toOklab(vec3 c) {
	float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
	float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
	float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
	l = pow(l, 1.0 / 3.0);
	m = pow(m, 1.0 / 3.0);
	s = pow(s, 1.0 / 3.0);
	return vec3(
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
vec3 fromOklab(vec3 c) {
	float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
	float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
	float s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
	l = l * l * l;
	m = m * m * m;
	s = s * s * s;
	return vec3(
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
vec3 toSrgb(vec3 c) {
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// Distance to a hexagon of apothem r (the lens's six-bladed aperture).
float hexagon(vec2 p, float r) {
	const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
	p = abs(p);
	p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
	p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
	return length(p) * sign(p.y);
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// The cumulus noise at a point on its sheet (m) — mirrored by CloudField.billows.
float billows(vec2 p) {
	vec2 uv = p / TILE;
	float n = ${OCTAVES.map(([c, scale, w], i) => `${w.toFixed(3)} * texture(uNoise, uv * ${scale.toFixed(1)} + uOff[${octaveOffset(i)}]).${c}`).join('\n\t\t+ ')};
	float patchiness = texture(uNoise, uv * 0.25 + uOff[1]).r;
	return n - (patchiness - 0.5) * ${PATCH.toFixed(3)};
}

// Its broad shapes only (the first three octaves, rescaled): enough to shade by.
float billowsCoarse(vec2 p) {
	vec2 uv = p / TILE;
	float n = ${OCTAVES.slice(0, 3).map(([c, scale, w], i) => `${w.toFixed(3)} * texture(uNoise, uv * ${scale.toFixed(1)} + uOff[${octaveOffset(i)}]).${c}`).join('\n\t\t+ ')};
	float patchiness = texture(uNoise, uv * 0.25 + uOff[1]).r;
	return n / ${OCTAVES.slice(0, 3).reduce((sum, [, , w]) => sum + w, 0).toFixed(3)} - (patchiness - 0.5) * ${PATCH.toFixed(3)};
}

// One depth of rain: sparse streaks in sheared cells, falling, brightest at the head.
float rainLayer(vec2 px, float cell, float speed, float seed, float density) {
	vec2 q = vec2(px.x - px.y * uSlant, px.y - uTime * speed);
	vec2 g = q / vec2(cell, cell * 6.0);
	vec2 id = floor(g);
	vec2 f = fract(g);
	if (hash(id + seed) > density) return 0.0;
	float x0 = 0.2 + 0.6 * hash(id + seed + 1.7);
	float len = 0.4 + 0.45 * hash(id + seed + 3.1);
	float y0 = (1.0 - len) * hash(id + seed + 5.3);
	float along = (f.y - y0) / len;
	if (along < 0.0 || along > 1.0) return 0.0;
	float dx = abs(f.x - x0) * cell;
	float width = 0.45 + cell * 0.018;
	return smoothstep(width + 0.7, width - 0.3, dx) * along * smoothstep(1.0, 0.9, along);
}

// One depth of snow: a flake per occupied cell, drifting and swaying.
float snowLayer(vec2 px, float cell, float speed, float seed, float density, float size) {
	vec2 q = vec2(px.x - uTime * speed * uSlant * 2.0, px.y - uTime * speed);
	vec2 g = q / cell;
	vec2 id = floor(g);
	vec2 f = fract(g);
	float r = hash(id + seed);
	if (r > density) return 0.0;
	vec2 c = vec2(0.25 + 0.5 * hash(id + seed + 1.3), 0.25 + 0.5 * hash(id + seed + 2.9));
	c.x += 0.18 * sin(uTime * (0.6 + hash(id + seed + 4.1)) + r * 40.0);
	return smoothstep(size, size * 0.25, length((f - c) * cell));
}

void main() {
	// Back through the stereographic projection to a direction in the sky.
	vec2 fc = gl_FragCoord.xy / uDpr;
	vec2 px = vec2(fc.x, uViewport.y - fc.y);
	vec2 s = (fc - uViewport * 0.5) / uK;
	float ss = dot(s, s);
	vec3 v = vec3(2.0 * s, 1.0 - ss) / (1.0 + ss);
	vec3 h = normalize(v.x * uR + v.y * uU + v.z * uF);
	float alt = asin(clamp(h.z, -1.0, 1.0));
	vec2 hz = h.xy;
	vec2 sz = uSun.xy;
	float phi = length(hz) < 1e-4 || length(sz) < 1e-4 ? 0.0 : acos(clamp(dot(normalize(hz), normalize(sz)), -1.0, 1.0));
	float altClamped = max(alt, -0.05);
	float tv = sqrt(abs(altClamped) / (PI * 0.5)) * sign(altClamped);
	vec3 sky = texture(uLut, vec2(phi / PI, tv * 0.5 + 0.5)).rgb;

	// Grade: keep where the model is warm (near a low Sun) or cool (blue
	// sky), but paint it with the site's palette — warm → peach, through rose
	// and violet, cool → lavender-blue (never the khaki/teal of a literal
	// pastel twilight) — and lift it to a pale, high-key pastel the page's
	// dark ink reads on.
	vec3 lab = toOklab(max(sky, vec3(1e-5)));
	float c = length(lab.yz);
	float coolness = c > 1e-4 ? dot(lab.yz / c, vec2(cos(4.36), sin(4.36))) : 1.0;
	float hue = mix(0.79, -1.43, smoothstep(-0.5, 0.6, coolness));
	float horizon = 1.0 - smoothstep(0.0, 0.7, alt);
	float L = mix(mix(0.83, 0.965, horizon), clamp(lab.x, 0.0, 1.0), 0.25);
	float chroma = clamp(c * 1.6, 0.03, 0.1);
	vec3 graded = vec3(L, chroma * cos(hue), chroma * sin(hue));

	// Night in light mode: the model goes dark, so hand over to a fixed
	// periwinkle pastel through civil twilight.
	float sunAlt = asin(clamp(uSun.z, -1.0, 1.0));
	float night = smoothstep(-0.05, -0.16, sunAlt);
	vec3 nightLab = vec3(mix(0.83, 0.94, horizon), 0.012, -0.05 + 0.02 * horizon);
	lab = mix(graded, nightLab, night);

	// The Moon, beyond the clouds: only its sunlit part shows against the
	// day (the terminator from the true Sun direction), pale, with faint
	// maria; brighter on the periwinkle night. Drawn ~3.5× true size, as the Sun.
	vec3 mDir = uMoon.xyz;
	vec3 mE1 = normalize(cross(abs(mDir.z) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0), mDir));
	vec3 mE2 = cross(mDir, mE1);
	vec2 mUv = vec2(dot(h, mE1), dot(h, mE2)) / uSunRadius;
	float mR2 = dot(mUv, mUv);
	vec3 mNormal = mUv.x * mE1 + mUv.y * mE2 - sqrt(max(0.0, 1.0 - mR2)) * mDir;
	float mLit = smoothstep(-0.04, 0.14, dot(mNormal, uSun));
	float maria = smoothstep(0.42, 0.72, textureLod(uNoise, mUv * 0.16 + vec2(0.31, 0.57), 0.0).g);
	float moon = uMoon.w * step(0.0, dot(h, mDir)) * smoothstep(1.0, 0.9, sqrt(mR2)) * mLit
		* smoothstep(-0.02, 0.03, mDir.z) * mix(0.72, 0.95, night);
	lab = mix(lab, vec3(0.985 - 0.07 * maria, -0.002, -0.008), moon);

	// Light on the clouds: white at noon, peach low; thin cloud by the Sun
	// glows (Henyey–Greenstein forward scattering, 1 at the Sun); just after
	// sunset the Sun lights their bases from beneath.
	float theta = acos(clamp(dot(h, uSun), -1.0, 1.0));
	float up = smoothstep(-0.03, 0.02, sunAlt);
	float golden = 1.0 - smoothstep(0.05, 0.32, sunAlt);
	float under = smoothstep(0.1, 0.0, sunAlt) * smoothstep(-0.15, -0.05, sunAlt);
	const float G = 0.7;
	float hg = (1.0 - G * G) / pow(1.0 + G * G - 2.0 * G * cos(theta), 1.5) * (1.0 - G) * (1.0 - G) / (1.0 + G);
	vec2 sunH = uSun.xy / max(length(uSun.xy), 1e-4);
	float towardSun = 0.5 + 0.5 * dot(h.xy / max(length(h.xy), 1e-4), sunH);
	float upward = max(h.z, 0.012);
	float aboveHorizon = smoothstep(0.012, 0.06, h.z);

	// Cirrus: the noise stretched along the upper wind into fibrous streaks,
	// gathered into bands — mirrored by CloudField.cirrus.
	float tc = ${CIRRUS_ALT.toFixed(1)} / upward;
	vec2 pc = h.xy * tc;
	vec2 cq = vec2(dot(pc, uCirrusDir), dot(pc, vec2(-uCirrusDir.y, uCirrusDir.x))) / vec2(${CIRRUS_LEN.toFixed(1)}, ${CIRRUS_WID.toFixed(1)});
	float broad = texture(uNoise, cq * vec2(0.25, 0.5) + vec2(uOff[8].x, 0.13)).r;
	cq.y += (broad - 0.5) * 0.8;
	float fibres = 0.55 * texture(uNoise, cq + vec2(uOff[7].x, 0.0)).r
		+ 0.3 * texture(uNoise, cq * vec2(2.0, 4.0) + vec2(uOff[7].y, 0.31)).r
		+ 0.15 * texture(uNoise, cq * vec2(1.0, 8.0) + vec2(uOff[7].x, 0.67)).g;
	float bands = smoothstep(0.38, 0.68, broad + uCloud.w * 0.3 - 0.15);
	float cThr = mix(0.74, 0.44, uCloud.w);
	// Hair-fine striations along each streak.
	float strands = 0.55 + 0.45 * texture(uNoise, cq * vec2(1.0, 20.0) + vec2(uOff[7].x, 0.5)).r;
	float cirrus = smoothstep(cThr, cThr + 0.2, fibres) * bands * strands * 0.34 * step(0.001, uCloud.w) * exp(-tc / 120000.0) * aboveHorizon;
	vec3 cirrusLab = mix(vec3(0.99, 0.0, 0.006), vec3(0.94, 0.035, 0.045), golden);
	cirrusLab.x = min(1.0, cirrusLab.x + hg * 0.08 * up);
	cirrusLab = mix(cirrusLab, vec3(0.9, 0.006, -0.03), night);
	lab = mix(lab, cirrusLab, cirrus);

	// Cumulus: the ray meets the sheet at distance t; the cover threshold
	// cuts the noise into cells, thicker toward their cores; a second look
	// toward the Sun shades the sides turned away from it.
	float t = uCloud.z / upward;
	vec2 p = h.xy * t;
	float n = billows(p);
	float d = smoothstep(uCloud.x, uCloud.x + SOFT, n);
	float thick = clamp((n - uCloud.x) / 0.16, 0.0, 1.0);
	// Overcast: the cells close into a deck with only a soft texture left.
	d = mix(d, 0.93 + 0.07 * smoothstep(0.3, 0.7, n), uCloud.y);
	thick = mix(thick, 0.4 + 0.6 * smoothstep(0.32, 0.68, n), uCloud.y);
	float block = smoothstep(uCloud.x, uCloud.x + 0.12, billowsCoarse(p + sunH * 700.0)) * (1.0 - uCloud.y);
	float lit = exp(-1.9 * thick - 1.3 * block);
	vec3 litLab = mix(vec3(0.985, 0.002, 0.01), vec3(0.94, 0.03, 0.05), golden);
	// Bases stay light (an overcast sky is bright), above the floor below.
	vec3 baseLab = vec3(0.86 - 0.04 * uCloud.y - 0.03 * uFall.x, 0.006, -0.03);
	vec3 cloud = mix(baseLab, litLab, lit * up);
	// (Through a closed deck the Sun is only a faint brighter patch.)
	cloud.x += (hg * (1.0 - thick) * 0.3 * (1.0 - 0.8 * uCloud.y) + 0.04 * exp(-theta / 0.25) * uCloud.y) * up;
	cloud = mix(cloud, vec3(0.87, 0.07, 0.035), under * (0.35 + 0.55 * towardSun) * (1.0 - 0.6 * uCloud.y));
	cloud = mix(cloud, vec3(0.88 + 0.04 * (1.0 - thick), 0.008, -0.04), night);
	cloud.yz = mix(cloud.yz, lab.yz, 0.25);
	// Lightning, somewhere inside the deck.
	vec2 toBolt = px - uFlash.xy;
	cloud += vec3(0.16 * (0.4 + thick), -0.004, -0.02) * uFlash.z * exp(-dot(toBolt, toBolt) / 135000.0);
	float cumulus = d * exp(-t / 50000.0) * aboveHorizon * uCumulus;
	lab = mix(lab, cloud, cumulus);

	// A floor under everything: the page's text sits on this sky, and its
	// greys (styles/daylight.css) are set to clear 4.5:1 against L 0.8.
	lab.x = max(lab.x, 0.8);

	// Fog, and the grey veil hanging under rain or snow.
	float fog = clamp(uFall.z * mix(0.55, 1.0, horizon) + (uFall.x * 0.3 + uFall.y * 0.25) * horizon, 0.0, 0.95);
	lab = mix(lab, mix(vec3(0.935, 0.004, -0.014), vec3(0.9, 0.006, -0.035), night), fog);
	vec3 colour = toSrgb(clamp(fromOklab(lab), 0.0, 1.0));

	// The Sun (drawn ~3.5× true size): limb-darkened disc and a warm glow,
	// reddening near the horizon; hidden where cloud covers it, a pale plain
	// disc through fog, its glow dimmed by whatever is between it and us.
	vec3 sunTint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0, 0.97, 0.9), smoothstep(0.0, 0.35, sunAlt));
	sunTint = mix(sunTint, vec3(1.0), uFall.z * 0.6);
	float mu = sqrt(max(0.0, 1.0 - pow(theta / uSunRadius, 2.0)));
	float disc = smoothstep(uSunRadius, uSunRadius * 0.92, theta) * (0.6 + 0.4 * mu);
	float glow = 0.42 * exp(-theta / 0.05) + 0.22 * exp(-theta / 0.22);
	float veil = clamp(cumulus + cirrus * 0.6, 0.0, 1.0);
	colour = mix(colour, sunTint, disc * up * (1.0 - 0.97 * veil) * (1.0 - 0.55 * uFall.z));
	colour += sunTint * glow * up * mix(0.06, 1.0, uSunT) * (1.0 - 0.8 * uFall.z) * (1.0 - colour) * 0.9;

	// Lens flare (a nod to the camera), only while the Sun is out and near
	// the frame: its six-point star, and ghosts of the six-bladed aperture
	// strung along the line from the Sun through the optical centre — the
	// cursor steers it — tinted like coated glass.
	vec3 sv = vec3(dot(uSun, uR), dot(uSun, uU), dot(uSun, uF));
	vec2 sunFc = uViewport * 0.5 + uK * sv.xy / max(1.0 + sv.z, 0.05);
	vec2 outside = max(abs(sunFc - uViewport * 0.5) - uViewport * 0.5, 0.0);
	float sunlit = up * uSunT * (1.0 - uFall.z) * step(-0.5, sv.z) * (1.0 - smoothstep(0.0, 220.0, length(outside)));
	if (sunlit > 0.002) {
		vec2 fromSun = fc - sunFc;
		float spokes = pow(abs(cos(3.0 * (atan(fromSun.y, fromSun.x) - 0.26))), 90.0);
		colour += sunTint * spokes * exp(-length(fromSun) / 95.0) * 0.32 * sunlit * (1.0 - colour);

		vec2 axis = vec2(uFlare.x, uViewport.y - uFlare.y) - sunFc;
		const float AT[6] = float[6](0.32, 0.58, 0.9, 1.3, 1.62, 2.15);
		const float SIZE[6] = float[6](22.0, 11.0, 48.0, 16.0, 30.0, 74.0);
		const float ALPHA[6] = float[6](0.2, 0.3, 0.13, 0.24, 0.17, 0.11);
		const vec3 TINT[6] = vec3[6](
			vec3(0.62, 0.5, 0.98), vec3(1.0, 0.78, 0.62), vec3(0.7, 0.8, 1.0),
			vec3(0.98, 0.66, 0.82), vec3(0.6, 0.52, 0.95), vec3(1.0, 0.84, 0.7));
		mat2 blades = mat2(0.966, 0.259, -0.259, 0.966);
		float ghosts = 0.0;
		for (int i = 0; i < 6; i++) {
			float sd = hexagon(blades * (fc - (sunFc + axis * AT[i])), SIZE[i]);
			// A soft-edged pane with a slightly brighter rim.
			float g = smoothstep(1.5, -1.5, sd) * 0.75 + smoothstep(3.0, 0.0, abs(sd)) * 0.25;
			colour = mix(colour, TINT[i], g * ALPHA[i] * uFlare.z * sunlit);
		}
	}

	// Rain: three depths of streaks leaning with the wind. Snow: three of
	// flakes. Both catch the light against a grey deck, but show dark against
	// a bright sky (they're lit from behind).
	float backdrop = dot(colour, vec3(0.2126, 0.7152, 0.0722));
	vec3 fallColour = mix(vec3(0.98, 0.98, 1.0), vec3(0.5, 0.49, 0.6), smoothstep(0.8, 0.95, backdrop));
	if (uFall.x > 0.002) {
		float density = 0.4 + 0.6 * uFall.x;
		float r = rainLayer(px, 9.0, 520.0, 1.0, 0.3 * density) * 0.45
			+ rainLayer(px, 17.0, 820.0, 7.0, 0.22 * density) * 0.7
			+ rainLayer(px, 31.0, 1250.0, 13.0, 0.13 * density);
		colour = mix(colour, fallColour, clamp(r * (0.25 + 0.3 * uFall.x), 0.0, 0.55) * (1.0 - 0.6 * uCalm));
	}
	if (uFall.y > 0.002) {
		float density = 0.35 + 0.65 * uFall.y;
		float flakes = snowLayer(px, 40.0, 38.0, 3.0, 0.55 * density, 1.7) * 0.6
			+ snowLayer(px, 64.0, 62.0, 11.0, 0.45 * density, 2.6) * 0.8
			+ snowLayer(px, 100.0, 95.0, 19.0, 0.32 * density, 3.8);
		colour = mix(colour, fallColour, clamp(flakes * (0.45 + 0.4 * uFall.y), 0.0, 0.85) * (1.0 - 0.6 * uCalm));
	}

	colour += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
	outColor = vec4(colour, 1.0);
}`;

const STAR_UNIFORMS = ['uEqToView', 'uUpView', 'uViewport', 'uK', 'uTime', 'uLens', 'uWarp', 'uLimitMag', 'uTwilight'] as const;
const MILKY_UNIFORMS = ['uViewToGal', 'uUpView', 'uViewport', 'uDpr', 'uK', 'uIntensity', 'uMilky'] as const;
const LUT_UNIFORMS = ['uSunAlt', 'uFloat'] as const;
const DAY_UNIFORMS = [
	'uLut',
	'uNoise',
	'uR',
	'uU',
	'uF',
	'uSun',
	'uViewport',
	'uDpr',
	'uK',
	'uSunRadius',
	'uCloud',
	'uCumulus',
	'uOff',
	'uCirrusDir',
	'uFall',
	'uSunT',
	'uSlant',
	'uTime',
	'uFlash',
	'uMoon',
	'uFlare',
	'uCalm',
] as const;

type Uniforms<K extends string> = Record<K, WebGLUniformLocation | null>;

/** A program's uniform locations, looked up once (not by name every frame). */
function locate<K extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly K[]) {
	const out = {} as Uniforms<K>;
	for (const name of names) out[name] = gl.getUniformLocation(program, name);
	return out;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
	const program = gl.createProgram()!;
	for (const [type, source] of [
		[gl.VERTEX_SHADER, vs],
		[gl.FRAGMENT_SHADER, fs],
	] as const) {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
		gl.attachShader(program, shader);
	}
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
	return program;
}

/** Subtle B−V tints, blue-white → orange-red (matches realsky.ts), as 0–1 RGB. */
const TINTS = [
	[205, 220, 255],
	[236, 241, 255],
	[255, 251, 242],
	[255, 242, 218],
	[255, 226, 192],
	[255, 208, 178],
].map((c) => c.map((v) => v / 255));
const tintFor = (bv: number) => TINTS[bv < -0.1 ? 0 : bv < 0.25 ? 1 : bv < 0.55 ? 2 : bv < 0.9 ? 3 : bv < 1.35 ? 4 : 5];

const FLOATS_PER_STAR = 9; // dir.xyz, mag, rgb, phase, speed

/** Catalogue stars, then background stars crowded toward the galactic plane. */
function buildStars(backgroundCount: number) {
	const data = catalog.data as number[];
	const catalogCount = data.length / 4;
	const out = new Float32Array((catalogCount + backgroundCount) * FLOATS_PER_STAR);
	let seed = 1337;
	const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
	const put = (i: number, dx: number, dy: number, dz: number, mag: number, tint: number[]) => {
		const o = i * FLOATS_PER_STAR;
		out[o] = dx;
		out[o + 1] = dy;
		out[o + 2] = dz;
		out[o + 3] = mag;
		out[o + 4] = tint[0];
		out[o + 5] = tint[1];
		out[o + 6] = tint[2];
		out[o + 7] = rand() * Math.PI * 2;
		out[o + 8] = 0.6 + rand() * 1.6;
	};

	for (let i = 0; i < catalogCount; i++) {
		const ra = (data[i * 4] / 100) * DEG;
		const dec = (data[i * 4 + 1] / 100) * DEG;
		const cosDec = Math.cos(dec);
		put(i, cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec), data[i * 4 + 2] / 10, tintFor(data[i * 4 + 3] / 10));
	}

	const toEquatorial = transpose(GALACTIC);
	const r0 = toEquatorial[0];
	const r1 = toEquatorial[1];
	const r2 = toEquatorial[2];
	const bg = new Float32Array(backgroundCount * FLOATS_PER_STAR);
	const order = new Int32Array(backgroundCount);
	for (let k = 0; k < backgroundCount; k++) {
		order[k] = k;
		let l: number;
		let b: number;
		if (rand() < 0.6) {
			// In the disc: thin in latitude, densest toward the centre.
			b = gauss() * 0.16;
			l = rand() < 0.4 ? gauss() * 0.7 : rand() * Math.PI * 2;
		} else {
			// Spread over the whole sphere.
			b = Math.asin(rand() * 2 - 1);
			l = rand() * Math.PI * 2;
		}
		const cosB = Math.cos(b);
		const gx = cosB * Math.cos(l);
		const gy = cosB * Math.sin(l);
		const gz = Math.sin(b);
		const mag = 6.5 + 2.6 * Math.pow(rand(), 0.55);
		const tint = TINTS[1 + Math.floor(rand() * 4)];
		const o = k * FLOATS_PER_STAR;
		bg[o] = r0[0] * gx + r0[1] * gy + r0[2] * gz;
		bg[o + 1] = r1[0] * gx + r1[1] * gy + r1[2] * gz;
		bg[o + 2] = r2[0] * gx + r2[1] * gy + r2[2] * gz;
		bg[o + 3] = mag;
		bg[o + 4] = tint[0];
		bg[o + 5] = tint[1];
		bg[o + 6] = tint[2];
		bg[o + 7] = rand() * Math.PI * 2;
		bg[o + 8] = 0.6 + rand() * 1.6;
	}
	// Sort background stars by magnitude ascending so smaller viewports can
	// submit only the visible prefix to drawArraysInstanced.
	order.sort((a, b) => bg[a * FLOATS_PER_STAR + 3] - bg[b * FLOATS_PER_STAR + 3]);
	let count82 = catalogCount;
	let count86 = catalogCount;
	for (let k = 0; k < backgroundCount; k++) {
		const src = order[k] * FLOATS_PER_STAR;
		const dst = (catalogCount + k) * FLOATS_PER_STAR;
		for (let j = 0; j < FLOATS_PER_STAR; j++) out[dst + j] = bg[src + j];
		const mag = bg[src + 3];
		if (mag <= 8.2) count82 = catalogCount + k + 1;
		if (mag <= 8.6) count86 = catalogCount + k + 1;
	}
	return { stars: out, count: catalogCount + backgroundCount, count82, count86 };
}

export class GLSky {
	private gl: WebGL2RenderingContext;
	private emptyVao: WebGLVertexArrayObject;
	private starU!: Uniforms<(typeof STAR_UNIFORMS)[number]>;
	private milkyU!: Uniforms<(typeof MILKY_UNIFORMS)[number]>;
	private lutU!: Uniforms<(typeof LUT_UNIFORMS)[number]>;
	private dayU!: Uniforms<(typeof DAY_UNIFORMS)[number]>;
	private nightReady = false;
	private starProgram!: WebGLProgram;
	private skyProgram!: WebGLProgram;
	private starVao!: WebGLVertexArrayObject;
	private milky!: WebGLTexture;
	private count = 0;
	private count82 = 0;
	private count86 = 0;
	private dayReady = false;
	private dayProgram!: WebGLProgram;
	private lutProgram!: WebGLProgram;
	private lut!: WebGLTexture;
	private lutFramebuffer!: WebGLFramebuffer;
	/** Sun altitude the sky table was last integrated for (radians). */
	private lutSunAlt = NaN;
	private lutFloat = false;
	private noise!: WebGLTexture;
	private _weather: CloudField | null = null;
	/** The latest weather, kept until the day sky is first built. */
	private pendingWeather: SkyWeather | null = null;
	private reducedMotion = false;
	private sunlightIn = 0;
	/** Direct sunlight reaching the ground through the clouds (0–1), refreshed twice a second. */
	sunlight = 1;
	private dpr = 1;
	private width = 1;
	private height = 1;
	private lost = false;
	drawn = 0;
	private matBufA = new Float32Array(9);
	private matBufB = new Float32Array(9);
	private upViewBuf = new Float32Array(3);

	constructor(
		private canvas: SkyCanvas,
		private latDeg: number,
		private lonDeg: number
	) {
		const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false }) as WebGL2RenderingContext | null;
		if (!gl) throw new Error('webgl2 unavailable');
		this.gl = gl;
		canvas.addEventListener('webglcontextlost', (event) => {
			event.preventDefault();
			this.lost = true;
		});
		this.emptyVao = gl.createVertexArray()!;
	}

	private ensureNight() {
		if (this.nightReady) return;
		this.nightReady = true;
		const gl = this.gl;

		this.starProgram = compile(gl, STAR_VS, STAR_FS);
		this.skyProgram = compile(gl, FULLSCREEN_VS, MILKY_SKY_FS);
		this.starU = locate(gl, this.starProgram, STAR_UNIFORMS);
		this.milkyU = locate(gl, this.skyProgram, MILKY_UNIFORMS);
		// Constants, set once: uniforms keep their values per program.
		gl.useProgram(this.skyProgram);
		gl.uniform1i(this.milkyU.uMilky, 0);

		// Stars: a unit quad per instance.
		const { stars, count, count82, count86 } = buildStars(42000);
		this.count = count;
		this.count82 = count82;
		this.count86 = count86;
		this.starVao = gl.createVertexArray()!;
		gl.bindVertexArray(this.starVao);
		const corners = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, corners);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const instances = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instances);
		gl.bufferData(gl.ARRAY_BUFFER, stars, gl.STATIC_DRAW);
		const stride = FLOATS_PER_STAR * 4;
		for (const [loc, size, offset] of [
			[1, 3, 0],
			[2, 1, 3],
			[3, 3, 4],
			[4, 2, 7],
		]) {
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
			gl.vertexAttribDivisor(loc, 1);
		}
		gl.bindVertexArray(null);

		this.milky = this.generateMilkyWay();
	}

	private ensureDay() {
		if (this.dayReady) return;
		this.dayReady = true;
		const gl = this.gl;

		if (!this._weather) {
			this._weather = new CloudField();
			this._weather.reducedMotion = this.reducedMotion;
			// Nothing was on screen to ease from: the first day frame shows the weather as it is.
			this._weather.setWeather(this.pendingWeather, true);
		}

		this.dayProgram = compile(gl, FULLSCREEN_VS, DAY_SKY_FS);
		this.lutProgram = compile(gl, FULLSCREEN_VS, SKY_LUT_FS);
		this.dayU = locate(gl, this.dayProgram, DAY_UNIFORMS);
		this.lutU = locate(gl, this.lutProgram, LUT_UNIFORMS);
		gl.useProgram(this.dayProgram);
		gl.uniform1i(this.dayU.uLut, 0);
		gl.uniform1i(this.dayU.uNoise, 1);
		gl.uniform1f(this.dayU.uSunRadius, 0.0165);
		this.lut = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.lut);
		// Half-float where it can be rendered to: dim twilight light keeps its
		// hue instead of quantising into blotches; 8-bit (tonemapped) otherwise.
		this.lutFloat = !!gl.getExtension('EXT_color_buffer_float');
		if (this.lutFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SKY_LUT_W, SKY_LUT_H, 0, gl.RGBA, gl.HALF_FLOAT, null);
		else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SKY_LUT_W, SKY_LUT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		this.lutFramebuffer = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFramebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lut, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		// The cloud noise: mipmapped (and anisotropic where available), so the
		// sheet stays calm as it foreshortens toward the horizon.
		this.noise = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.noise);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._weather.texture);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
		if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
	}

	get weather(): CloudField {
		this.ensureDay();
		return this._weather!;
	}

	setReducedMotion(reduced: boolean) {
		this.reducedMotion = reduced;
		if (this._weather) this._weather.reducedMotion = reduced;
	}

	/** The live weather (null for a clear sky); `snap` skips the ease-in. */
	setWeather(weather: SkyWeather | null, snap: boolean) {
		this.pendingWeather = weather;
		this._weather?.setWeather(weather, snap);
	}

	/** Size the drawing buffer for day (≤ 1× CSS px) or night (full DPR); resizing clears it. */
	private fit(scale: number) {
		const w = Math.ceil(this.width * scale);
		const h = Math.ceil(this.height * scale);
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
	}

	/** Render the Milky Way's galactic-coordinate texture once, on the GPU. */
	private generateMilkyWay() {
		const gl = this.gl;
		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MILKY_WAY_W, MILKY_WAY_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		const program = compile(gl, FULLSCREEN_VS, MILKY_GEN_FS);
		gl.viewport(0, 0, MILKY_WAY_W, MILKY_WAY_H);
		gl.useProgram(program);
		gl.bindVertexArray(this.emptyVao);
		gl.disable(gl.BLEND);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteProgram(program);
		return texture;
	}

	/** Re-integrate the sky table when the Sun has moved more than ~0.1°. */
	private updateSkyTable(sunAlt: number) {
		if (Math.abs(sunAlt - this.lutSunAlt) < 0.002) return;
		this.lutSunAlt = sunAlt;
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFramebuffer);
		gl.viewport(0, 0, SKY_LUT_W, SKY_LUT_H);
		gl.disable(gl.BLEND);
		gl.useProgram(this.lutProgram);
		gl.bindVertexArray(this.emptyVao);
		gl.uniform1f(this.lutU.uSunAlt, sunAlt);
		gl.uniform1f(this.lutU.uFloat, this.lutFloat ? 1 : 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	/** The daytime sky: opaque, so it stands in for the page's light background. */
	renderDay(frame: GLDayFrame) {
		if (this.lost) return;
		this.ensureDay();
		const gl = this.gl;
		const [x, y, z] = frame.sun;
		const weather = this._weather!;
		weather.calm = frame.calm;
		weather.advance(frame.dt, frame.width, frame.height);
		this.sunlightIn -= frame.dt;
		if (this.sunlightIn <= 0 || frame.dt === 0) {
			this.sunlightIn = SUNLIGHT_EVERY;
			this.sunlight = weather.sunTransmittance(frame.sun);
		}
		this.updateSkyTable(Math.asin(Math.max(-1, Math.min(1, z))));
		this.fit(Math.min(this.dpr, DAY_MAX_DPR));
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.disable(gl.BLEND);
		gl.useProgram(this.dayProgram);
		gl.bindVertexArray(this.emptyVao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.lut);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.noise);
		const u = this.dayU;
		gl.uniform3fv(u.uR, frame.view.r);
		gl.uniform3fv(u.uU, frame.view.u);
		gl.uniform3fv(u.uF, frame.view.f);
		gl.uniform3f(u.uSun, x, y, z);
		gl.uniform2f(u.uViewport, frame.width, frame.height);
		gl.uniform1f(u.uDpr, this.canvas.width / Math.max(1, frame.width));
		gl.uniform1f(u.uK, frame.view.K);
		gl.uniform4fv(u.uCloud, weather.cloud);
		gl.uniform1f(u.uCumulus, weather.cumulusOpacity);
		gl.uniform2fv(u.uOff, weather.offsets());
		gl.uniform2fv(u.uCirrusDir, weather.cirrusDirection);
		gl.uniform3fv(u.uFall, weather.precipitation);
		gl.uniform1f(u.uSunT, this.sunlight);
		gl.uniform1f(u.uSlant, weather.slant(frame.view.r));
		// Wrapped so the streaks' positions keep float precision (a jump every ~17 minutes).
		gl.uniform1f(u.uTime, frame.time % 1000);
		gl.uniform3fv(u.uFlash, weather.flash);
		const moon = frame.moon;
		gl.uniform4f(u.uMoon, moon?.[0] ?? 0, moon?.[1] ?? 0, moon?.[2] ?? -1, moon ? 1 : 0);
		gl.uniform3f(u.uFlare, frame.flare.x, frame.flare.y, frame.flare.amount);
		gl.uniform1f(u.uCalm, frame.calm ? 1 : 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
		gl.activeTexture(gl.TEXTURE0);
	}

	get ok() {
		return !this.lost;
	}

	get starCount() {
		return this.count;
	}

	resize(width: number, height: number, dpr: number) {
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		this.fit(dpr);
	}

	clear() {
		if (this.lost) return;
		const gl = this.gl;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	render(frame: GLFrame) {
		if (this.lost) return;
		this.ensureNight();
		const gl = this.gl;
		const { view } = frame;
		this.fit(this.dpr);
		this.clear();

		// Equatorial → horizon (east, north, up) for the current sidereal time.
		const lst = lstHours(julian(skyNow()), this.lonDeg) * 15 * DEG;
		const lat = this.latDeg * DEG;
		const sl = Math.sin(lst);
		const cl = Math.cos(lst);
		const sp = Math.sin(lat);
		const cp = Math.cos(lat);
		const eqToHorizon: Mat3 = [
			[-sl, cl, 0],
			[-sp * cl, -sp * sl, cp],
			[cp * cl, cp * sl, sp],
		];
		const eqToView = mul([view.r, view.u, view.f], eqToHorizon);
		const viewToGal = mul(GALACTIC, transpose(eqToView));
		const upView = this.upViewBuf;
		upView[0] = view.r[2];
		upView[1] = view.u[2];
		upView[2] = view.f[2];
		const area = frame.width * frame.height;

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);

		// Milky Way.
		gl.useProgram(this.skyProgram);
		gl.bindVertexArray(this.emptyVao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.milky);
		const m = this.milkyU;
		gl.uniformMatrix3fv(m.uViewToGal, false, columnMajor(viewToGal, this.matBufA));
		gl.uniform3fv(m.uUpView, upView);
		gl.uniform2f(m.uViewport, frame.width, frame.height);
		gl.uniform1f(m.uDpr, this.dpr);
		gl.uniform1f(m.uK, view.K);
		// The Milky Way is the last thing to come out at dusk.
		const t = frame.twilight;
		gl.uniform1f(m.uIntensity, 0.32 * (t < 1 ? t * t * t : 1));
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		// Stars.
		gl.useProgram(this.starProgram);
		gl.bindVertexArray(this.starVao);
		const s = this.starU;
		gl.uniformMatrix3fv(s.uEqToView, false, columnMajor(eqToView, this.matBufB));
		gl.uniform3fv(s.uUpView, upView);
		gl.uniform2f(s.uViewport, frame.width, frame.height);
		gl.uniform1f(s.uK, view.K);
		gl.uniform1f(s.uTime, frame.time);
		gl.uniform3f(s.uLens, frame.lens.x, frame.lens.y, frame.lens.amount);
		gl.uniform1f(s.uWarp, frame.warp);
		// Smaller screens show fewer of the faintest stars; background stars are
		// sorted by magnitude so we only submit the visible prefix of instances.
		const limitMag = area >= 1.1e6 ? 9.1 : area >= 5e5 ? 8.6 : 8.2;
		const drawCount = area >= 1.1e6 ? this.count : area >= 5e5 ? this.count86 : this.count82;
		gl.uniform1f(s.uLimitMag, limitMag);
		gl.uniform1f(s.uTwilight, frame.twilight);
		gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawCount);
		gl.bindVertexArray(null);
		this.drawn = drawCount;
	}
}
