/**
 * The trip planner's sums: how much film a trip takes at the pace you
 * actually shoot, which speeds the forecast light asks for, which rolls in the
 * fridge to pack, and what else to check before leaving. Pure (the page
 * fetches the forecast and passes it in), so it's testable.
 */
import type { CameraBattery } from './batteries';
import { daysBetween, type RollView } from './inventory';

export interface DayWeather {
	date: string;
	/** WMO weather code. */
	code: number | null;
	cloud: number | null;
	rain: number | null;
	tMax: number | null;
	tMin: number | null;
}

export type DayLight = 'bright' | 'mixed' | 'dim';

/** A day's light from its forecast: clear and dry is bright, heavy cloud or rain is dim. */
export function lightOf(w: DayWeather | null | undefined): DayLight {
	if (!w || w.cloud == null) return 'mixed';
	const wet = (w.rain ?? 0) >= 60 || (w.code != null && w.code >= 61 && w.code <= 99);
	if (wet || w.cloud >= 85) return 'dim';
	if (w.cloud <= 35) return 'bright';
	return 'mixed';
}

export const WEATHER_WORDS: [number, string][] = [
	[0, 'Clear'],
	[1, 'Mostly clear'],
	[2, 'Partly cloudy'],
	[3, 'Overcast'],
	[45, 'Fog'],
	[51, 'Drizzle'],
	[61, 'Rain'],
	[71, 'Snow'],
	[80, 'Showers'],
	[95, 'Thunderstorms'],
];
export const weatherWord = (code: number | null) => (code == null ? '' : [...WEATHER_WORDS].reverse().find(([c]) => code >= c)?.[1] ?? '');

/** Every date from start to end, inclusive. */
export function tripDates(start: string, end: string): string[] {
	const n = Math.max(0, Math.min(60, daysBetween(start, end)));
	const t0 = Date.parse(`${start}T12:00:00Z`);
	return Array.from({ length: n + 1 }, (_, i) => new Date(t0 + i * 864e5).toISOString().slice(0, 10));
}

/**
 * Frames you shoot on a day you shoot at all: the median over the days with
 * logged frames (epoch-ms timestamps and their offsets). Null with fewer than
 * three such days.
 */
export function framesPerDay(frames: { shotAt: number; tzOffset: number }[]): number | null {
	const byDay = new Map<string, number>();
	for (const f of frames) {
		if (!f.shotAt) continue;
		const d = new Date(f.shotAt + f.tzOffset * 60_000).toISOString().slice(0, 10);
		byDay.set(d, (byDay.get(d) ?? 0) + 1);
	}
	const counts = [...byDay.values()].sort((a, b) => a - b);
	if (counts.length < 3) return null;
	return counts[Math.floor(counts.length / 2)];
}

export const INTENSITY = { light: 0.6, usual: 1, heavy: 1.6 } as const;
export type Intensity = keyof typeof INTENSITY;

export interface FilmNeed {
	frames: number;
	/** Rolls to bring, a spare included. */
	rolls: number;
	/** Frames still left in the cameras going along (already counted against `frames`). */
	inCameras: number;
}

/** Film for `days` shooting days at `perDay` frames, less what's left in the loaded cameras, plus one spare roll. */
export function filmNeed(days: number, perDay: number, exposures = 36, inCameras = 0): FilmNeed {
	const frames = Math.round(days * perDay);
	const toBuy = Math.max(0, frames - inCameras);
	return { frames, rolls: Math.ceil(toBuy / exposures) + 1, inCameras };
}

export type SpeedBand = 'slow' | 'mid' | 'fast';
export const BAND_LABEL: Record<SpeedBand, string> = { slow: 'ISO 50–200', mid: 'ISO 400', fast: 'ISO 800 and up' };
export const bandOf = (iso: number | null | undefined): SpeedBand => (!iso ? 'mid' : iso <= 250 ? 'slow' : iso < 640 ? 'mid' : 'fast');

/**
 * How many rolls of each speed, from the days' light: bright days lean slow,
 * dim days fast, and evenings out (golden hour, blue hour, the city at night)
 * take a share of fast film whatever the weather.
 */
export function speedMix(lights: DayLight[], rolls: number, evenings: boolean): Record<SpeedBand, number> {
	const out: Record<SpeedBand, number> = { slow: 0, mid: 0, fast: 0 };
	if (!rolls) return out;
	const w: Record<SpeedBand, number> = { slow: 0, mid: 0, fast: 0 };
	for (const l of lights.length ? lights : ['mixed' as DayLight]) {
		if (l === 'bright') (w.slow += 0.6), (w.mid += 0.4);
		else if (l === 'mixed') (w.slow += 0.2), (w.mid += 0.7), (w.fast += 0.1);
		else (w.mid += 0.5), (w.fast += 0.5);
	}
	if (evenings) w.fast += lights.length * 0.35;
	const total = w.slow + w.mid + w.fast;
	// Largest remainder, so the bands add up to the rolls exactly.
	const raw = (Object.keys(w) as SpeedBand[]).map((k) => ({ k, v: (w[k] / total) * rolls }));
	for (const r of raw) out[r.k] = Math.floor(r.v);
	let left = rolls - raw.reduce((s, r) => s + Math.floor(r.v), 0);
	for (const r of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
		if (left-- <= 0) break;
		out[r.k]++;
	}
	return out;
}

