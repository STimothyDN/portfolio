/**
 * A roll's report card, for the top of its page: what it yielded, how many
 * keepers, how dense its negatives came back against the same film on your
 * other rolls, what each frame cost, and how long it spent at each stage.
 */
import { getFilmRolls } from '../../../utils/film';
import { median } from '../almanac';
import { daysBetween, type RollEventView, type RollView } from '../inventory';
import { LEGS, type LegKey } from '../stats/pipeline';

export interface RollReport {
	/** Scans back (null until linked), frames logged, exposures on the roll. */
	yield: { scans: number | null; frames: number; exposures: number };
	keepers: { n: number; of: number } | null;
	/** Median black point of this roll's scans, the same film's on other rolls (×100), and how many scans that's from. */
	density: { roll: number; film: number | null; others: number; lift: number | null } | null;
	cost: { totalCents: number; perFrameCents: number | null; parts: { film: number | null; lab: number | null; prints: number | null } } | null;
	/** Days spent in each leg, where both ends are dated. */
	days: Partial<Record<LegKey, number>>;
}

export async function rollReport(roll: RollView, events: RollEventView[], marks: Record<string, number> = {}): Promise<RollReport> {
	const desk = await getFilmRolls();
	const mine = roll.publicRollId ? desk.find((r) => r.id === roll.publicRollId) : undefined;
	const scans = mine?.data.photos ?? null;

	let density: RollReport['density'] = null;
	if (mine && scans?.some((p) => p.tone)) {
		const own = median(scans.filter((p) => p.tone).map((p) => Math.round(p.tone![0] * 100)))!;
		const others = desk.filter((r) => r.id !== mine.id && r.data.stock === mine.data.stock).flatMap((r) => r.data.photos.filter((p) => p.tone).map((p) => Math.round(p.tone![0] * 100)));
		const film = others.length >= 10 ? median(others) : null;
		density = { roll: own, film, others: others.length, lift: film == null ? null : own - film };
	}

	const film = roll.priceCents;
	const lab = roll.devCostCents;
	const prints = roll.printsIncluded ? 0 : roll.printsCostCents;
	const total = (film ?? 0) + (lab ?? 0) + (prints ?? 0);
	const frames = scans?.length || roll.frameCount || null;

	const on: Partial<Record<string, string>> = {};
	for (const e of events) on[e.status] = e.on;
	const days: RollReport['days'] = {};
	for (const leg of LEGS) {
		const a = on[leg.from];
		const b = on[leg.to];
		if (a && b && on.camera) days[leg.key] = Math.max(0, daysBetween(a, b));
	}

	return {
		yield: { scans: scans?.length ?? null, frames: roll.frameCount, exposures: roll.exposures },
		// Your marks first, then the rating each scan was uploaded with.
		keepers: scans ? { n: scans.filter((p) => (marks[p.filename] ?? p.priority) >= 4).length, of: scans.length } : null,
		density,
		cost: total ? { totalCents: total, perFrameCents: frames ? Math.round(total / frames) : null, parts: { film, lab, prints } } : null,
		days,
	};
}
