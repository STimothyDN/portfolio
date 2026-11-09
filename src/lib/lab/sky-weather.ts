/**
 * The weather where you're shooting, for shooting mode's sky meter. From
 * Open-Meteo: free, keyless, CORS-open. Only a rounded position (about a
 * kilometre) is sent. A reading is reused for 15 minutes; with no signal,
 * the last one (up to 3 hours old) stands in, else there's none and the
 * meter asks you to pick the sky.
 */
import type { SkyConditions } from './light';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'lab-sky-v1';
const FRESH_MS = 15 * 60_000;
const STALE_MS = 3 * 3_600_000;
const TIMEOUT_MS = 6000;

export interface SkyFetch extends SkyConditions {
	/** When it was read (ms). */
	at: number;
	lat: number;
	lon: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const near = (a: SkyFetch, lat: number, lon: number) => Math.abs(a.lat - lat) < 0.05 && Math.abs(a.lon - lon) < 0.05;

function cached(): SkyFetch | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		return raw ? (JSON.parse(raw) as SkyFetch) : null;
	} catch {
		return null;
	}
}

function remember(r: SkyFetch) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(r));
	} catch {
		// Private mode or full storage: the next reading just fetches again.
	}
}

/** Cloud cover and weather code near (lat, lon), or null with no reading to go on. */
export async function skyAt(latitude: number, longitude: number): Promise<SkyFetch | null> {
	const lat = round2(latitude);
	const lon = round2(longitude);
	const last = cached();
	if (last && near(last, lat, lon) && Date.now() - last.at < FRESH_MS) return last;
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		const url = `${ENDPOINT}?latitude=${lat}&longitude=${lon}&current=cloud_cover,weather_code&timezone=auto`;
		const res = await fetch(url, { signal: ctrl.signal });
		clearTimeout(timer);
		if (!res.ok) throw new Error(String(res.status));
		const body = (await res.json()) as { current?: { cloud_cover?: number; weather_code?: number } };
		const cover = body.current?.cloud_cover;
		const code = body.current?.weather_code;
		if (typeof cover !== 'number' || typeof code !== 'number') throw new Error('No current conditions');
		const reading = { cover, code, at: Date.now(), lat, lon };
		remember(reading);
		return reading;
	} catch {
		return last && near(last, lat, lon) && Date.now() - last.at < STALE_MS ? last : null;
	}
}
