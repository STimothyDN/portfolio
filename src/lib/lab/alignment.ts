/**
 * Which logged frame each lab scan shows. Labs name scans their own way and
 * often scan a frame 0 or 00 first, so a roll records the frame number of its
 * first scan, and any frame can be pinned to a specific scan to close a gap
 * (a blank frame the lab skipped, say). Shared by the roll page, the build
 * that feeds the public lightbox, and the tests.
 */
import { formatAperture } from './inventory';

export interface AlignableFrame {
	number: number;
	scanFilename?: string | null;
}

/** scan filename → the frame it shows (scans in desk order). */
export function alignScans<F extends AlignableFrame>(scans: string[], frames: F[], firstScanFrame: number): Map<string, F> {
	const pinned = new Map<string, F>();
	const free = new Map<number, F>();
	for (const f of frames) {
		if (f.scanFilename) pinned.set(f.scanFilename, f);
		else if (!free.has(f.number)) free.set(f.number, f);
	}
	const out = new Map<string, F>();
	scans.forEach((file, i) => {
		const f = pinned.get(file) ?? free.get(firstScanFrame + i);
		if (f) out.set(file, f);
	});
	return out;
}

/** What the public lightbox gets for one frame. Short keys: it ships with every shared scan. */
export interface PublicExposure {
	/** "f/8" */
	a?: string;
	/** "1/125" */
	s?: string;
	/** lens name */
	l?: string;
	/** focal length, "50mm" */
	fl?: string;
	/** rated ISO */
	i?: number;
	/** the roll's public place */
	pl?: string;
	/** the frame's note, when notes are shared */
	nt?: string;
}

export interface ShareSettings {
	shareExposure: boolean;
	sharePlace: string | null;
	shareNotes: boolean;
	ratedIso: number | null;
}

/** A frame as the public may see it, under the roll's sharing settings. Null when there's nothing to show. */
export function publicExposure(
	f: { aperture: number | null; shutter: string | null; focalLength: number | null; note: string | null },
	lensName: string | null,
	share: ShareSettings
): PublicExposure | null {
	const e: PublicExposure = {};
	if (share.shareExposure) {
		if (f.aperture != null) e.a = formatAperture(f.aperture)!;
		if (f.shutter) e.s = f.shutter;
		if (lensName) e.l = lensName;
		if (f.focalLength) e.fl = `${f.focalLength}mm`;
		if (share.ratedIso) e.i = share.ratedIso;
	}
	if (share.sharePlace?.trim()) e.pl = share.sharePlace.trim();
	if (share.shareNotes && f.note?.trim()) e.nt = f.note.trim();
	return Object.keys(e).length ? e : null;
}

/** One line for previews: "f/8 · 1/125 · MD Rokkor 50mm · Durham, NC". */
export const exposureLine = (e: PublicExposure | null) =>
	e ? [e.a, e.s, e.l ?? e.fl, e.i ? `ISO ${e.i}` : null, e.pl].filter(Boolean).join(' · ') : '';

/* ---------- suggesting the alignment ---------- */

/**
 * The frame number a lab printed into a scan's file name, when it did:
 * "…-R1-005-1.jpg" → 1, "…-00.jpg" → -1 (frame 00), "…_0.jpg" → 0,
 * "12A.jpg" → 12. Only a last token of one or two digits counts (a running
 * scan counter like IMG_0012 says nothing about the film's edge).
 */
export function edgeFromFilename(file: string): number | null {
	const base = file.replace(/\.[a-z0-9]+$/i, '');
	const m = base.match(/(?:^|[-_ .])(\d{1,2})A?$/i);
	if (!m) return null;
	return m[1] === '00' ? -1 : Number(m[1]);
}

export interface SuggestScan {
	file: string;
	/** [black point, median, white point] of the scan, 0–1, when measured. */
	tone?: [number, number, number] | null;
}

export interface SuggestFrame extends AlignableFrame {
	id?: string;
	aperture: number | null;
	shutter: string | null;
	flash: boolean;
}

export interface AlignmentSuggestion {
	firstScanFrame: number;
	/** Frames to pin to a scan, where the lab skipped one. */
	pins: { number: number; frameId?: string; file: string }[];
	basis: 'names' | 'light';
	/** Logged frames that land on a scan once it's applied. */
	matched: number;
	/** One sentence on why. */
	why: string;
}

const secondsOf = (s: string | null) => {
	if (!s || s === 'B') return null;
	if (s.endsWith('s')) return Number(s.slice(0, -1)) || null;
	const [n, d] = s.split('/').map(Number);
	return d ? n / d : n || null;
};

