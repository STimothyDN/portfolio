/**
 * Rhythm: when you shoot. Logged frames by hour of the day (where they were
 * taken) and by day of the week, and rolls finished per month.
 */
import { monthsBetween, rollMonth, type Milestones } from '../almanac';
import type { RollView } from '../inventory';

export interface Rhythm {
	hours: number[];
	weekdays: number[];
	months: { month: string; n: number }[];
	frames: number;
	/** The busiest two-hour stretch, as "4–6 pm". */
	peak: string | null;
}

const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? ' am' : ' pm'}`;

export function rhythm(frames: { shotAt: number; tzOffset: number }[], rolls: RollView[], ms: Milestones, today: string): Rhythm {
	const hours = Array(24).fill(0);
	const weekdays = Array(7).fill(0);
	let n = 0;
	for (const f of frames) {
		if (!f.shotAt) continue;
		const d = new Date(f.shotAt + f.tzOffset * 60_000);
		hours[d.getUTCHours()]++;
		weekdays[d.getUTCDay()]++;
		n++;
	}
	let peak: string | null = null;
	if (n >= 12) {
		let best = 0;
		for (let h = 0; h < 24; h++) if (hours[h] + hours[(h + 1) % 24] > hours[best] + hours[(best + 1) % 24]) best = h;
		peak = `${hourLabel(best)}–${hourLabel((best + 2) % 24)}`;
	}
	const byMonth = new Map<string, number>();
	for (const r of rolls) {
		const m = rollMonth(r, ms);
		if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
	}
	const first = [...byMonth.keys()].sort()[0];
	const months = first ? monthsBetween(first, today.slice(0, 7)).map((m) => ({ month: m, n: byMonth.get(m) ?? 0 })) : [];
	return { hours, weekdays, months, frames: n, peak };
}
