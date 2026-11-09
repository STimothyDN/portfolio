/**
 * Light, for shooting: exposure values, a Sunny 16 reading of the sky,
 * settings that fit the camera's dials, reciprocity for long exposures,
 * depth of field, and the sun's day. Pure arithmetic, shared by shooting
 * mode and the insight pages (the sun math is the observatory's own).
 */
import { sunAltitudeAt, sunDay } from '../../scripts/sky/astro';
import { shutterSeconds } from './almanac';
import { SHUTTERS } from './inventory';

/* ---------- exposure values ---------- */

/** The light a setting meters, as EV at ISO 100: log2(N²/t) − log2(ISO/100). */
export const ev100Of = (aperture: number, seconds: number, iso: number) =>
	Math.log2((aperture * aperture) / seconds) - Math.log2(iso / 100);

/** EV for this film speed from EV at ISO 100. */
export const evAtIso = (ev100: number, iso: number) => ev100 + Math.log2(iso / 100);

/** To the nearest third of a stop, as a light meter shows it ("12⅓"). */
export function formatEv(ev: number): string {
	if (ev < 0) return `−${formatEv(-ev)}`;
	const thirds = Math.round(ev * 3);
	const rest = thirds % 3;
	return `${Math.floor(thirds / 3)}${rest === 1 ? '⅓' : rest === 2 ? '⅔' : ''}`;
}

/* ---------- conditions (Sunny 16 and the night table) ---------- */

export type LightKey = 'snow' | 'sun' | 'hazy' | 'cloudy' | 'overcast' | 'shade' | 'neon' | 'streets' | 'indoors' | 'candle';

export interface LightCondition {
	key: LightKey;
	label: string;
	/** EV at ISO 100. */
	ev: number;
	/** The Sunny 16 way of saying it, where there is one. */
	rule?: string;
	night?: boolean;
}

/**
 * The classic table: f/16 at 1/ISO in bright sun, a stop wider for each step
 * down. Negative film forgives overexposure far more than under, so where
 * sources disagree these lean towards more light.
 */
export const CONDITIONS: LightCondition[] = [
	{ key: 'snow', label: 'Sun on snow or sand', ev: 16, rule: 'f/22' },
	{ key: 'sun', label: 'Bright sun', ev: 15, rule: 'f/16' },
	{ key: 'hazy', label: 'Hazy or soft shadows', ev: 14, rule: 'f/11' },
	{ key: 'cloudy', label: 'Overcast', ev: 13, rule: 'f/8' },
	{ key: 'overcast', label: 'Heavy overcast', ev: 12, rule: 'f/5.6' },
	{ key: 'shade', label: 'Open shade', ev: 11, rule: 'f/4' },
	{ key: 'neon', label: 'Neon and shop windows', ev: 9, night: true },
	{ key: 'streets', label: 'Lit streets', ev: 7, night: true },
	{ key: 'indoors', label: 'Indoors', ev: 6, night: true },
	{ key: 'candle', label: 'Candlelight', ev: 4, night: true },
];
export const conditionBy = (key: LightKey) => CONDITIONS.find((c) => c.key === key)!;

/** What the weather service reports, enough to guess the light. */
export interface SkyConditions {
	/** Total cloud cover, %. */
	cover: number;
	/** WMO weather code. */
	code: number;
}

export interface SkyReading {
	/** EV at ISO 100. */
	ev: number;
	/** The closest condition in the table (for the chips); none in twilight. */
	key: LightKey | null;
	label: string;
	/** Why: "Overcast · sun 12° up". */
	why: string;
	/** A second opinion when the sky can change under you. */
	caveat: string | null;
	daylight: boolean;
}

const FOG = new Set([45, 48]);
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const STORM = new Set([95, 96, 99]);

