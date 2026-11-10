/**
 * Money: what film and developing cost, month by month (film on the day it
 * was bought, the lab on the day it was sent), where the year is heading at
 * the recent pace, and what a frame costs on each film.
 */
import type { Milestones } from '../almanac';
import { monthsBetween } from '../almanac';
import type { RollView } from '../inventory';

export interface MonthSpend {
	month: string;
	film: number;
	lab: number;
}

export interface Money {
	months: MonthSpend[];
	total: number;
	thisYear: number;
	/** Where this year ends at the last six months' pace (null with under two months of spending). */
	projection: number | null;
	perMonth: number | null;
	/** Cost per frame by film (rolls with both a price and a frame count only). */
	perFrame: { key: string; label: string; cents: number; rolls: number }[];
}

const labCents = (r: Pick<RollView, 'devCostCents' | 'printsIncluded' | 'printsCostCents'>) => (r.devCostCents ?? 0) + (r.printsIncluded ? 0 : (r.printsCostCents ?? 0));

export function money(rolls: RollView[], ms: Milestones, today: string, frames: Record<string, number> = {}): Money | null {
	const spend = new Map<string, MonthSpend>();
	const add = (day: string | null | undefined, key: 'film' | 'lab', cents: number) => {
		if (!day || !cents) return;
		const month = day.slice(0, 7);
		const m = spend.get(month) ?? { month, film: 0, lab: 0 };
		m[key] += cents;
		spend.set(month, m);
	};
	for (const r of rolls) {
		add(r.purchasedOn, 'film', r.priceCents ?? 0);
		add(ms[r.id]?.lab ?? (r.status === 'lab' ? r.statusOn : null), 'lab', labCents(r));
	}
	if (!spend.size) return null;
	const first = [...spend.keys()].sort()[0];
	const months = monthsBetween(first, today.slice(0, 7)).map((m) => spend.get(m) ?? { month: m, film: 0, lab: 0 });
	const total = months.reduce((t, m) => t + m.film + m.lab, 0);
	const year = today.slice(0, 4);
	const thisYear = months.filter((m) => m.month.startsWith(year)).reduce((t, m) => t + m.film + m.lab, 0);
	const recent = months.slice(-6);
	const perMonth = recent.length >= 2 ? recent.reduce((t, m) => t + m.film + m.lab, 0) / recent.length : null;
	const left = 12 - Number(today.slice(5, 7));
	const projection = perMonth == null ? null : Math.round(thisYear + perMonth * left);

	const byStock = new Map<string, { label: string; cents: number; frames: number; rolls: number }>();
	for (const r of rolls) {
		const n = frames[r.id] ?? 0;
		const cost = (r.priceCents ?? 0) + labCents(r);
		if (!n || !r.priceCents || !r.devCostCents) continue;
		const g = byStock.get(r.stock.id) ?? { label: r.stock.name, cents: 0, frames: 0, rolls: 0 };
		g.cents += cost;
		g.frames += n;
		g.rolls++;
		byStock.set(r.stock.id, g);
	}
	return {
		months,
		total,
		thisYear,
		projection,
		perMonth: perMonth == null ? null : Math.round(perMonth),
		perFrame: [...byStock].map(([key, g]) => ({ key, label: g.label, cents: Math.round(g.cents / g.frames), rolls: g.rolls })).sort((a, b) => b.cents - a.cents),
	};
}
