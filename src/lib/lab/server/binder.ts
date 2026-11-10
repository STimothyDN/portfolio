/**
 * The binder: every roll you've logged, with the dated moves its line is
 * drawn from, a strip of its best scans (when it's on the film desk), and what
 * adding rolls needs. One parallel batch.
 */
import type { Milestones } from '../almanac';
import { todayInDurham, type RollView, type StockView } from '../inventory';
import { averageRoll, type LegKey, type Spread } from '../stats/pipeline';
import { strips, type BenchStrip } from './bench';
import { isOwner, type LabConfig } from './config';
import type { LabUser } from './auth';
import { getDb } from './db/client';
import { deskRolls, listStocks, rollMilestones, rollViews, scanMarks, stepChoices } from './inventory';

export interface BinderData {
	today: string;
	rolls: RollView[];
	milestones: Milestones;
	strips: Record<string, BenchStrip>;
	legs: Record<LegKey, Spread | null>;
	deskCounts: Record<string, number>;
	stocks: StockView[];
	spots: string[];
	shops: string[];
	importable: number;
}

export async function binderData(config: LabConfig, user: LabUser): Promise<BinderData> {
	const d = await getDb(config);
	const owner = isOwner(user);
	const [rolls, stocks, choices, milestones, desk, marks] = await Promise.all([
		rollViews(d, user.id),
		listStocks(d, user.id),
		stepChoices(d, user.id, owner),
		rollMilestones(d, user.id),
		deskRolls(),
		scanMarks(d, user.id),
	]);
	const unique = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort();
	return {
		today: todayInDurham(),
		rolls,
		milestones,
		strips: await strips(rolls.filter((r) => r.publicRollId), 6, marks),
		// Imported rolls never went through the bench, so they don't count toward the usual waits.
		legs: averageRoll(Object.fromEntries(Object.entries(milestones).filter(([, m]) => m.camera))),
		deskCounts: Object.fromEntries(desk.map((r) => [r.id, r.count])),
		stocks,
		spots: unique(rolls.map((r) => r.storageSpot)),
		shops: unique(rolls.map((r) => r.purchasedFrom)),
		importable: rolls.length ? choices.deskRolls.length : 0,
	};
}
