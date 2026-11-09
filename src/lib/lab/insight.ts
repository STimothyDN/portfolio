/**
 * What the scans say about how the film was exposed. Pure arithmetic over
 * each scan's measured tone ([black point, log-average, white point], from
 * the uploader) and, where frames were logged, the light they were metered
 * in. Shared by the Frames page (server) and its island.
 *
 * The signal: a thin (underexposed) negative has little density in the
 * shadows, so the scanner stretches it into grey, raised blacks and a flat
 * scan. Film character and lab scanning raise blacks too, so cameras and
 * labs are only ever compared on the same film, and frames against the rest
 * of their own roll.
 */
import { median } from './almanac';

export type Tone = [black: number, key: number, white: number];

/** One scan on the public desk, with what made it. */
export interface DeskScan {
	roll: string;
	/** 'YYYY-MM-DD'. */
	developed: string;
	camera: string;
	stock: string;
	lab: string;
	tone: Tone;
}

/** A black point this high reads as a flat scan, about the top quarter of your scans. */
export const FLAT_BLACK = 0.15;

export interface ToneGroup {
	key: string;
	label: string;
	scans: number;
	rolls: number;
	medianBlack: number;
	/** Share of flat scans, 0–1. */
	flat: number;
	/**
	 * Mean black point minus the same film's median from everywhere else:
	 * positive is flatter than that film usually comes back. Null when no
	 * film it used was also used elsewhere.
	 */
	lift: number | null;
	/** Scans that the lift is measured over. */
	compared: number;
	/** [black, white] per scan, in the order they were developed, ×100. */
	bars: [number, number][];
	/** The camera or lab most of its scans share (a camera's lab, a lab's camera), when one dominates. */
	mostly: { key: string; share: number } | null;
}

export interface Finding {
	kind: 'camera' | 'stock' | 'lab' | 'light' | 'lens' | 'roll';
	tone: 'warn' | 'good' | 'info';
	title: string;
	text: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const t of list) {
		const k = key(t);
		const g = out.get(k);
		if (g) g.push(t);
		else out.set(k, [t]);
	}
	return out;
}

/**
 * Tone by camera, stock or lab. A camera's lift compares each of its scans
 * with the median of the same film shot in other cameras (and likewise for
 * labs), so a flat-scanning film doesn't count against the camera.
 */
export function toneGroups(scans: DeskScan[], by: 'camera' | 'stock' | 'lab', label: (key: string) => string): ToneGroup[] {
	const sorted = [...scans].sort((a, b) => a.developed.localeCompare(b.developed) || a.roll.localeCompare(b.roll));
	const groups = groupBy(sorted, (s) => s[by]);
	const out: ToneGroup[] = [];
	for (const [key, list] of groups) {
		let liftSum = 0;
		let compared = 0;
		if (by !== 'stock') {
			// The same film from everywhere else.
			const others = groupBy(
				scans.filter((s) => s[by] !== key),
				(s) => s.stock
			);
			const otherMedian = new Map([...others].map(([stock, l]) => [stock, median(l.map((s) => s.tone[0] * 100))! / 100]));
			for (const s of list) {
				const m = otherMedian.get(s.stock);
				if (m == null) continue;
				liftSum += s.tone[0] - m;
				compared++;
			}
		}
		const blacks = list.map((s) => s.tone[0]);
		const cross = by === 'lab' ? 'camera' : 'lab';
		const counts = [...groupBy(list, (s) => s[cross])].map(([k, l]) => ({ key: k, share: l.length / list.length })).sort((a, b) => b.share - a.share);
		out.push({
			key,
			label: label(key),
			scans: list.length,
			rolls: new Set(list.map((s) => s.roll)).size,
			medianBlack: round2(median(blacks.map((b) => b * 100))! / 100),
			flat: blacks.filter((b) => b >= FLAT_BLACK).length / list.length,
			lift: compared ? Math.round((liftSum / compared) * 1000) / 1000 : null,
			compared,
			bars: list.map((s) => [Math.round(s.tone[0] * 100), Math.round(s.tone[2] * 100)]),
			mostly: counts[0] && counts[0].share >= 0.9 ? counts[0] : null,
		});
	}
	return out.sort((a, b) => b.scans - a.scans);
}

