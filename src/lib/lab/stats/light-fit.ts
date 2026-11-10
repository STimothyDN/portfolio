/**
 * Film for the light: the light you actually shoot in (from the aperture and
 * shutter you logged, as EV at ISO 100) against what each film speed can
 * handle hand-held. A frame below the window needed a slower shutter than you
 * can hold (or a wider lens than you have); above it, more than f/16 at
 * 1/1000. Where most of your frames sit says which speed to load.
 */
import { ISO_STOPS } from '../almanac';

/** What a camera can do hand-held: widest aperture, slowest safe shutter, and the far end. */
export interface Limits {
	widest: number;
	slowest: number;
	narrowest: number;
	fastest: number;
}

export const HANDHELD: Limits = { widest: 2, slowest: 1 / 30, narrowest: 16, fastest: 1 / 1000 };

const log2 = Math.log2;

/** The scene light (EV at ISO 100) a film speed can expose correctly within the limits. */
export function windowFor(iso: number, l: Limits = HANDHELD): [number, number] {
	const shift = log2(iso / 100);
	return [log2((l.widest * l.widest) / l.slowest) - shift, log2((l.narrowest * l.narrowest) / l.fastest) - shift];
}

export interface LightFrame {
	/** Scene light, EV at ISO 100. */
	ev: number;
	/** The speed the roll was rated at. */
	iso: number;
}

export interface SpeedFit {
	iso: number;
	n: number;
	/** Frames per whole EV, from `lo` to `hi`. */
	bins: { ev: number; n: number }[];
	window: [number, number];
	/** Share of frames darker than the window (needed more light), and brighter. */
	under: number;
	over: number;
	median: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function speedFits(frames: LightFrame[], limits: Limits = HANDHELD): SpeedFit[] {
	const bySpeed = new Map<number, number[]>();
	for (const f of frames) {
		const iso = ISO_STOPS.reduce((b, s) => (Math.abs(log2(s / f.iso)) < Math.abs(log2(b / f.iso)) ? s : b), ISO_STOPS[0]);
		const list = bySpeed.get(iso);
		if (list) list.push(f.ev);
		else bySpeed.set(iso, [f.ev]);
	}
	return [...bySpeed]
		.sort((a, b) => a[0] - b[0])
		.map(([iso, evs]) => {
			const w = windowFor(iso, limits);
			const sorted = [...evs].sort((a, b) => a - b);
			const counts = new Map<number, number>();
			for (const ev of evs) counts.set(Math.round(ev), (counts.get(Math.round(ev)) ?? 0) + 1);
			return {
				iso,
				n: evs.length,
				bins: [...counts].sort((a, b) => a[0] - b[0]).map(([ev, n]) => ({ ev, n })),
				window: [r2(w[0]), r2(w[1])] as [number, number],
				under: r2(evs.filter((e) => e < w[0]).length / evs.length),
				over: r2(evs.filter((e) => e > w[1]).length / evs.length),
				median: sorted[sorted.length >> 1],
			};
		});
}

/**
 * The speed that would have put the most of your frames inside the window,
 * from the stops you could buy. Null with too few frames to say.
 */
export function bestSpeed(frames: { ev: number }[], limits: Limits = HANDHELD): { iso: number; inside: number } | null {
	if (frames.length < 12) return null;
	let best: { iso: number; inside: number } | null = null;
	for (const iso of [100, 200, 400, 800, 1600, 3200]) {
		const [lo, hi] = windowFor(iso, limits);
		const inside = frames.filter((f) => f.ev >= lo && f.ev <= hi).length / frames.length;
		// Prefer the slower film when it's as good (finer grain).
		if (!best || inside > best.inside + 0.02) best = { iso, inside: r2(inside) };
	}
	return best;
}
