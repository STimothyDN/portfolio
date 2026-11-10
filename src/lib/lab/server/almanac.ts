/**
 * The almanac: what your film adds up to, chapter by chapter. Everything is
 * worked out here, on the server, from the logbook and (for the owner) the
 * film desk's scans; the page only draws it. Each chapter carries its numbers,
 * its sample sizes, and the one sentence worth saying about them (or what it
 * needs before it can say anything).
 */
import { filmLabel, getFilmRolls } from '../../../utils/film';
import type { Finding } from '../insight';
import { daysBetween, formatDay, formatMoney, todayInDurham, type RollView } from '../inventory';
import { restockForecast } from '../pace';
import { byPosition, hitRates, rate, standsOut, type Rate, type ScanFact } from '../stats/keepers';
import { returnWindow, turnarounds, type ReturnWindow } from '../stats/labs';
import { bestSpeed, speedFits, type SpeedFit } from '../stats/light-fit';
import { money, type Money } from '../stats/money';
import { addDaysIso, averageRoll, backlogByWeek, legDays, LEGS, type LegKey, type Spread } from '../stats/pipeline';
import { rhythm, type Rhythm } from '../stats/rhythm';
import { cameraKit, lensApertures, type CameraKit } from '../stats/kit';
import { shelf, type ShelfRow } from '../stats/shelf';
import { isOwner, type LabConfig } from './config';
import type { LabUser } from './auth';
import { getDb } from './db/client';
import { framesPage, type DeskTone, type ReviewPoint } from './frames';
import { allFrames, listCameras, listLabs, listLenses, rollMilestones, rollViews, scanMarks, standing } from './inventory';

export interface Headline {
	chapter: string;
	text: string;
	tone: 'warn' | 'good' | 'info';
}