/** The few things worth saying about the desk's scans as a whole. */
export function deskFindings(
	cameras: ToneGroup[],
	stocks: ToneGroup[],
	labs: ToneGroup[],
	names: { camera: (key: string) => string; lab: (key: string) => string }
): Finding[] {
	const out: Finding[] = [];
	const enough = (g: ToneGroup) => g.compared >= 20;
	// A camera whose rolls all went to one lab can't be told apart from that lab (and vice versa).
	const confound = (g: ToneGroup, kind: 'camera' | 'lab') =>
		g.mostly
			? kind === 'camera'
				? ` Every roll from it went to ${names.lab(g.mostly.key)}, so that lab’s scanning may be part of it.`
				: ` Nearly all of it came from the ${names.camera(g.mostly.key)}, so the camera may be part of it.`
			: '';
	const flatCams = cameras.filter((g) => enough(g) && g.lift! >= 0.025).sort((a, b) => b.lift! - a.lift!);
	for (const g of flatCams.slice(0, 2)) {
		out.push({
			kind: 'camera',
			tone: 'warn',
			title: `${g.label} comes back thin`,
			text: `On the same film, its scans’ black point sits ${g.lift!.toFixed(2)} higher than your other cameras’ (${pct(g.flat)} flat, over ${plural(g.rolls, 'roll')}). Its meter or flash probably underexposes: keep it for bright light, or use the flash in shade.${confound(g, 'camera')}`,
		});
	}
	const cleanest = cameras.filter((g) => enough(g) && g.lift! <= -0.02).sort((a, b) => a.lift! - b.lift!)[0];
	if (cleanest) {
		out.push({
			kind: 'camera',
			tone: 'good',
			title: `${cleanest.label} makes your densest negatives`,
			text: `On the same film its scans’ black point sits ${(-cleanest.lift!).toFixed(2)} lower than your other cameras’: cleaner shadows, denser negatives (${pct(cleanest.flat)} flat).${confound(cleanest, 'camera')}`,
		});
	}
	const allBlack = median(stocks.flatMap((g) => g.bars.map((b) => b[0])));
	if (allBlack != null) {
		const flatStocks = stocks.filter((g) => g.scans >= 20 && g.medianBlack * 100 >= allBlack + 5).sort((a, b) => b.medianBlack - a.medianBlack);
		for (const g of flatStocks.slice(0, 2)) {
			out.push({
				kind: 'stock',
				tone: 'info',
				title: `${g.label} scans flat`,
				text: `Median black point ${g.medianBlack.toFixed(2)} against ${(allBlack / 100).toFixed(2)} for your film overall, ${pct(g.flat)} of ${plural(g.scans, 'scan')}. That’s often the film’s own character; rating it a stop slower gives denser negatives.`,
			});
		}
	}
	const labDiff = labs.filter((g) => enough(g) && Math.abs(g.lift!) >= 0.02).sort((a, b) => Math.abs(b.lift!) - Math.abs(a.lift!))[0];
	if (labDiff) {
		out.push({
			kind: 'lab',
			tone: 'info',
			title: `${labDiff.label} scans ${labDiff.lift! > 0 ? 'flatter' : 'punchier'}`,
			text: `On the same film, its scans’ black point sits ${Math.abs(labDiff.lift!).toFixed(2)} ${labDiff.lift! > 0 ? 'higher' : 'lower'} than your other labs’. Worth knowing before blaming the film.${confound(labDiff, 'lab')}`,
		});
	}
	return out;
}

/* ---------- frames you logged, against their scans ---------- */

export interface ReviewFrame {
	id: string;
	code: string;
	number: number;
	camera: string | null;
	lens: string | null;
	/** The light it was exposed for, EV at ISO 100 (null for flash or unknown settings). */
	ev: number | null;
	tone: Tone;
	/** Median black point of the rest of its roll. */
	rollBlack: number;
}

export const LIGHT_BUCKETS = [
	{ key: 'bright', label: 'bright light', min: 13 },
	{ key: 'shade', label: 'shade and overcast', min: 10 },
	{ key: 'dim', label: 'dim light', min: 7 },
	{ key: 'night', label: 'night light', min: -Infinity },
] as const;
export const bucketOf = (ev: number) => LIGHT_BUCKETS.find((b) => ev >= b.min)!;

/** Thin against the rest of its own roll (so a flat-scanning film doesn't count). */
export const isThin = (f: Pick<ReviewFrame, 'tone' | 'rollBlack'>) => f.tone[0] >= 0.12 && f.tone[0] - f.rollBlack >= 0.06;

/** Where thin frames cluster: by light, lens and camera. */
export function frameFindings(frames: ReviewFrame[]): Finding[] {
	const out: Finding[] = [];
	const metered = frames.filter((f) => f.ev != null);
	const compare = (kind: Finding['kind'], groups: Map<string, ReviewFrame[]>, words: (key: string) => string, advice: string) => {
		for (const [key, list] of groups) {
			const rest = frames.filter((f) => !list.includes(f));
			const thin = list.filter(isThin).length;
			const restThin = rest.filter(isThin).length;
			if (list.length < 4 || thin < 2 || rest.length < 4) continue;
			if (thin / list.length < 2 * Math.max(restThin / rest.length, 0.05)) continue;
			out.push({
				kind,
				tone: 'warn',
				title: `Thin in ${words(key)}`,
				text: `${thin} of ${list.length} frames you logged in ${words(key)} came back thin, against ${restThin} of ${rest.length} otherwise. ${advice}`,
			});
		}
	};
	compare('light', groupBy(metered, (f) => bucketOf(f.ev!).label), (k) => k, 'Give those a stop more than the meter or the rule says.');
	compare('lens', groupBy(frames.filter((f) => f.lens), (f) => f.lens!), (k) => `the ${k}`, 'Check its aperture blades, or how you meter with it.');
	compare('camera', groupBy(frames.filter((f) => f.camera), (f) => f.camera!), (k) => `the ${k}`, 'Its meter may read high: try rating film a third to a half stop slower.');
	return out;
}