/** The daylight condition from cloud and weather, before the sun's height. */
function daylightBase(sky: SkyConditions | null): { ev: number; label: string; caveat: string | null } {
	if (!sky) return { ev: 15, label: 'Bright sun', caveat: 'No weather reading: pick the sky you see.' };
	if (STORM.has(sky.code)) return { ev: 10, label: 'Storm', caveat: null };
	if (RAIN.has(sky.code)) return { ev: 11, label: 'Rain', caveat: null };
	if (SNOW.has(sky.code)) return { ev: 12, label: 'Falling snow', caveat: null };
	if (FOG.has(sky.code)) return { ev: 12, label: 'Fog', caveat: null };
	if (sky.cover < 15) return { ev: 15, label: 'Clear sky', caveat: null };
	if (sky.cover < 45) return { ev: 15, label: 'Sun, some cloud', caveat: 'Two stops more if a cloud covers the sun.' };
	if (sky.cover < 80) return { ev: 14, label: 'Sun and cloud', caveat: 'A stop less in full sun, a stop more when it goes in.' };
	if (sky.cover < 95) return { ev: 13, label: 'Overcast', caveat: null };
	return { ev: 12, label: 'Heavy overcast', caveat: null };
}

/**
 * A reading of the light from the sun's height and the weather. Low sun
 * takes stops away (a golden-hour scene is about two stops darker than the
 * same one at noon); after sunset the sky dims towards night.
 */
export function readSky(sunAltitude: number, sky: SkyConditions | null): SkyReading {
	const alt = Math.round(sunAltitude);
	const sunWords = alt >= 0 ? `sun ${alt}° up` : `sun ${-alt}° down`;
	if (sunAltitude < -6) {
		return { ev: 7, key: 'streets', label: 'Night', why: `${sunWords}: meter the lights, not the sky`, caveat: null, daylight: false };
	}
	const base = daylightBase(sky);
	if (sunAltitude < -0.8) {
		// Civil twilight: about EV 10 just after sunset to EV 6 by its end.
		const t = (sunAltitude + 0.8) / -5.2;
		const ev = 10 - 4 * t - (sky && sky.cover >= 80 ? 1 : 0);
		return { ev, key: null, label: sunAltitude < -4 ? 'Blue hour' : 'Twilight', why: `${base.label} · ${sunWords}`, caveat: 'The sky dims fast now: open up a stop every few minutes.', daylight: false };
	}
	const lowSun = sunAltitude >= 20 ? 0 : sunAltitude >= 10 ? 1 : sunAltitude >= 3 ? 2 : 3;
	const ev = Math.max(8, Math.min(16, base.ev - lowSun));
	const label = lowSun >= 2 && base.ev >= 14 ? 'Golden hour' : base.label;
	return { ev, key: nearestKey(ev), label, why: `${base.label} · ${sunWords}`, caveat: base.caveat, daylight: true };
}

function nearestKey(ev: number): LightKey {
	return CONDITIONS.reduce((best, c) => (Math.abs(c.ev - ev) < Math.abs(best.ev - ev) ? c : best), CONDITIONS[0]).key;
}

/* ---------- settings that fit the camera ---------- */

export interface Setting {
	aperture: number;
	shutter: string;
	seconds: number;
	/** Stops more exposure than the reading asks for (−0.5 to 0.5 on the dials). */
	off: number;
}

export interface Picks {
	/** Up to three ways to take it, each for a different reason. */
	picks: { label: string; setting: Setting }[];
	/** The light needs more than a hand-held 1/30 at the widest aperture. */
	slow: { aperture: number; seconds: number } | null;
	/** Stops over at the smallest aperture and fastest speed. */
	over: number;
}

const DIAL = SHUTTERS.filter((s) => s !== 'B').map((s) => ({ s, t: shutterSeconds(s)! }));

/** The dial speed nearest an ideal time, and how far off it is. */
function nearestShutter(ideal: number): { s: string; t: number; off: number } {
	let best = DIAL[0];
	for (const d of DIAL) if (Math.abs(Math.log2(d.t / ideal)) < Math.abs(Math.log2(best.t / ideal))) best = d;
	return { ...best, off: Math.log2(best.t / ideal) };
}

