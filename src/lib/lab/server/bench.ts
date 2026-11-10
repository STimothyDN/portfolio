/**
 * Everything the bench shows, in one parallel batch: every roll that isn't
 * filed (and the last few that are), the cameras that could take film, the
 * labs with their turnaround, and the dated moves the waits are worked out
 * from. The close-ups (fridge, kit, post) use the same read for their mini-map.
 */
import { eq, sql } from 'drizzle-orm';

import { frameExposure, negativeProfileKey, type NegativeProfileKey } from '../../../components/film/negative';
import { bunnyUrl } from '../../../utils/bunny';
import { filmBrand, filmLabel, getFilmRolls, isMonochrome, rollFolder } from '../../../utils/film';
import type { Milestones } from '../almanac';
import { type RollView, type StepChoices } from '../inventory';
import { restockForecast } from '../pace';
import { turnarounds } from '../stats/labs';
import { averageRoll, type LegKey, type Spread } from '../stats/pipeline';
import { isOwner, type LabConfig } from './config';
import type { LabUser } from './auth';
import { getDb } from './db/client';
import { roll } from './db/schema';
import { binderHints, labSettings, listCameras, listLabs, rollMilestones, rollViews, scanMarks, standing, stepChoices } from './inventory';
import { listPasskeys } from './plugin';
import { rewind, type Rewind } from './rewind';

export interface BenchCamera {
	id: string;
	name: string;
	kind: string;
	format: string;
	mount: string | null;
	fixedLens: string | null;
	battery: string | null;
	batteryChangedOn: string | null;
	status: string;
	/** Rolls it has shot (all time), and the day the last one came out. */
	rolls: number;
	lastOut: string | null;
}

export interface BenchLab {
	id: string;
	name: string;
	location: string | null;
	costCents: number | null;
	turnaround: Spread | null;
}

export interface StripScan {
	src: string;
	exposure: number;
	w?: number;
	h?: number;
	keeper: boolean;
}

/** A linked roll's scans, drawn as a strip of negatives (a few of its best, in frame order). */
export interface BenchStrip {
	profile: NegativeProfileKey;
	scans: StripScan[];
	count: number;
	keepers: number;
}

export interface BenchData {
	today: string;
	owner: boolean;
	/** Every roll not yet filed (or lost). */
	rolls: RollView[];
	filed: { count: number; recent: RollView[] };
	total: number;
	cameras: BenchCamera[];
	labs: BenchLab[];
	choices: StepChoices;
	milestones: Milestones;
	/** How long each stage usually takes, across every roll. */
	legs: Record<LegKey, Spread | null>;
	strips: Record<string, BenchStrip>;
	forecast: ReturnType<typeof restockForecast>;
	binderHints: string[];
	shareLoaded: boolean | null;
	passkeys: number;
	rewind: Rewind | null;
}

const STRIP_FRAMES = 6;

/** A few of a desk roll's best scans, in frame order and spread across the roll. */
export async function strips(rolls: RollView[], frames = STRIP_FRAMES, marks: Record<string, Record<string, number>> = {}): Promise<Record<string, BenchStrip>> {
	const linked = rolls.filter((r) => r.publicRollId);
	if (!linked.length) return {};
	const desk = new Map((await getFilmRolls()).map((r) => [r.id, r]));
	const out: Record<string, BenchStrip> = {};
	for (const r of linked) {
		const d = desk.get(r.publicRollId!);
		if (!d) continue;
		const photos = d.data.photos;
		const own = marks[d.id] ?? {};
		const rank = (p: (typeof photos)[number]) => standing(own[p.filename], p.priority);
		const ranked = photos.map((p, i) => ({ p, i })).sort((a, b) => rank(b.p) - rank(a.p) || a.i - b.i);
		const picks = ranked.slice(0, frames).sort((a, b) => a.i - b.i);
		const label = filmLabel('stocks', d.data.stock);
		out[r.id] = {
			profile: negativeProfileKey(label, filmBrand('stocks', d.data.stock), isMonochrome(label)),
			count: photos.length,
			keepers: photos.filter((p) => rank(p) >= 4).length,
			scans: picks.map(({ p }) => ({
				src: bunnyUrl(`${rollFolder(d)}/${p.filename}`, { width: 240, format: 'webp', quality: 62 }),
				exposure: p.tone ? frameExposure(p.tone as [number, number, number]) : 0,
				w: p.width,
				h: p.height,
				keeper: rank(p) >= 4,
			})),
		};
	}
	return out;
}

