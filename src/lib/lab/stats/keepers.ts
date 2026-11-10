/**
 * Keepers: the frames you rated four stars or more, as a share of what was
 * scanned, by whatever made them (camera, film, lab, lens, light) and by where
 * they fall on the roll. Rates come with a 95% Wilson interval, because a
 * camera with nine scans and five keepers hasn't proved anything yet.
 */

export interface ScanFact {
	roll: string;
	camera: string;
	stock: string;
	lab: string;
	/** 1-based position on the roll, and how many scans the roll has. */
	index: number;
	count: number;
	keeper: boolean;
	/** Optional: the logged frame's lens and scene light (EV at ISO 100). */
	lens?: string | null;
	ev?: number | null;
}

export interface Rate {
	key: string;
	label: string;
	n: number;
	k: number;
	rate: number;
	lo: number;
	hi: number;
}

/** 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
	if (!n) return [0, 0];
	const p = k / n;
	const d = 1 + (z * z) / n;
	const c = p + (z * z) / (2 * n);
	const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
	return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function rate(key: string, label: string, list: ScanFact[]): Rate {
	const k = list.filter((s) => s.keeper).length;
	const [lo, hi] = wilson(k, list.length);
	return { key, label, n: list.length, k, rate: list.length ? r3(k / list.length) : 0, lo: r3(lo), hi: r3(hi) };
}

/** Hit rate per group, groups with fewer than `min` scans left out, best first. */
export function hitRates(scans: ScanFact[], by: (s: ScanFact) => string | null | undefined, label: (key: string) => string = (k) => k, min = 12): Rate[] {
	const groups = new Map<string, ScanFact[]>();
	for (const s of scans) {
		const key = by(s);
		if (!key) continue;
		const g = groups.get(key);
		if (g) g.push(s);
		else groups.set(key, [s]);
	}
	return [...groups]
		.filter(([, list]) => list.length >= min)
		.map(([key, list]) => rate(key, label(key), list))
		.sort((a, b) => b.rate - a.rate || b.n - a.n);
}

/** Hit rate by position on the roll, in strips of six (frames 1–6, 7–12…). */
export function byPosition(scans: ScanFact[]): Rate[] {
	const out: Rate[] = [];
	for (let start = 1; start <= 36; start += 6) {
		const list = scans.filter((s) => s.index >= start && s.index < start + 6);
		if (list.length) out.push(rate(String(start), `${start}–${start + 5}`, list));
	}
	const tail = scans.filter((s) => s.index > 36);
	if (tail.length) out.push(rate('37', '37+', tail));
	return out;
}

/** Is a group's rate clearly apart from everyone else's (intervals don't overlap the overall rate)? */
export const standsOut = (r: Rate, overall: number) => r.lo > overall || r.hi < overall;