/**
 * Settings for EV `ev` (at the film's speed) on these apertures: one for
 * everyday (around f/8, fast enough to hand-hold), one to freeze motion,
 * one for shallow focus.
 */
export function pickSettings(ev: number, apertures: number[]): Picks {
	const all: Setting[] = apertures.map((aperture) => {
		const ideal = (aperture * aperture) / 2 ** ev;
		const n = nearestShutter(ideal);
		return { aperture, shutter: n.s, seconds: n.t, off: Math.round(n.off * 100) / 100 };
	});
	const fits = all.filter((s) => Math.abs(s.off) <= 0.55);
	const handheld = fits.filter((s) => s.seconds <= 1 / 30 + 1e-9);
	const picks: Picks['picks'] = [];
	const add = (label: string, s: Setting | undefined) => {
		if (s && !picks.some((p) => p.setting.aperture === s.aperture)) picks.push({ label, setting: s });
	};
	const near8 = (list: Setting[]) => [...list].sort((a, b) => Math.abs(Math.log2(a.aperture / 8)) - Math.abs(Math.log2(b.aperture / 8)))[0];
	const everyday = near8(handheld.filter((s) => s.seconds <= 1 / 125 + 1e-9));
	if (everyday) add('Everyday', everyday);
	else add('Hand-held', near8(handheld));
	add('Freeze motion', [...handheld].filter((s) => s.seconds <= 1 / 500 + 1e-9).sort((a, b) => a.seconds - b.seconds)[0]);
	add('Shallow focus', [...handheld].sort((a, b) => a.aperture - b.aperture)[0]);
	add('Deep focus', [...handheld].filter((s) => s.aperture >= 11).sort((a, b) => Math.abs(a.aperture - 16) - Math.abs(b.aperture - 16))[0]);
	picks.splice(3);

	const widest = Math.min(...apertures);
	const slowest = (widest * widest) / 2 ** ev;
	const smallest = Math.max(...apertures);
	const fastest = DIAL.at(-1)!.t;
	return {
		picks,
		slow: handheld.length ? null : { aperture: widest, seconds: slowest },
		over: Math.max(0, Math.log2(fastest / ((smallest * smallest) / 2 ** ev))),
	};
}

/** "", "+½", "−⅓": how far a setting is from the reading, when it's worth saying. */
export function formatOff(off: number): string {
	if (Math.abs(off) < 0.25) return '';
	const third = Math.abs(off) < 0.42 ? '⅓' : '½';
	return `${off > 0 ? '+' : '−'}${third}`;
}

/** For cameras that set exposure themselves: is there enough light? */
export function autoExposureNote(ev: number, iso: number, widest = 2.8): { tone: 'ok' | 'warn' | 'bad'; text: string } {
	// Most point-and-shoots fire the flash or slow down past ~1/30 wide open.
	const needs = Math.log2(widest * widest * 30);
	if (ev >= needs + 1.5) return { tone: 'ok', text: `Plenty of light for ISO ${iso}.` };
	if (ev >= needs - 0.5) return { tone: 'warn', text: `Getting dim for ISO ${iso}: hold steady, the flash may fire.` };
	return { tone: 'bad', text: `Too dim for ISO ${iso} without flash: turn it on, or brace the camera.` };
}

/* ---------- long exposures ---------- */

export interface Reciprocity {
	/** Schwarzschild exponent: corrected = metered ^ p (past `from`). */
	p: number;
	/** Seconds up to which no correction is needed. */
	from: number;
	/** Where the number comes from. */
	source: string;
}

