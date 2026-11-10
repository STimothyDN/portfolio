/**
 * The life of a roll: how long film spends at each stage, from the dated
 * moves in the logbook (roll_event). Pure date arithmetic, shared by the
 * bench (waits, nudges, annotations), the binder's line and the almanac.
 */
import type { Milestones } from '../almanac';
import { daysBetween, STAGES, type RollStatus, type RollView, type Stage } from '../inventory';

/** The four waits a finished roll goes through, in order. */
export const LEGS = [
	{ key: 'camera', from: 'camera', to: 'shot', label: 'In the camera' },
	{ key: 'waiting', from: 'shot', to: 'lab', label: 'Waiting to send' },
	{ key: 'lab', from: 'lab', to: 'scanned', label: 'At the lab' },
	{ key: 'filing', from: 'scanned', to: 'negatives', label: 'Scans in, negatives not filed' },
] as const;
export type LegKey = (typeof LEGS)[number]['key'];

/** Quantile of a sorted list (linear between ranks). */
export function quantile(sorted: number[], q: number): number | null {
	if (!sorted.length) return null;
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Spread {
	n: number;
	median: number;
	/** The middle half: 25th and 75th percentiles. */
	lo: number;
	hi: number;
	min: number;
	max: number;
}

export function spread(values: number[]): Spread | null {
	const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (!s.length) return null;
	const r1 = (v: number | null) => Math.round((v ?? 0) * 10) / 10;
	return { n: s.length, median: r1(quantile(s, 0.5)), lo: r1(quantile(s, 0.25)), hi: r1(quantile(s, 0.75)), min: s[0], max: s[s.length - 1] };
}

/** Days each roll spent in one leg (only rolls with both ends dated, and never negative). */
export function legDays(ms: Milestones, leg: (typeof LEGS)[number], ids?: Iterable<string>): { id: string; days: number }[] {
	const out: { id: string; days: number }[] = [];
	for (const id of ids ?? Object.keys(ms)) {
		const m = ms[id];
		const a = m?.[leg.from as RollStatus];
		const b = m?.[leg.to as RollStatus];
		if (!a || !b) continue;
		const days = daysBetween(a, b);
		if (days >= 0) out.push({ id, days });
	}
	return out;
}

/** The average roll: the spread of each leg across every roll that went through it. */
export function averageRoll(ms: Milestones): Record<LegKey, Spread | null> {
	return Object.fromEntries(LEGS.map((leg) => [leg.key, spread(legDays(ms, leg).map((x) => x.days))])) as Record<LegKey, Spread | null>;
}

/** How long a roll has been where it is now (days since its latest move). */
export const daysHere = (r: Pick<RollView, 'statusOn'>, today: string) => Math.max(0, daysBetween(r.statusOn, today));

/**
 * Every roll's path as dated segments, one per stage it has been in, for the
 * binder's line: [stage, from, to] with `to` = today for the stage it's in now.
 */
export function segments(r: Pick<RollView, 'id' | 'status' | 'statusOn'>, ms: Milestones, today: string): { stage: Stage; from: string; to: string }[] {
	const m = ms[r.id] ?? {};
	const dated = STAGES.filter((s) => m[s]).map((s) => ({ stage: s, on: m[s]! }));
	// Older imports may only know some dates; the stage they're in now is always dated.
	if (r.status !== 'lost' && !m[r.status as Stage]) dated.push({ stage: r.status as Stage, on: r.statusOn });
	dated.sort((a, b) => a.on.localeCompare(b.on) || STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
	return dated.map((d, i) => ({ stage: d.stage, from: d.on, to: dated[i + 1]?.on ?? (d.stage === 'negatives' ? d.on : today) }));
}

/** Rolls waiting at each stage, week by week, for the backlog chart. */
export function backlogByWeek(rolls: Pick<RollView, 'id' | 'status' | 'statusOn'>[], ms: Milestones, from: string, today: string, stages: Stage[] = ['shot', 'lab', 'scanned']): { week: string; counts: Record<Stage, number> }[] {
	const out: { week: string; counts: Record<Stage, number> }[] = [];
	const segs = rolls.map((r) => segments(r, ms, today));
	for (let day = from; day <= today; day = addDaysIso(day, 7)) {
		const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
		for (const list of segs) for (const s of list) if (stages.includes(s.stage) && s.from <= day && day < s.to) counts[s.stage]++;
		out.push({ week: day, counts });
	}
	return out;
}

export function addDaysIso(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
