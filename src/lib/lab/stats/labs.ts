/**
 * Labs: how long each takes from drop-off (or posting) to scans, and so when
 * a roll sent today should come back. Pure, shared by the bench, the send slip
 * and the almanac.
 */
import type { Milestones } from '../almanac';
import { daysBetween, formatDay, type RollView } from '../inventory';
import { addDaysIso, legDays, LEGS, spread, type Spread } from './pipeline';

const LAB_LEG = LEGS.find((l) => l.key === 'lab')!;

/** Turnaround spread per lab id, from every roll timed through it. */
export function turnarounds(rolls: Pick<RollView, 'id' | 'lab'>[], ms: Milestones): Record<string, Spread> {
	const byLab = new Map<string, number[]>();
	const labOf = new Map(rolls.filter((r) => r.lab).map((r) => [r.id, r.lab!.id]));
	for (const { id, days } of legDays(ms, LAB_LEG, labOf.keys())) {
		const lab = labOf.get(id)!;
		const list = byLab.get(lab);
		if (list) list.push(days);
		else byLab.set(lab, [days]);
	}
	const out: Record<string, Spread> = {};
	for (const [lab, list] of byLab) {
		const s = spread(list);
		if (s) out[lab] = s;
	}
	return out;
}

export interface ReturnWindow {
	/** 'YYYY-MM-DD': the likely first and last day scans arrive (the middle half of past rolls). */
	from: string;
	to: string;
	median: string;
	/** "Nov 14–18", or "around Nov 16" with one past roll. */
	text: string;
	/** Days at the lab so far, and how that compares with the usual. */
	day: number;
	usual: number;
	/** Past the slowest the lab has been. */
	late: boolean;
	/** 0–1+: share of the usual time gone. */
	progress: number;
}

/** When scans should arrive for a roll sent on `sentOn`, given the lab's history. */
export function returnWindow(sentOn: string, s: Spread | null | undefined, today: string): ReturnWindow | null {
	if (!s) return null;
	const day = Math.max(0, daysBetween(sentOn, today));
	const from = addDaysIso(sentOn, Math.round(s.lo));
	const to = addDaysIso(sentOn, Math.round(s.hi));
	const median = addDaysIso(sentOn, Math.round(s.median));
	const sameMonth = from.slice(0, 7) === to.slice(0, 7);
	const text =
		s.n < 2 || from === to ? `around ${formatDay(median, false)}` : sameMonth ? `${formatDay(from, false)}–${Number(to.slice(8))}` : `${formatDay(from, false)} – ${formatDay(to, false)}`;
	return { from, to, median, text, day, usual: Math.round(s.median), late: day > s.max + 1, progress: day / Math.max(1, s.median) };
}
