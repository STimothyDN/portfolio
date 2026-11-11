/**
 * Developing at home: recipes, the step sequence a timer runs, temperature
 * and reuse compensation, and what a run records on its roll. Pure, so the
 * darkroom page, the roll page and the tests agree.
 *
 * The built-in times are STARTING POINTS taken from the makers' data sheets
 * (and CineStill's leaflet for its kit), each with its source. Developers,
 * water and agitation vary: check the sheet that came with your chemistry,
 * and save your own recipe once you've dialled it in.
 */

export type Process = 'bw' | 'c41' | 'e6';

export const PROCESS_LABEL: Record<Process, string> = { bw: 'Black and white', c41: 'C-41 colour negative', e6: 'E-6 slide' };

/** How to agitate during a step: continuous at the start, then a burst every so often. */
export interface Agitation {
	key: string;
	label: string;
	/** Seconds of agitation at the very start. */
	first: number;
	/** Seconds between bursts after that (0: none, e.g. stand development). */
	every: number;
	/** Seconds each burst lasts. */
	burst: number;
	/** What to do in a burst, in words. */
	how: string;
}

export const AGITATION: Record<string, Agitation> = {
	ilford: { key: 'ilford', label: 'Ilford: 4 inversions a minute', first: 10, every: 60, burst: 10, how: '4 inversions in 10 seconds' },
	kodak: { key: 'kodak', label: 'Kodak: 5 inversions every 30 s', first: 30, every: 30, burst: 5, how: '5 inversions in 5 seconds' },
	gentle: { key: 'gentle', label: 'Gentle: 1 inversion every 30 s', first: 10, every: 30, burst: 3, how: 'one slow inversion' },
	stand: { key: 'stand', label: 'Semi-stand: once at the halfway mark', first: 30, every: 0, burst: 10, how: 'a few gentle inversions' },
	rotary: { key: 'rotary', label: 'Rotary (continuous)', first: 0, every: 0, burst: 0, how: 'keep it rolling' },
};

export interface Step {
	key: string;
	label: string;
	seconds: number;
	agitation?: string | null;
	/** This step's time follows the developer temperature (the developer itself). */
	develop?: boolean;
	note?: string;
}

export interface RecipeSpec {
	process: Process;
	/** "Ilford HP5 Plus" (free text; matched loosely to a roll's stock). */
	film: string;
	developer: string;
	dilution: string;
	/** The exposure index the time is for. */
	ei: number;
	/** Developer time, seconds, at `tempC`. */
	devSeconds: number;
	tempC: number;
	agitation: string;
	/** Every step in order (the developer step is the one with develop: true). */
	steps: Step[];
	/** Percent more developer time for each roll already through the chemistry (reusable kits). */
	reusePct?: number;
	/** Where the time comes from. */
	source?: string;
	notes?: string;
}

export interface BuiltIn extends RecipeSpec {
	id: string;
	name: string;
}

/* ---------- the standard step lists ---------- */

const bwSteps = (devSeconds: number, agitation: string): Step[] => [
	{ key: 'prewash', label: 'Pre-wash (optional)', seconds: 60, agitation: 'gentle', note: 'Water at the developer’s temperature. Skip it if the data sheet says to.' },
	{ key: 'develop', label: 'Develop', seconds: devSeconds, agitation, develop: true },
	{ key: 'stop', label: 'Stop', seconds: 30, agitation: 'gentle', note: 'Stop bath, or two changes of water.' },
	{ key: 'fix', label: 'Fix', seconds: 300, agitation: 'ilford', note: 'Rapid fixer 1+4 clears in 2–5 minutes; check the clip test on your fixer.' },
	{ key: 'wash', label: 'Wash', seconds: 300, agitation: 'gentle', note: 'Ilford method: fill, 5 inversions, drain; fill, 10; fill, 20. Or running water.' },
	{ key: 'wetting', label: 'Wetting agent', seconds: 30, agitation: null, note: 'A drop of wetting agent in distilled water; hang to dry.' },
];

const c41Steps = (devSeconds: number): Step[] => [
	{ key: 'prewarm', label: 'Pre-warm the tank', seconds: 60, agitation: 'gentle', note: 'Water at process temperature, so the developer doesn’t cool on the steel.' },
	{ key: 'develop', label: 'Develop', seconds: devSeconds, agitation: 'gentle', develop: true },
	{ key: 'blix', label: 'Blix', seconds: 480, agitation: 'gentle', note: 'Blix time doesn’t grow with reuse.' },
	{ key: 'wash', label: 'Wash', seconds: 180, agitation: 'gentle', note: 'Running water, around process temperature.' },
	{ key: 'stabilize', label: 'Stabilizer', seconds: 60, agitation: null, note: 'No rinse after; hang to dry.' },
];

