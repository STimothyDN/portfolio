/**
 * Live weather over the observatory (Research Triangle Park, NC) from
 * Open-Meteo: free, keyless, CORS-open. Only the site's fixed coordinates
 * are ever sent — never the visitor's location.
 *
 * At most one request every 15 minutes, cached in localStorage so reloads,
 * navigations and other tabs reuse it; any failure falls back quietly to the
 * last good reading, or to a clear sky. `?weather=<preset>` (clear, fair,
 * cloudy, overcast, cirrus, fog, drizzle, rain, storm, snow) previews a
 * condition without fetching.
 *
 * Shared three ways: straight to the sky renderer (as `skyWeather()` turns
 * it into cloud layers, wind aloft, rain, snow and fog), `weatherNow()` for
 * whoever asks, and a `sky:weather` window event whenever it changes.
 * Daylight pages only (body[data-daylight]); BaseLayout loads this module
 * only there.
 */
import { setSkyWeather } from './index';

const SITE = { lat: 35.9, lon: -78.86 };
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const FIELDS = [
	'temperature_2m',
	'apparent_temperature',
	'relative_humidity_2m',
	'precipitation',
	'weather_code',
	'cloud_cover',
	'cloud_cover_low',
	'cloud_cover_mid',
	'cloud_cover_high',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m',
	'visibility',
] as const;
const CACHE_KEY = 'sky-weather-v1';
const FRESH_MS = 15 * 60 * 1000;
/** A failed refresh keeps showing a reading up to this old. */
const STALE_MS = 3 * 60 * 60 * 1000;
const TIMEOUT_MS = 6000;

/** One observation, in the units asked for (°F, mph, mm, m). */
export type Conditions = {
	/** Observation time, site-local ISO (Open-Meteo updates every 15 minutes). */
	time: string;
	temperature: number;
	apparent: number;
	humidity: number;
	/** mm over the preceding 15 minutes. */
	precipitation: number;
	/** WMO weather code. */
	code: number;
	/** Cloud cover, % — total and by layer. */
	cover: number;
	low: number;
	mid: number;
	high: number;
	windSpeed: number;
	/** Where the wind blows from, degrees (meteorological). */
	windFrom: number;
	gusts: number;
	visibility: number;
};

export type Weather = Conditions & {
	source: 'live' | 'cached' | 'preview' | 'fallback';
	/** When it was fetched (ms), or 0 for previews and the fallback. */
	fetchedAt: number;
	preset?: string;
};

/** What the sky draws: 0–1 unless noted. */
export type SkyWeather = {
	/** Coverage of the puffy low/mid layer. */
	cover: number;
	/** Its base, m. */
	altitude: number;
	/** The high, wispy layer. */
	cirrus: number;
	/** How far the low layer has closed into a flat grey deck. */
	overcast: number;
	/** Drift aloft toward [east, north], m/s. */
	wind: [number, number];
	rain: number;
	snow: number;
	storm: boolean;
	fog: number;
};

const CLEAR: Conditions = {
	time: '',
	temperature: 65,
	apparent: 65,
	humidity: 50,
	precipitation: 0,
	code: 0,
	cover: 0,
	low: 0,
	mid: 0,
	high: 0,
	windSpeed: 5,
	windFrom: 250,
	gusts: 8,
	visibility: 24000,
};

/** Previews: plausible RTP readings for each kind of sky. */
const PRESETS: Record<string, Partial<Conditions>> = {
	clear: {},
	fair: { code: 1, cover: 30, low: 28, high: 15, windSpeed: 7 },
	cloudy: { code: 2, cover: 65, low: 55, mid: 30, high: 30, windSpeed: 9 },
	overcast: { code: 3, cover: 100, low: 96, mid: 80, high: 40, windSpeed: 8, humidity: 80 },
	cirrus: { code: 1, cover: 45, high: 75, windSpeed: 11 },
	fog: { code: 45, cover: 100, low: 100, visibility: 300, humidity: 99, windSpeed: 2, temperature: 52 },
	drizzle: { code: 53, cover: 100, low: 100, mid: 60, precipitation: 0.1, humidity: 94, windSpeed: 6, temperature: 57 },
	rain: { code: 63, cover: 100, low: 100, mid: 90, precipitation: 0.9, humidity: 96, windSpeed: 12, gusts: 22, visibility: 6000, temperature: 56 },
	storm: { code: 95, cover: 100, low: 100, mid: 100, high: 80, precipitation: 3, humidity: 98, windSpeed: 18, gusts: 38, visibility: 3000, temperature: 71 },
	snow: { code: 73, cover: 100, low: 100, mid: 70, precipitation: 0.6, humidity: 90, windSpeed: 6, visibility: 2500, temperature: 30 },
};