export interface AlmanacData {
	today: string;
	totals: { rolls: number; frames: number; scans: number; keepers: number | null };
	headlines: Headline[];
	pipeline: { legs: Record<LegKey, Spread | null>; values: Record<LegKey, number[]>; backlog: { week: string; shot: number; lab: number; scanned: number }[]; slowest: LegKey | null };
	exposure: { points: ReviewPoint[]; findings: Finding[]; desk: DeskTone | null; withScans: number };
	light: { fits: SpeedFit[]; best: { iso: number; inside: number } | null; frames: number };
	keepers: { overall: Rate | null; camera: Rate[]; stock: Rate[]; lab: Rate[]; position: Rate[]; costPerKeeper: number | null; scans: number };
	rhythm: Rhythm & { films: { key: string; label: string; n: number }[] };
	kit: { cameras: CameraKit[]; lenses: ReturnType<typeof lensApertures> };
	labs: { id: string; name: string; turnaround: Spread | null; days: number[]; costCents: number | null; lift: number | null; liftN: number; ifToday: ReturnWindow | null }[];
	money: Money | null;
	shelf: { rows: ShelfRow[]; monthsOfFilm: number | null; perMonth: number };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function almanacData(config: LabConfig, user: LabUser): Promise<AlmanacData> {
	const today = todayInDurham();
	const owner = isOwner(user);
	const d = await getDb(config);
	const [rolls, milestones, cameras, lenses, labs, frames, page, desk, marks] = await Promise.all([
		rollViews(d, user.id),
		rollMilestones(d, user.id),
		listCameras(d, user.id),
		listLenses(d, user.id),
		listLabs(d, user.id),
		allFrames(d, user.id),
		framesPage(d, user.id, owner),
		owner ? getFilmRolls() : Promise.resolve([]),
		owner ? scanMarks(d, user.id) : Promise.resolve({} as Record<string, Record<string, number>>),
	]);
	const byId = new Map(rolls.map((r) => [r.id, r]));
	const deskById = new Map(desk.map((r) => [r.id, r]));
	const scansOf: Record<string, number> = {};
	for (const r of rolls) if (r.publicRollId && deskById.has(r.publicRollId)) scansOf[r.id] = deskById.get(r.publicRollId)!.data.photos.length;
	const headlines: Headline[] = [];

	/* ---------- 1 · the life of a roll ---------- */
	const timed = Object.fromEntries(Object.entries(milestones).filter(([, m]) => m.camera));
	const legs = averageRoll(timed);
	const backlog = backlogByWeek(rolls, milestones, addDaysIso(today, -7 * 25), today).map((w) => ({ week: w.week, shot: w.counts.shot, lab: w.counts.lab, scanned: w.counts.scanned }));
	const slowest = (LEGS.filter((l) => legs[l.key]).sort((a, b) => legs[b.key]!.median - legs[a.key]!.median)[0]?.key ?? null) as LegKey | null;
	if (slowest && legs[slowest]!.n >= 3) {
		const s = legs[slowest]!;
		const label = LEGS.find((l) => l.key === slowest)!.label.toLowerCase();
		headlines.push({ chapter: 'life', tone: slowest === 'camera' ? 'info' : 'warn', text: `Film waits longest ${slowest === 'camera' ? 'in the camera' : label.replace(/^at /, 'at ')}: a median ${Math.round(s.median)} days (usually ${Math.round(s.lo)}–${Math.round(s.hi)}, over ${plural(s.n, 'roll')}).` });
	}

	/* ---------- 2 · exposure ---------- */
	const exposureFindings = [...page.review.findings, ...(page.desk?.findings ?? [])];
	const warn = exposureFindings.find((f) => f.tone === 'warn') ?? exposureFindings[0];
	if (warn) headlines.push({ chapter: 'exposure', tone: warn.tone, text: `${warn.title}. ${warn.text.split('. ')[0]}.` });

	/* ---------- 3 · film for the light ---------- */
	const isoOf = (rollId: string) => {
		const r = byId.get(rollId);
		return r ? (r.shotAtIso ?? r.stock.iso) : null;
	};
	const lit = page.rows.filter((f) => f.ev != null && isoOf(f.rollId)).map((f) => ({ ev: f.ev!, iso: isoOf(f.rollId)! }));
	const fits = speedFits(lit);
	const best = bestSpeed(lit);
	const dim = fits.find((f) => f.n >= 10 && f.under >= 0.25);
	if (dim) headlines.push({ chapter: 'light', tone: 'warn', text: `${pct(dim.under)} of your ISO ${dim.iso} frames were in light too dim for it hand-held. ${best && best.iso > dim.iso ? `ISO ${best.iso} would have covered ${pct(best.inside)} of everything you logged.` : ''}`.trim() });

	/* ---------- 4 · keepers ---------- */
	const facts: ScanFact[] = desk.flatMap((r) =>
		r.data.photos.map((p, i) => ({ roll: r.id, camera: r.data.camera, stock: r.data.stock, lab: r.data.lab, index: i + 1, count: r.data.photos.length, keeper: standing(marks[r.id]?.[p.filename], p.priority) >= 4 }))
	);
	const overall = facts.length ? rate('all', 'All scans', facts) : null;
	const camRates = hitRates(facts, (s) => s.camera, (k) => filmLabel('cameras', k));
	const stockRates = hitRates(facts, (s) => s.stock, (k) => filmLabel('stocks', k));
	const labRates = hitRates(facts, (s) => s.lab, (k) => filmLabel('labs', k));
	const linked = rolls.filter((r) => r.publicRollId && deskById.has(r.publicRollId));
	const spentLinked = linked.reduce((t, r) => t + (r.priceCents ?? 0) + (r.devCostCents ?? 0) + (r.printsIncluded ? 0 : (r.printsCostCents ?? 0)), 0);
	const keptLinked = linked.reduce((t, r) => t + deskById.get(r.publicRollId!)!.data.photos.filter((p) => standing(marks[r.publicRollId!]?.[p.filename], p.priority) >= 4).length, 0);
	if (overall) {
		const top = camRates.find((r) => standsOut(r, overall.rate) && r.rate > overall.rate);
		if (top) headlines.push({ chapter: 'keepers', tone: 'good', text: `The ${top.label} gives you the most keepers: ${pct(top.rate)} of its scans against ${pct(overall.rate)} overall (${top.n} scans).` });
	}

	/* ---------- 5 · rhythm ---------- */
	const rh = rhythm(frames, rolls, milestones, today);

	/* ---------- 6 · kit ---------- */
	const camLift = Object.fromEntries((page.desk?.cameras ?? []).map((g) => [g.key, { lift: g.lift, compared: g.compared }]));
	const kitCams = cameraKit(cameras, rolls, milestones, today, scansOf, camLift);
	const idle = kitCams.filter((c) => c.idle != null && c.idle >= 45).sort((a, b) => b.idle! - a.idle!)[0];
	if (idle) headlines.push({ chapter: 'kit', tone: 'info', text: `The ${idle.name} has sat empty ${idle.idle} days, after ${plural(idle.rolls, 'roll')}.` });

	/* ---------- 7 · labs ---------- */
	const turn = turnarounds(rolls, milestones);
	const labLift = new Map((page.desk?.labs ?? []).map((g) => [g.key, g]));
	const labRows = labs.map((l) => {
		const days = rolls
			.filter((r) => r.lab?.id === l.id)
			.map((r) => (milestones[r.id]?.lab && milestones[r.id]?.scanned ? daysBetween(milestones[r.id].lab!, milestones[r.id].scanned!) : null))
			.filter((v): v is number => v != null && v >= 0);
		const g = l.token ? labLift.get(l.token) : undefined;
		return { id: l.id, name: l.name, turnaround: turn[l.id] ?? null, days, costCents: l.costCents, lift: g?.lift != null ? Math.round(g.lift * 100) : null, liftN: g?.compared ?? 0, ifToday: returnWindow(today, turn[l.id], today) };
	});
	const fastest = labRows.filter((l) => l.turnaround && l.turnaround.n >= 2).sort((a, b) => a.turnaround!.median - b.turnaround!.median);
	if (fastest.length >= 2) headlines.push({ chapter: 'labs', tone: 'info', text: `${fastest[0].name} turns film round fastest (${Math.round(fastest[0].turnaround!.median)} days); sent today, scans would be back ${fastest[0].ifToday?.text}.` });

	/* ---------- 8 · money ---------- */
	const frameCounts = Object.fromEntries(rolls.map((r) => [r.id, scansOf[r.id] ?? r.frameCount]));
	const mo = money(rolls, milestones, today, frameCounts);
	if (mo?.projection) headlines.push({ chapter: 'money', tone: 'info', text: `${formatMoney(mo.thisYear)} on film and developing this year; at this pace, about ${formatMoney(mo.projection)} by December.` });

	/* ---------- 9 · shelf life ---------- */
	const forecast = restockForecast(rolls, Object.fromEntries(rolls.map((r) => [r.id, milestones[r.id]?.camera])), today);
	const rows = shelf(rolls, forecast.byStock, today);
	const late = rows.filter((r) => r.late && !r.expired);
	if (late.length) headlines.push({ chapter: 'shelf', tone: 'warn', text: `${plural(late.length, 'roll')} in the fridge will pass ${late.length === 1 ? 'its' : 'their'} date before you reach ${late.length === 1 ? 'it' : 'them'} at your pace, starting with ${late[0].code} (${late[0].stock}, ${formatDay(late[0].expires, true)}).` });

	return {
		today,
		totals: { rolls: rolls.length, frames: frames.length, scans: facts.length, keepers: overall ? overall.k : null },
		headlines: headlines.slice(0, 5),
		pipeline: { legs, values: Object.fromEntries(LEGS.map((l) => [l.key, legDays(timed, l).map((x) => x.days)])) as Record<LegKey, number[]>, backlog, slowest },
		exposure: { points: page.review.points, findings: exposureFindings, desk: page.desk, withScans: page.review.withScans },
		light: { fits, best, frames: lit.length },
		keepers: { overall, camera: camRates, stock: stockRates, lab: labRates, position: byPosition(facts), costPerKeeper: keptLinked && spentLinked ? Math.round(spentLinked / keptLinked) : null, scans: facts.length },
		rhythm: { ...rh, films: [...rolls.filter((r) => r.status !== 'storage').reduce((m, r) => m.set(r.stock.id, { key: r.stock.id, label: r.stock.name, n: (m.get(r.stock.id)?.n ?? 0) + 1 }), new Map<string, { key: string; label: string; n: number }>()).values()].sort((a, b) => b.n - a.n) },
		kit: { cameras: kitCams, lenses: lensApertures(frames, lenses) },
		labs: labRows.filter((l) => l.days.length || l.turnaround),
		money: mo,
		shelf: { rows, monthsOfFilm: forecast.monthsOfFilm, perMonth: forecast.perMonth },
	};
}

/** For tests and the empty state: does a chapter have enough to draw? */
export const enough = (n: number, min: number) => n >= min;
export type { RollView };