/**
 * Rolls from the fridge for each band: oldest dates first, a partly shot roll
 * last (it needs winding on). Short of a band, the nearest speed stands in.
 */
export function pickRolls(fridge: RollView[], mix: Record<SpeedBand, number>): { picked: { roll: RollView; band: SpeedBand; standIn: boolean }[]; short: Record<SpeedBand, number> } {
	const pool = [...fridge].sort(
		(a, b) => Number(!!a.rewoundAtFrame) - Number(!!b.rewoundAtFrame) || (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.code.localeCompare(b.code)
	);
	const used = new Set<string>();
	const picked: { roll: RollView; band: SpeedBand; standIn: boolean }[] = [];
	const short: Record<SpeedBand, number> = { slow: 0, mid: 0, fast: 0 };
	const NEAR: Record<SpeedBand, SpeedBand[]> = { slow: ['slow', 'mid', 'fast'], mid: ['mid', 'slow', 'fast'], fast: ['fast', 'mid', 'slow'] };
	for (const band of ['fast', 'slow', 'mid'] as SpeedBand[]) {
		for (let i = 0; i < mix[band]; i++) {
			let got: RollView | undefined;
			let standIn = false;
			for (const b of NEAR[band]) {
				got = pool.find((r) => !used.has(r.id) && bandOf(r.shotAtIso ?? r.stock.iso) === b);
				if (got) {
					standIn = b !== band;
					break;
				}
			}
			if (!got) {
				short[band]++;
				continue;
			}
			used.add(got.id);
			picked.push({ roll: got, band, standIn });
		}
	}
	return { picked, short };
}

export interface PackItem {
	key: string;
	text: string;
	tone: 'warn' | 'info';
}

/** Gear checks for the cameras going along, and the usual things to pack. */
export function packingList(input: {
	cameras: { id: string; name: string; loaded: boolean; framesLeft: number | null }[];
	batteries: CameraBattery[];
	box: { type: string; onHand: number }[];
	flying: boolean;
	fastRolls: number;
	days: number;
}): PackItem[] {
	const out: PackItem[] = [];
	for (const c of input.cameras) {
		const b = input.batteries.find((x) => x.cameraId === c.id);
		if (b?.key) {
			const have = input.box.find((x) => x.type === b.key)?.onHand ?? 0;
			if (b.old || b.months == null) {
				out.push({
					key: `batt-${c.id}`,
					tone: 'warn',
					text: `${c.name}: ${b.months == null ? 'battery age not known' : `batteries ${b.months} months old`}. Fit a fresh set before you go${have >= b.cells ? ` (${have} ${b.key} in the box)` : `: buy ${b.cells - have} ${b.key}`}.`,
				});
			} else if (input.days >= 5) {
				out.push({ key: `spare-${c.id}`, tone: 'info', text: `${c.name}: a spare set (${b.cells} × ${b.key})${have >= b.cells ? ', from the box' : ''}.` });
			}
		}
		if (!c.loaded) out.push({ key: `load-${c.id}`, tone: 'info', text: `${c.name} is empty: load it before you leave, so the first frame is one tap.` });
		else if (c.framesLeft != null && c.framesLeft <= 6) out.push({ key: `finish-${c.id}`, tone: 'info', text: `${c.name} has ${c.framesLeft} frames left: finish it or start the trip on a fresh roll.` });
	}
	if (input.flying) {
		out.push({
			key: 'xray',
			tone: input.fastRolls ? 'warn' : 'info',
			text: input.fastRolls
				? `Flying: ask for a hand check. Keep film in your carry-on, never checked bags; ${input.fastRolls} ${input.fastRolls === 1 ? 'roll is' : 'rolls are'} ISO 800 or faster, which the scanners fog first.`
				: 'Flying: film in your carry-on, never checked bags, and ask for a hand check.',
		});
	}
	out.push({ key: 'bag', tone: 'info', text: 'A clear zip bag for the film (it makes a hand check quick), a marker for canisters, a lens cloth and a blower.' });
	if (input.days >= 4) out.push({ key: 'shot-bag', tone: 'info', text: 'Somewhere to keep shot rolls apart from fresh ones, and out of the heat.' });
	return out;
}

export interface TripPlan {
	cameras: string[];
	intensity: Intensity;
	evenings: boolean;
	flying: boolean;
	rolls: string[];
}

export function parsePlan(text: string | null | undefined): TripPlan | null {
	try {
		const p = JSON.parse(text ?? '') as TripPlan;
		return p && Array.isArray(p.cameras) ? p : null;
	} catch {
		return null;
	}
}