const LABELS: Record<number, string> = {
	0: 'Clear',
	1: 'Mostly clear',
	2: 'Partly cloudy',
	3: 'Overcast',
	45: 'Fog',
	48: 'Freezing fog',
	51: 'Light drizzle',
	53: 'Drizzle',
	55: 'Heavy drizzle',
	56: 'Freezing drizzle',
	57: 'Freezing drizzle',
	61: 'Light rain',
	63: 'Rain',
	65: 'Heavy rain',
	66: 'Freezing rain',
	67: 'Freezing rain',
	71: 'Light snow',
	73: 'Snow',
	75: 'Heavy snow',
	77: 'Snow grains',
	80: 'Showers',
	81: 'Showers',
	82: 'Downpour',
	85: 'Snow showers',
	86: 'Snow showers',
	95: 'Thunderstorm',
	96: 'Thunderstorm, hail',
	99: 'Thunderstorm, hail',
};

/** Rain (or snow) intensity, 0–1, by WMO code. */
const RAIN: Record<number, number> = { 51: 0.15, 53: 0.25, 55: 0.35, 56: 0.2, 57: 0.35, 61: 0.35, 63: 0.6, 65: 0.9, 66: 0.4, 67: 0.8, 80: 0.4, 81: 0.65, 82: 1, 95: 0.85, 96: 1, 99: 1 };
const SNOW: Record<number, number> = { 71: 0.3, 73: 0.6, 75: 0.9, 77: 0.3, 85: 0.5, 86: 0.9 };
const FOG: Record<number, number> = { 45: 0.75, 48: 0.85 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};

export const weatherLabel = (code: number) => LABELS[code] ?? 'Clear';

/** The sky a reading implies. */
export function skyWeather(w: Conditions): SkyWeather {
	const low = w.low / 100;
	const mid = w.mid / 100;
	// Layers can be missing from the model; the total stands in for them.
	const layered = Math.max(low, mid * 0.9);
	let cover = clamp01(layered > 0 || w.high > 0 ? layered : w.cover / 100);
	const rain = clamp01(RAIN[w.code] ?? (w.precipitation > 0.05 && !SNOW[w.code] ? 0.2 + w.precipitation * 0.2 : 0));
	const snow = clamp01(SNOW[w.code] ?? 0);
	// Anything falling comes from a closed deck.
	if (rain || snow) cover = Math.max(cover, 0.92);
	// Poor visibility is fog — unless it's the rain or snow itself, which is drawn as such.
	const murk = 0.85 * smoothstep(6000, 400, w.visibility) * (rain || snow ? 0.4 : 1);
	const fog = Math.max(FOG[w.code] ?? 0, murk);
	// Wind aloft runs faster than at 10 m; the clouds drift where it blows to.
	const speed = Math.max(2, w.windSpeed * 0.44704 * 1.8);
	const to = ((w.windFrom + 180) % 360) * (Math.PI / 180);
	return {
		cover,
		altitude: mid > low ? 3600 : 1500,
		cirrus: clamp01(w.high / 100),
		overcast: smoothstep(0.82, 1, cover),
		wind: [Math.sin(to) * speed, Math.cos(to) * speed],
		rain,
		snow,
		storm: w.code >= 95,
		fog,
	};
}

let current: Weather | null = null;

/** The latest reading (null until the first one on a daylight page). */
export const weatherNow = () => current;