/** Spearman rank correlation of paired values. */
function spearman(xs: number[], ys: number[]): number {
	const rank = (v: number[]) => {
		const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
		const r = new Array<number>(v.length);
		for (let i = 0; i < order.length; ) {
			let j = i;
			while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
			for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
			i = j + 1;
		}
		return r;
	};
	const rx = rank(xs);
	const ry = rank(ys);
	const mean = (rx.length - 1) / 2;
	let num = 0;
	let dx = 0;
	let dy = 0;
	for (let i = 0; i < rx.length; i++) {
		num += (rx[i] - mean) * (ry[i] - mean);
		dx += (rx[i] - mean) ** 2;
		dy += (ry[i] - mean) ** 2;
	}
	return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * How the scans most likely line up with the logged frames, or null when
 * there's nothing better to say than what's set now.
 *
 * First, the file names: many labs print each frame's edge number into the
 * name (…-00, …-0, …-1), which settles the shift and shows any frame the lab
 * skipped. Otherwise, the light: each logged setting says how bright the
 * scene was, and a scan's median tone says how bright it came out; the shift
 * where those agree best wins, when it wins clearly.
 */
export function suggestAlignment(scans: SuggestScan[], frames: SuggestFrame[], current: number): AlignmentSuggestion | null {
	if (!scans.length || !frames.length) return null;
	const byNumber = new Map(frames.map((f) => [f.number, f]));
	const matchedWith = (first: number, pins: AlignmentSuggestion['pins']) => {
		const pinned = new Set(pins.map((p) => p.number));
		const pinFiles = new Set(pins.map((p) => p.file));
		let n = pins.filter((p) => byNumber.has(p.number)).length;
		scans.forEach((s, i) => {
			if (pinFiles.has(s.file)) return;
			const f = byNumber.get(first + i);
			if (f && !pinned.has(f.number)) n++;
		});
		return n;
	};

	// 1. File names.
	const edges = scans.map((s) => edgeFromFilename(s.file));
	const read = edges.filter((e): e is number => e != null);
	const increasing = read.every((e, i) => i === 0 || e > read[i - 1]);
	if (read.length >= Math.max(3, scans.length * 0.7) && increasing) {
		// The first scan's own number sets the shift (later skips become pins).
		const at = edges.findIndex((e) => e != null);
		const first = Math.max(-1, Math.min(10, edges[at]! - at));
		const pins: AlignmentSuggestion['pins'] = [];
		edges.forEach((e, i) => {
			if (e == null || e === first + i) return;
			const f = byNumber.get(e);
			if (f && f.scanFilename !== scans[i].file) pins.push({ number: e, frameId: f.id, file: scans[i].file });
		});
		const skipped: number[] = [];
		for (let k = 1; k < read.length; k++) for (let n = read[k - 1] + 1; n < read[k]; n++) skipped.push(n);
		const changes = first !== current || pins.length > 0;
		if (!changes) return null;
		const fmt = (n: number) => (n === -1 ? '00' : String(n));
		return {
			firstScanFrame: first,
			pins,
			basis: 'names',
			matched: matchedWith(first, pins),
			why:
				`The lab printed frame numbers into the file names: scan 1 is frame ${fmt(first)}` +
				(skipped.length ? `, and ${skipped.length === 1 ? `frame ${fmt(skipped[0])} wasn’t scanned` : `frames ${skipped.map(fmt).join(', ')} weren’t scanned`}.` : '.'),
		};
	}

	// 2. The light.
	const lit = frames
		.map((f) => {
			const t = secondsOf(f.shutter);
			return !f.flash && f.aperture && t ? { n: f.number, ev: Math.log2((f.aperture * f.aperture) / t) } : null;
		})
		.filter((x): x is { n: number; ev: number } => !!x);
	if (lit.length < 5 || scans.filter((s) => s.tone).length < 5) return null;
	const score = (first: number) => {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const f of lit) {
			const s = scans[f.n - first];
			if (s?.tone) {
				xs.push(f.ev);
				ys.push(s.tone[1]);
			}
		}
		return xs.length >= 5 ? { r: spearman(xs, ys), n: xs.length } : null;
	};
	const tried = [-1, 0, 1, 2, 3]
		.map((first) => ({ first, s: score(first) }))
		.filter((t): t is { first: number; s: { r: number; n: number } } => !!t.s)
		.sort((a, b) => b.s.r - a.s.r);
	const [best, next] = tried;
	if (!best || best.s.r < 0.45 || (next && best.s.r - next.s.r < 0.15) || best.first === current) return null;
	return {
		firstScanFrame: best.first,
		pins: [],
		basis: 'light',
		matched: matchedWith(best.first, []),
		why: `Matching each frame’s logged light to how bright its scan came out, scan 1 looks like frame ${best.first === -1 ? '00' : best.first} (agreement ${Math.round(best.s.r * 100)}% over ${best.s.n} frames).`,
	};
}
