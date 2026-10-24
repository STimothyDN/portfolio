/**
 * Fig. 1 by day (daylight pages in light mode; Constellation.astro): today's
 * path of the Sun over RTP, drawn into the chart's [data-sun-path] group.
 *
 * Same projection as the chart: zenith at the centre, the horizon on the
 * ring, altitude falling off evenly toward it, north up and east left — a
 * sky chart held overhead. Drawn: today's path from sunrise to sunset with a
 * mark at each whole hour, its golden hours in peach, the June and December
 * solstices' paths for scale, sunrise and sunset times where the path meets
 * the horizon, and the Sun where it is now (each minute). Follows the sky
 * clock, so ?at= previews any day and hour.
 */
import { DEG, julian, lstHours, sun, sunDay, toHorizon } from './sky/astro';
import { skyNow, syncClockFromUrl } from './sky/clock';

const SITE = { lat: 35.9, lon: -78.86 };
const SVG_NS = 'http://www.w3.org/2000/svg';
const HOUR = 3600000;
/** Path resolution, ms. */
const STEP = 4 * 60000;

const hm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

type Ring = { cx: number; cy: number; r: number };

/** The Sun's altitude and azimuth (degrees) at a moment. */
function position(ms: number) {
	const jd = julian(ms);
	const s = sun(jd);
	const v = toHorizon(s.ra, s.dec, lstHours(jd, SITE.lon) * 15 * DEG, SITE.lat * DEG);
	return { alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG, az: Math.atan2(v[0], v[1]) / DEG };
}

/** Chart coordinates for an altitude/azimuth (degrees). */
function project(ring: Ring, alt: number, az: number): [number, number] {
	const r = (ring.r * (90 - alt)) / 90;
	return [ring.cx - r * Math.sin(az * DEG), ring.cy - r * Math.cos(az * DEG)];
}

/** A point just outside the ring, `gap` beyond the horizon at an azimuth. */
function outside(ring: Ring, az: number, gap: number): [number, number] {
	const r = ring.r + gap;
	return [ring.cx - r * Math.sin(az * DEG), ring.cy - r * Math.cos(az * DEG)];
}

/** The path the Sun traces between two moments, above the horizon only. */
function arc(ring: Ring, from: number, to: number) {
	const steps = Math.max(1, Math.ceil((to - from) / STEP));
	let d = '';
	let pen = false;
	for (let i = 0; i <= steps; i++) {
		const { alt, az } = position(from + ((to - from) * i) / steps);
		if (alt < 0) {
			pen = false;
			continue;
		}
		const [x, y] = project(ring, alt, az);
		d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
		pen = true;
	}
	return d;
}

/** A whole day's path: midnight-to-midnight around `noon`. */
const dayArc = (ring: Ring, noon: number) => arc(ring, noon - 12 * HOUR, noon + 12 * HOUR);

/** Local solar noon on the given month's 21st this year (the solstices). */
function solsticeNoon(ms: number, month: number) {
	const year = new Date(ms).getUTCFullYear();
	return sunDay(Date.UTC(year, month - 1, 21, 17), SITE.lat, SITE.lon).noon;
}

function draw(group: SVGGElement, ring: Ring, now: number) {
	const today = sunDay(now, SITE.lat, SITE.lon);
	const q = <T extends Element>(sel: string) => group.querySelector<T>(sel)!;
	group.querySelectorAll<SVGPathElement>('[data-solstice]').forEach((path) => {
		path.setAttribute('d', dayArc(ring, solsticeNoon(now, Number(path.dataset.solstice))));
	});
	q<SVGPathElement>('[data-today]').setAttribute('d', dayArc(ring, today.noon));
	for (const [key, span] of [
		['am', today.goldenMorning],
		['pm', today.goldenEvening],
	] as const) {
		q<SVGPathElement>(`[data-golden="${key}"]`).setAttribute('d', span ? arc(ring, span[0], span[1]) : '');
	}

	// Whole hours while the Sun is up; every third one labelled, toward the zenith.
	const hours = q<SVGGElement>('[data-hours]');
	hours.replaceChildren();
	if (today.sunrise !== null && today.sunset !== null) {
		for (let t = Math.ceil(today.sunrise / HOUR) * HOUR; t < today.sunset; t += HOUR) {
			const { alt, az } = position(t);
			const [x, y] = project(ring, alt, az);
			const dot = document.createElementNS(SVG_NS, 'circle');
			dot.setAttribute('cx', x.toFixed(1));
			dot.setAttribute('cy', y.toFixed(1));
			dot.setAttribute('r', '2.25');
			hours.append(dot);
			const h = Number(hour.format(t));
			if (h % 3 === 0) {
				const toCentre = Math.hypot(ring.cx - x, ring.cy - y) || 1;
				const label = document.createElementNS(SVG_NS, 'text');
				label.setAttribute('x', (x + ((ring.cx - x) / toCentre) * 13).toFixed(1));
				label.setAttribute('y', (y + ((ring.cy - y) / toCentre) * 13 + 3).toFixed(1));
				label.setAttribute('text-anchor', 'middle');
				label.textContent = String(h).padStart(2, '0');
				hours.append(label);
			}
		}
	}

	// Sunrise and sunset, just outside the ring where the path meets it.
	for (const [sel, time] of [
		['[data-rise]', today.sunrise],
		['[data-set]', today.sunset],
	] as const) {
		const text = q<SVGTextElement>(sel);
		if (time === null) {
			text.textContent = '';
			continue;
		}
		const [x, y] = outside(ring, position(time).az, 14);
		text.setAttribute('x', x.toFixed(1));
		text.setAttribute('y', (y + 3.5).toFixed(1));
		text.textContent = sel === '[data-rise]' ? `↑${hm.format(time)}` : `${hm.format(time)}↓`;
	}

	const date = document.querySelector<HTMLElement>('[data-sun-path-date]');
	if (date) date.textContent = day.format(now);
}

/** The Sun now (hidden below the horizon). */
function place(group: SVGGElement, ring: Ring, now: number) {
	const marker = group.querySelector<SVGGElement>('[data-sun-now]')!;
	const { alt, az } = position(now);
	marker.style.display = alt < 0 ? 'none' : '';
	const [x, y] = project(ring, Math.max(alt, 0), az);
	marker.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
}

let timer = 0;
let initializedForSwap = false;

function init() {
	initializedForSwap = true;
	clearInterval(timer);
	const group = document.querySelector<SVGGElement>('[data-sun-path]');
	if (!group || !('daylight' in document.body.dataset)) return;
	const ring = { cx: Number(group.dataset.cx), cy: Number(group.dataset.cy), r: Number(group.dataset.r) };
	syncClockFromUrl();
	let drawnFor = '';
	const tick = () => {
		const now = skyNow();
		// The paths change with the date; the Sun every minute.
		const date = day.format(now);
		if (date !== drawnFor) {
			drawnFor = date;
			draw(group, ring, now);
		}
		place(group, ring, now);
	};
	tick();
	timer = window.setInterval(tick, 60000);
}

// Loaded on demand (BaseLayout): starts at once, then follows the swaps.
init();
document.addEventListener('astro:after-swap', init);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) init();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	clearInterval(timer);
});