function publish(next: Weather) {
	if (JSON.stringify(next) === JSON.stringify(current)) return;
	current = next;
	setSkyWeather(skyWeather(next));
	window.dispatchEvent(new CustomEvent<Weather>('sky:weather', { detail: next }));
}

type Cached = { fetchedAt: number; conditions: Conditions };

function readCache(): Cached | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		const cached = raw ? (JSON.parse(raw) as Cached) : null;
		return cached && typeof cached.fetchedAt === 'number' && cached.conditions ? cached : null;
	} catch {
		return null;
	}
}

function writeCache(cached: Cached) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
	} catch {
		/* storage full or blocked: fetch again next time */
	}
}

async function fetchConditions(): Promise<Conditions> {
	const params = new URLSearchParams({
		latitude: String(SITE.lat),
		longitude: String(SITE.lon),
		current: FIELDS.join(','),
		temperature_unit: 'fahrenheit',
		wind_speed_unit: 'mph',
		timezone: 'America/New_York',
	});
	const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) throw new Error(`open-meteo ${response.status}`);
	const json = (await response.json()) as {
		current: Record<(typeof FIELDS)[number] | 'time', number | string>;
		current_units?: Record<string, string>;
	};
	const c = json.current;
	const n = (key: (typeof FIELDS)[number], fallback: number) => {
		const v = Number(c[key]);
		return Number.isFinite(v) ? v : fallback;
	};
	const visibility = n('visibility', CLEAR.visibility);
	return {
		time: String(c.time ?? ''),
		temperature: n('temperature_2m', CLEAR.temperature),
		apparent: n('apparent_temperature', CLEAR.apparent),
		humidity: n('relative_humidity_2m', CLEAR.humidity),
		precipitation: n('precipitation', 0),
		code: n('weather_code', 0),
		cover: n('cloud_cover', 0),
		low: n('cloud_cover_low', 0),
		mid: n('cloud_cover_mid', 0),
		high: n('cloud_cover_high', 0),
		windSpeed: n('wind_speed_10m', CLEAR.windSpeed),
		windFrom: n('wind_direction_10m', CLEAR.windFrom),
		gusts: n('wind_gusts_10m', CLEAR.gusts),
		visibility: json.current_units?.visibility === 'ft' ? visibility * 0.3048 : visibility,
	};
}

let inflight: Promise<void> | null = null;

/** Publish the freshest reading we can: preview, cache, network, then fallback. */
async function refresh() {
	const preset = new URLSearchParams(location.search).get('weather')?.toLowerCase();
	if (preset && preset in PRESETS) {
		publish({ ...CLEAR, ...PRESETS[preset], source: 'preview', fetchedAt: 0, preset });
		return;
	}
	const cached = readCache();
	const age = cached ? Date.now() - cached.fetchedAt : Infinity;
	if (cached && age < FRESH_MS) {
		publish({ ...cached.conditions, source: 'cached', fetchedAt: cached.fetchedAt });
		return;
	}
	inflight ??= fetchConditions()
		.then((conditions) => {
			const fetchedAt = Date.now();
			writeCache({ fetchedAt, conditions });
			publish({ ...conditions, source: 'live', fetchedAt });
		})
		.catch(() => {
			if (cached && age < STALE_MS) publish({ ...cached.conditions, source: 'cached', fetchedAt: cached.fetchedAt });
			else publish({ ...CLEAR, source: 'fallback', fetchedAt: 0 });
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

let timer = 0;
let initializedForSwap = false;

function init() {
	initializedForSwap = true;
	clearInterval(timer);
	if (!('daylight' in document.body.dataset)) return;
	void refresh();
	// Checks are cheap (the cache answers until it's 15 minutes old).
	timer = window.setInterval(() => {
		if (!document.hidden) void refresh();
	}, 60 * 1000);
}

// Start at once (and on every swap): the reading shouldn't wait for window.load.
init();
document.addEventListener('astro:after-swap', init);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) init();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	clearInterval(timer);
});
document.addEventListener('visibilitychange', () => {
	if (!document.hidden && 'daylight' in document.body.dataset) void refresh();
});
