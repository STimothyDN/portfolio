/**
 * Arithmetic for the Rolls almanac: which month a roll belongs to, film speed
 * buckets, exposure values. Shared by the server page and the islands.
 */
import type { RollStatus, RollView } from './inventory';

export type Milestones = Record<string, Partial<Record<RollStatus, string>>>;
export type FrameDigest = [aperture: number | null, shutter: string | null, hour: number | null, rollId: string];

/** A filter the almanac's charts set on the list below them. */
export interface Facet {
	kind: 'stock' | 'camera' | 'lab' | 'iso' | 'month';
	value: string;
	label: string;
}

/** The speeds on a camera's ISO dial (full stops). */
export const ISO_STOPS = [25, 50, 100, 200, 400, 800, 1600, 3200];

/** The nearest full-stop speed: a 160 or 250 film files under 200. */
export function isoBucket(iso: number | null | undefined): number | null {
	if (!iso) return null;
	return ISO_STOPS.reduce((best, s) => (Math.abs(Math.log2(s / iso)) < Math.abs(Math.log2(best / iso)) ? s : best), ISO_STOPS[0]);
}

/**
 * The month a roll belongs to on the calendar: when it was finished, or for
 * older rolls when it was developed; a roll still in a camera counts from the
 * day it was loaded. Rolls in storage aren't on it yet.
 */
export function rollMonth(r: Pick<RollView, 'id' | 'status' | 'statusOn'>, ms: Milestones): string | null {
	if (r.status === 'storage') return null;
	const m = ms[r.id] ?? {};
	const day = m.shot ?? m.scanned ?? m.lab ?? m.negatives ?? m.camera ?? (r.status === 'lost' ? r.statusOn : null);
	return day ? day.slice(0, 7) : null;
}

export function median(list: number[]): number | null {
	if (!list.length) return null;
	const s = [...list].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const daysFrom = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 864e5);

/** '1/125' → 0.008, '2s' → 2, 'B' → null. */
export function shutterSeconds(s: string | null): number | null {
	if (!s || s === 'B') return null;
	if (s.endsWith('s')) return Number(s.slice(0, -1)) || null;
	const [n, dd] = s.split('/').map(Number);
	return dd ? n / dd : n || null;
}

/** The exposure value of a camera setting: EV = log2(N² / t). */
export const evOf = (aperture: number, seconds: number) => Math.log2((aperture * aperture) / seconds);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string, withYear = false) =>
	`${MONTHS[Number(ym.slice(5, 7)) - 1]}${withYear ? ` ${ym.slice(0, 4)}` : ''}`;

/** Every 'YYYY-MM' from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
	const out: string[] = [];
	let [y, m] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	while (y < ty || (y === ty && m <= tm)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

/** Does a roll pass the almanac's current filter? */
export function matchesFacet(r: RollView, f: Facet | null, ms: Milestones): boolean {
	if (!f) return true;
	switch (f.kind) {
		case 'stock':
			return r.stock.id === f.value;
		case 'camera':
			return r.camera?.id === f.value;
		case 'lab':
			return r.lab?.id === f.value;
		case 'iso':
			return String(isoBucket(r.stock.iso)) === f.value;
		case 'month':
			return rollMonth(r, ms) === f.value;
	}
}