const ILFORD = "Ilford's published formula";
const ESTIMATE = 'a common estimate';
const RECIPROCITY: [RegExp, Reciprocity][] = [
	[/hp5/i, { p: 1.31, from: 1, source: ILFORD }],
	[/fp4/i, { p: 1.26, from: 1, source: ILFORD }],
	[/delta\s*100/i, { p: 1.26, from: 1, source: ILFORD }],
	[/delta\s*400/i, { p: 1.41, from: 1, source: ILFORD }],
	[/delta\s*3200/i, { p: 1.33, from: 1, source: ILFORD }],
	[/pan\s*f/i, { p: 1.33, from: 1, source: ILFORD }],
	[/xp2/i, { p: 1.31, from: 1, source: ILFORD }],
	[/sfx/i, { p: 1.43, from: 1, source: ILFORD }],
	[/cinestill/i, { p: 1.27, from: 2, source: ESTIMATE }],
	[/candido|vision\s*3|5219|5207|5203/i, { p: 1.25, from: 2, source: ESTIMATE }],
	[/portra/i, { p: 1.33, from: 1, source: ESTIMATE }],
	[/ektar/i, { p: 1.3, from: 1, source: ESTIMATE }],
	[/tri-?x/i, { p: 1.54, from: 1, source: ESTIMATE }],
];
const BY_PROCESS: Record<string, number> = { 'B&W': 1.4, 'ECN-2': 1.25, 'E-6': 1.3, 'C-41': 1.35 };

/** How a stock loses speed in long exposures. */
export function reciprocityFor(stock: { name: string; brand?: string | null; token?: string | null; process: string }): Reciprocity {
	const text = `${stock.brand ?? ''} ${stock.name} ${stock.token ?? ''}`;
	for (const [re, r] of RECIPROCITY) if (re.test(text)) return r;
	return { p: BY_PROCESS[stock.process] ?? 1.35, from: stock.process === 'ECN-2' ? 2 : 1, source: ESTIMATE };
}

/** The time to actually expose for a metered time. */
export const correctedSeconds = (metered: number, r: Reciprocity) =>
	metered <= r.from ? metered : r.from * (metered / r.from) ** r.p;

/** "1/60", "0.8 s", "14 s", "2 min 5 s", "1 h 3 min". */
export function formatSeconds(s: number): string {
	if (s < 0.4) return `1/${Math.round(1 / s)}`;
	if (s < 10) return `${Math.round(s * 10) / 10} s`;
	if (s < 60) return `${Math.round(s)} s`;
	if (s < 3600) {
		const m = Math.floor(s / 60);
		const r = Math.round(s - m * 60);
		return r ? `${m} min ${r} s` : `${m} min`;
	}
	const h = Math.floor(s / 3600);
	const m = Math.round((s - h * 3600) / 60);
	return m ? `${h} h ${m} min` : `${h} h`;
}

/* ---------- depth of field ---------- */

/** Circle of confusion by format, mm. */
export const circleOfConfusion = (format: string | null | undefined) =>
	format === '120' ? 0.05 : format === '110' ? 0.015 : 0.03;

/** Hyperfocal distance, metres. */
export const hyperfocal = (focal: number, aperture: number, coc: number) => ((focal * focal) / (aperture * coc) + focal) / 1000;

/** What's sharp when focused at `distance` metres: near and far limits (far may be Infinity). */
export function depthOfField(focal: number, aperture: number, coc: number, distance: number): { near: number; far: number } {
	const H = hyperfocal(focal, aperture, coc) * 1000;
	const s = distance * 1000;
	const f = focal;
	const near = (s * (H - f)) / (H + s - 2 * f);
	const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
	return { near: near / 1000, far: far / 1000 };
}

/** "3 m · 10 ft", "∞". */
export function formatDistance(m: number): string {
	if (!Number.isFinite(m)) return '∞';
	const ft = m * 3.28084;
	const metres = m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
	const feet = ft < 10 ? Math.round(ft * 10) / 10 : Math.round(ft);
	return `${metres} m · ${feet} ft`;
}

/* ---------- the sun's day ---------- */

export interface SunMoment {
	label: string;
	at: number;
}

