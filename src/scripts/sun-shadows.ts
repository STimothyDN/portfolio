/**
 * Sun-cast shadows (Daylight observatory; pages with body[data-daylight]).
 * Every minute, from the real Sun over RTP: shadows fall away from it —
 * the view faces south, so a morning Sun in the east throws them right, an
 * evening Sun left — long and soft when it's low, short and crisp at noon,
 * cooler blue at golden hour. Below the horizon they fade to a soft ambient,
 * and so they do whenever a cloud covers the Sun: the sky worker reports the
 * sunlight getting through (`sky:sunlight`, 0–1) as the live clouds drift.
 *
 * Writes --sun-shadow-sm/md/lg and --sun-text-shadow on <body>;
 * styles/daylight.css points the site's shadow tokens at them in light mode,
 * so every component that already uses --shadow-* follows the Sun.
 *
 * Also --sky-haze: about the colour the sky grades to at the horizon at this
 * hour (the home page's tree line recedes into it) — lavender by day, peach
 * through golden hour, rose at dusk, periwinkle at night; greyer under cloud.
 */
import { DEG, altitudeDeg, julian, lstHours, sun, toHorizon } from './sky/astro';
import { skyNow, syncClockFromUrl } from './sky/clock';

const SITE = { lat: 35.9, lon: -78.86 };
/** How high each tier "floats" above the page, px. */
const ELEVATION = { sm: 3, md: 9, lg: 16, text: 10 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (a: number, b: number, x: number) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function sunPosition(ms: number) {
	const jd = julian(ms);
	const s = sun(jd);
	const v = toHorizon(s.ra, s.dec, lstHours(jd, SITE.lon) * 15 * DEG, SITE.lat * DEG);
	return { alt: altitudeDeg(v), az: ((Math.atan2(v[0], v[1]) / DEG) + 360) % 360 };
}

type Shadow = { x: number; y: number; blur: number; rgb: number[]; alpha: number };

/** No direct sun: soft skylight straight down. */
const ambient = (e: number): Shadow => ({ x: 0, y: e * 0.35, blur: e * 1.6, rgb: [70, 64, 110], alpha: 0.08 });

/** Direct sunlight getting through the clouds (0–1). */
let sunlight = 1;

/** One shadow for something `e` px above the page, as box-shadow/text-shadow parts. */
function cast(e: number, alt: number, az: number): Shadow {
	const sky = ambient(e);
	if (alt <= 0) return sky;
	const direct = sunShadow(e, alt, az);
	// Under cloud, the Sun's shadow gives way to the skylight's.
	const t = sunlight;
	return {
		x: mix(sky.x, direct.x, t),
		y: mix(sky.y, direct.y, t),
		blur: mix(sky.blur, direct.blur, t),
		rgb: direct.rgb.map((v, i) => mix(sky.rgb[i], v, t)),
		alpha: mix(sky.alpha, direct.alpha, t),
	};
}

function sunShadow(e: number, alt: number, az: number): Shadow {
	const relAz = (az - 180) * DEG; // + = west of south
	const len = clamp(1 / Math.tan(Math.max(alt, 3) * DEG), 0.35, 5);
	let x = -Math.sin(relAz) * len * e;
	let y = len * e * 0.45;
	// Keep even sunset shadows within reason.
	const reach = Math.hypot(x, y);
	const cap = 3.2 * e;
	if (reach > cap) {
		x *= cap / reach;
		y *= cap / reach;
	}
	const low = smoothstep(25, 3, alt);
	return { x, y, blur: e * (0.8 + len * 0.35), rgb: [mix(60, 70, low), mix(52, 82, low), mix(96, 150, low)], alpha: mix(0.15, 0.12, low) };
}

/** Horizon haze by Sun altitude: [alt°, OKLCH L, C, hue] — hue unwrapped so it travels the brand axis (lavender ↔ rose ↔ peach). */
const HAZE: [number, number, number, number][] = [
	[-12, 0.9, 0.03, -78],
	[-4, 0.9, 0.045, 8],
	[3, 0.93, 0.05, 52],
	[12, 0.945, 0.035, 12],
	[30, 0.955, 0.025, -72],
];

function haze(alt: number) {
	let i = 0;
	while (i < HAZE.length - 2 && alt > HAZE[i + 1][0]) i++;
	const [a0, l0, c0, h0] = HAZE[i];
	const [a1, l1, c1, h1] = HAZE[i + 1];
	const t = clamp((alt - a0) / (a1 - a0), 0, 1);
	// Under cloud the haze greys (only by day: night is already muted).
	const cloud = alt > 0 ? 0.5 + 0.5 * sunlight : 1;
	return `oklch(${(mix(l0, l1, t) * 100).toFixed(1)}% ${(mix(c0, c1, t) * cloud).toFixed(3)} ${((mix(h0, h1, t) + 360) % 360).toFixed(0)})`;
}

const css = (s: Shadow) =>
	`${s.x.toFixed(1)}px ${s.y.toFixed(1)}px ${s.blur.toFixed(1)}px rgba(${s.rgb.map(Math.round).join(', ')}, ${s.alpha.toFixed(3)})`;

/** Set a custom property only when it changes: each write restyles the whole page. */
function put(body: HTMLElement, name: string, value: string) {
	if (body.style.getPropertyValue(name) !== value) body.style.setProperty(name, value);
}

function update(body: HTMLElement) {
	const { alt, az } = sunPosition(skyNow());
	// The cast shadow plus a tight contact shadow that grounds the element.
	const box = (e: number) => `${css(cast(e, alt, az))}, 0 1px 2px rgba(40, 36, 70, 0.06)`;
	put(body, '--sun-shadow-sm', box(ELEVATION.sm));
	put(body, '--sun-shadow-md', box(ELEVATION.md));
	put(body, '--sun-shadow-lg', box(ELEVATION.lg));
	put(body, '--sun-text-shadow', css(cast(ELEVATION.text, alt, az)));
	put(body, '--sky-haze', haze(alt));
	const sunAlt = alt.toFixed(1);
	if (body.dataset.sunAlt !== sunAlt) body.dataset.sunAlt = sunAlt;
}

let timer = 0;
let initializedForSwap = false;

function init() {
	initializedForSwap = true;
	clearInterval(timer);
	const body = document.body;
	if (!('daylight' in body.dataset)) return;
	syncClockFromUrl();
	update(body);
	timer = window.setInterval(() => update(body), 60000);
}

document.addEventListener('astro:after-swap', init);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) init();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	clearInterval(timer);
});
window.addEventListener('sky:sunlight', (event) => {
	sunlight = (event as CustomEvent<number>).detail;
	if ('daylight' in document.body.dataset) update(document.body);
});
init();