export async function benchData(config: LabConfig, user: LabUser, today: string): Promise<BenchData> {
	const d = await getDb(config);
	const owner = isOwner(user);
	const [all, cameras, labs, choices, milestones, hints, settings, passkeys, marks] = await Promise.all([
		rollViews(d, user.id),
		listCameras(d, user.id),
		listLabs(d, user.id),
		stepChoices(d, user.id, owner),
		rollMilestones(d, user.id),
		binderHints(d, user.id),
		labSettings(d, user.id),
		listPasskeys(config, user.id),
		scanMarks(d, user.id),
	]);
	const active = all.filter((r) => r.status !== 'negatives' && r.status !== 'lost');
	const filed = all.filter((r) => r.status === 'negatives').sort((a, b) => b.statusOn.localeCompare(a.statusOn) || b.code.localeCompare(a.code));
	const recent = filed.slice(0, 4);
	const turnaround = turnarounds(all, milestones);
	const forecast = restockForecast(all, Object.fromEntries(all.map((r) => [r.id, milestones[r.id]?.camera])), today);

	const camUse = new Map<string, { rolls: number; lastOut: string | null }>();
	for (const r of all) {
		if (!r.camera) continue;
		const u = camUse.get(r.camera.id) ?? { rolls: 0, lastOut: null };
		u.rolls++;
		const out = milestones[r.id]?.shot;
		if (out && (!u.lastOut || out > u.lastOut)) u.lastOut = out;
		camUse.set(r.camera.id, u);
	}
	const [stripMap, rw] = await Promise.all([strips([...active.filter((r) => r.status === 'scanned'), ...recent], STRIP_FRAMES, marks), owner && all.length ? rewind(all, today) : Promise.resolve(null)]);

	return {
		today,
		owner,
		rolls: active,
		filed: { count: filed.length, recent },
		total: all.length,
		cameras: cameras
			.filter((c) => c.status === 'active' || c.status === 'shelf' || c.status === 'repair' || active.some((r) => r.camera?.id === c.id && r.status === 'camera'))
			.map((c) => ({
				id: c.id,
				name: c.name,
				kind: c.kind,
				format: c.format,
				mount: c.mount,
				fixedLens: c.fixedLens,
				battery: c.battery,
				batteryChangedOn: c.batteryChangedOn,
				status: c.status,
				rolls: camUse.get(c.id)?.rolls ?? 0,
				lastOut: camUse.get(c.id)?.lastOut ?? null,
			})),
		labs: labs.map((l) => ({ id: l.id, name: l.name, location: l.location, costCents: l.costCents, turnaround: turnaround[l.id] ?? null })),
		choices,
		// Rolls imported from the desk never went through the bench (no loading date): their waits aren't real.
		legs: averageRoll(Object.fromEntries(Object.entries(milestones).filter(([, m]) => m.camera))),
		milestones: Object.fromEntries(active.map((r) => [r.id, milestones[r.id] ?? {}])),
		strips: stripMap,
		forecast,
		binderHints: hints,
		shareLoaded: owner ? settings.shareLoaded : null,
		passkeys: passkeys.length,
		rewind: rw,
	};
}

/** Rolls at each stage, for the close-ups' mini-map of the bench. */
export async function stageCounts(config: LabConfig, userId: string): Promise<Record<string, number>> {
	const d = await getDb(config);
	const rows = await d.select({ status: roll.status, n: sql<number>`count(*)` }).from(roll).where(eq(roll.userId, userId)).groupBy(roll.status);
	return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