export interface SunReport {
	altitude: number;
	/** "Golden hour in 1 h 12 min", "Blue hour now, until 5:46 pm". */
	line: string;
	/** Today's light, in order. */
	moments: SunMoment[];
}

const HOUR = 3_600_000;

/** When the sun crosses `deg` between a and b (altitude monotonic there), or null. */
function crossing(a: number, b: number, deg: number, lat: number, lon: number): number | null {
	let fa = sunAltitudeAt(a, lat, lon) - deg;
	if (Math.sign(fa) === Math.sign(sunAltitudeAt(b, lat, lon) - deg)) return null;
	for (let i = 0; i < 24; i++) {
		const m = (a + b) / 2;
		const fm = sunAltitudeAt(m, lat, lon) - deg;
		if (Math.sign(fm) === Math.sign(fa)) {
			a = m;
			fa = fm;
		} else b = m;
	}
	return (a + b) / 2;
}

/** "4:41 pm" in the phone's own time zone. */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** "2 h 5 min", "25 min". */
export function formatWait(ms: number): string {
	const min = Math.max(1, Math.round(ms / 60_000));
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m ? `${h} h ${m} min` : `${h} h`;
}

function dayMoments(ms: number, lat: number, lon: number): SunMoment[] {
	const d = sunDay(ms, lat, lon);
	const out: SunMoment[] = [];
	const push = (label: string, at: number | null | undefined) => {
		if (at != null) out.push({ label, at });
	};
	// Blue hour: the sun between −4° and −6°, either side of the golden hours.
	const dawn = d.goldenMorning ? crossing(d.goldenMorning[0] - HOUR, d.goldenMorning[0], -6, lat, lon) : null;
	const dusk = d.goldenEvening ? crossing(d.goldenEvening[1], d.goldenEvening[1] + HOUR, -6, lat, lon) : null;
	push('Blue hour', dawn);
	push('Golden hour', d.goldenMorning?.[0]);
	push('Sunrise', d.sunrise);
	push('Golden hour ends', d.goldenMorning?.[1]);
	push('Golden hour', d.goldenEvening?.[0]);
	push('Sunset', d.sunset);
	push('Blue hour', d.goldenEvening?.[1]);
	push('Dark', dusk);
	return out;
}

/** Where the light is now and what comes next. */
export function sunReport(now: number, lat: number, lon: number): SunReport {
	const altitude = sunAltitudeAt(now, lat, lon);
	const today = dayMoments(now, lat, lon);
	const d = sunDay(now, lat, lon);
	const within = (span: [number, number] | null | undefined) => !!span && now >= span[0] && now <= span[1];
	const blueEvening: [number, number] | null = d.goldenEvening && today.at(-1) ? [d.goldenEvening[1], today.at(-1)!.at] : null;
	const blueMorning: [number, number] | null = d.goldenMorning && today[0]?.label === 'Blue hour' ? [today[0].at, d.goldenMorning[0]] : null;

	let line: string;
	if (within(d.goldenMorning)) line = `Golden hour now, until ${clock(d.goldenMorning![1])}`;
	else if (within(d.goldenEvening)) line = `Golden hour now, until ${clock(d.goldenEvening![1])}`;
	else if (within(blueEvening)) line = `Blue hour now, until ${clock(blueEvening![1])}`;
	else if (within(blueMorning)) line = `Blue hour now, golden hour at ${clock(blueMorning![1])}`;
	else {
		const nextMoment = today.find((m) => m.at > now && (m.label === 'Golden hour' || m.label === 'Blue hour'));
		if (nextMoment) line = `${nextMoment.label} in ${formatWait(nextMoment.at - now)} (${clock(nextMoment.at)})`;
		else {
			const tomorrow = dayMoments(now + 24 * HOUR, lat, lon);
			const first = tomorrow.find((m) => m.label === 'Blue hour' || m.label === 'Golden hour');
			line = first ? `${first.label} tomorrow at ${clock(first.at)}` : 'The sun stays down';
		}
	}
	return { altitude, line, moments: today };
}