const bw = (id: string, film: string, developer: string, dilution: string, ei: number, minutes: number, source: string, agitation = 'ilford'): BuiltIn => ({
	id,
	name: `${film} · ${developer} ${dilution} · EI ${ei}`,
	process: 'bw',
	film,
	developer,
	dilution,
	ei,
	devSeconds: Math.round(minutes * 60),
	tempC: 20,
	agitation,
	steps: bwSteps(Math.round(minutes * 60), agitation),
	source,
});

/** Starting points, from the makers' sheets. */
export const BUILT_IN: BuiltIn[] = [
	bw('hp5-ddx-400', 'Ilford HP5 Plus', 'Ilfotec DD-X', '1+4', 400, 9, 'Ilford HP5 Plus data sheet'),
	bw('hp5-ddx-800', 'Ilford HP5 Plus', 'Ilfotec DD-X', '1+4', 800, 10, 'Ilford HP5 Plus data sheet'),
	bw('hp5-ddx-1600', 'Ilford HP5 Plus', 'Ilfotec DD-X', '1+4', 1600, 13, 'Ilford HP5 Plus data sheet'),
	bw('hp5-ddx-3200', 'Ilford HP5 Plus', 'Ilfotec DD-X', '1+4', 3200, 20, 'Ilford HP5 Plus data sheet'),
	bw('hp5-ilfosol-400', 'Ilford HP5 Plus', 'Ilfosol 3', '1+9', 400, 6.5, 'Ilford HP5 Plus data sheet'),
	bw('trix-d76-400', 'Kodak Tri-X 400', 'Kodak D-76', 'stock', 400, 6.75, 'Kodak Tri-X data sheet (F-4017)', 'kodak'),
	bw('trix-d76h-400', 'Kodak Tri-X 400', 'Kodak D-76', '1+1', 400, 9.75, 'Kodak Tri-X data sheet (F-4017)', 'kodak'),
	bw('trix-xtol-400', 'Kodak Tri-X 400', 'Kodak XTOL', '1+1', 400, 9, 'Kodak Tri-X data sheet (F-4017)', 'kodak'),
	{
		id: 'cs41-c41',
		name: 'Colour negative · CineStill Cs41 · 39 °C',
		process: 'c41',
		film: 'Any C-41 film',
		developer: 'CineStill Cs41',
		dilution: 'kit',
		ei: 0,
		devSeconds: 210,
		tempC: 39,
		agitation: 'gentle',
		steps: c41Steps(210),
		reusePct: 2,
		source: 'CineStill Cs41 leaflet: 3:30 at 102 °F, +2% per roll already processed',
		notes: 'The kit is rated for 24 rolls. Push +1: about +30% developer time (lab convention); check the leaflet’s push chart.',
	},
];

/* ---------- maths ---------- */

/**
 * Developer time at another temperature (black and white). Roughly 8% shorter
 * per degree warmer, the curve the makers' temperature charts follow between
 * 18 and 24 °C; outside that it's a guess, so it's clamped there.
 */
export function bwTimeAt(seconds: number, fromC: number, toC: number): number {
	const t = Math.min(24, Math.max(18, toC));
	return Math.round(seconds * Math.exp(-0.081 * (t - fromC)));
}

/** C-41 developer time with the kit's reuse compensation: +pct% per roll already through it. */
export const reusedTime = (seconds: number, rollsBefore: number, pct = 0) => Math.round(seconds * (1 + (pct / 100) * Math.max(0, rollsBefore)));

export interface PlanInput {
	spec: RecipeSpec;
	/** The developer's real temperature now. */
	tempC: number;
	/** Rolls already developed in this batch of chemistry (reusable kits). */
	rollsBefore?: number;
}

/** The steps to run, with the developer's time adjusted for temperature and reuse. */
export function planRun({ spec, tempC, rollsBefore = 0 }: PlanInput): { steps: Step[]; devSeconds: number; adjustments: string[] } {
	let dev = spec.devSeconds;
	const adjustments: string[] = [];
	if (spec.process === 'bw' && Math.abs(tempC - spec.tempC) >= 0.25) {
		dev = bwTimeAt(dev, spec.tempC, tempC);
		adjustments.push(`${tempC} °C instead of ${spec.tempC} °C${tempC < 18 || tempC > 24 ? ' (outside 18–24 °C: bring it closer)' : ''}`);
	}
	if (spec.reusePct && rollsBefore > 0) {
		dev = reusedTime(dev, rollsBefore, spec.reusePct);
		adjustments.push(`+${spec.reusePct}% × ${rollsBefore} ${rollsBefore === 1 ? 'roll' : 'rolls'} already through the developer`);
	}
	const steps = spec.steps.map((s) => (s.develop ? { ...s, seconds: dev } : s));
	return { steps, devSeconds: dev, adjustments };
}

/**
 * When to agitate during a step, as seconds from its start: [start, end)
 * windows. Stand development gets one burst at the halfway mark.
 */
export function agitationWindows(seconds: number, key: string | null | undefined): [number, number][] {
	const a = key ? AGITATION[key] : null;
	if (!a || (a.first === 0 && a.every === 0)) return [];
	const out: [number, number][] = [];
	if (a.first) out.push([0, Math.min(seconds, a.first)]);
	if (a.every) for (let t = a.every; t < seconds - 2; t += a.every) out.push([t, Math.min(seconds, t + a.burst)]);
	else if (a.key === 'stand' && seconds > 120) out.push([Math.round(seconds / 2), Math.round(seconds / 2) + a.burst]);
	return out;
}

/** "9:30", "45 s" */
export function clock(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	if (s < 60) return `${s} s`;
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Recipes that suit a roll: same process; ones naming its film first, closest EI next. */
export function recipesFor<R extends RecipeSpec>(recipes: R[], roll: { process: string; film: string; ei: number | null }): R[] {
	const proc = processOf(roll.process);
	const words = roll.film.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
	const filmScore = (r: R) => words.filter((w) => r.film.toLowerCase().includes(w)).length;
	return recipes
		.filter((r) => r.process === proc)
		.sort((a, b) => filmScore(b) - filmScore(a) || Math.abs(Math.log2((a.ei || 1) / (roll.ei || a.ei || 1))) - Math.abs(Math.log2((b.ei || 1) / (roll.ei || b.ei || 1))));
}

/** The stock's process ("B&W", "C-41") as a darkroom process. */
export const processOf = (p: string): Process => (/e-?6/i.test(p) ? 'e6' : /b&?w|black/i.test(p) ? 'bw' : 'c41');

/* ---------- what a run leaves on the roll ---------- */

export interface DevRun {
	recipe: string;
	process: Process;
	developer: string;
	dilution: string;
	ei: number | null;
	tempC: number;
	devSeconds: number;
	/** Rolls in the tank together. */
	tank: number;
	/** Chemistry batches used (chemistry table ids). */
	chemistry: string[];
	note?: string | null;
}

export function parseDevRun(text: string | null | undefined): DevRun | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text) as DevRun;
		return v && typeof v.devSeconds === 'number' ? v : null;
	} catch {
		return null;
	}
}

/** "Ilfotec DD-X 1+4 · 9:00 at 20 °C · EI 400" */
export const devRunLine = (r: DevRun) =>
	[`${r.developer}${r.dilution && r.dilution !== 'kit' ? ` ${r.dilution}` : ''}`, `${clock(r.devSeconds)} at ${r.tempC} °C`, r.ei ? `EI ${r.ei}` : null].filter(Boolean).join(' · ');

/* ---------- chemistry ---------- */

export const CHEM_KINDS: Record<string, string> = {
	developer: 'Developer',
	stop: 'Stop bath',
	fixer: 'Fixer',
	c41: 'C-41 kit',
	e6: 'E-6 kit',
	wetting: 'Wetting agent',
	other: 'Other',
};

export interface ChemistryView {
	id: string;
	name: string;
	kind: string;
	mixedOn: string;
	capacityRolls: number | null;
	rollsUsed: number;
	lifeDays: number | null;
	retiredOn: string | null;
	notes: string | null;
}

/** How a batch is holding up: rolls left, days left, and whether it's done. */
export function chemistryState(c: ChemistryView, today: string): { rollsLeft: number | null; daysLeft: number | null; spent: boolean; tone: 'ok' | 'low' | 'spent' } {
	const age = Math.round((Date.parse(today) - Date.parse(c.mixedOn)) / 864e5);
	const rollsLeft = c.capacityRolls != null ? c.capacityRolls - c.rollsUsed : null;
	const daysLeft = c.lifeDays != null ? c.lifeDays - age : null;
	const spent = !!c.retiredOn || (rollsLeft != null && rollsLeft <= 0) || (daysLeft != null && daysLeft < 0);
	const low = !spent && ((rollsLeft != null && rollsLeft <= 2) || (daysLeft != null && daysLeft <= 7));
	return { rollsLeft, daysLeft, spent, tone: spent ? 'spent' : low ? 'low' : 'ok' };
}
