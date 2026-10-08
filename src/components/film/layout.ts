/**
 * Pure layout math for the film desk: which prints make the pile, how they
 * stack, where they land, and how they file into a grid. No DOM in here —
 * FilmDesk.vue turns these numbers into tweens.
 */

export type Rand = () => number;

/** Small seeded PRNG so a pile can be re-created exactly (mulberry32). */
export function mulberry32(seed: number): Rand {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rand: Rand): number {
	let u = 0;
	while (u === 0) u = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How strongly priority pulls a print into the pile: each step triples the odds. */
export const priorityWeight = (priority: number) => 3 ** (clamp(priority, 1, 5) - 1);

/**
 * Weighted sample without replacement (Efraimidis–Spirakis): favorites are
 * almost always picked, filler only sometimes — so big archives still make a
 * pile of a sensible size, with the buried frames simply left in the box.
 */
export function weightedSample<T>(items: T[], weight: (item: T) => number, k: number, rand: Rand): T[] {
	if (items.length <= k) return [...items];
	return items
		.map((item) => ({ item, key: rand() ** (1 / weight(item)) }))
		.sort((a, b) => b.key - a.key)
		.slice(0, k)
		.map((entry) => entry.item);
}

/**
 * Bottom → top stacking order. Priority dominates, but the jitter lets
 * neighbouring priorities interleave, so a 4 sometimes lands on a 5 —
 * "a higher chance" of being on top, never a strict sort.
 */
export function stackOrder<T>(items: T[], priority: (item: T) => number, rand: Rand): T[] {
	return items
		.map((item) => ({ item, key: priority(item) + rand() * 1.6 }))
		.sort((a, b) => a.key - b.key)
		.map((entry) => entry.item);
}

export interface Size {
	w: number;
	h: number;
}

/** Print box for a scan: the long edge is fixed (a 4×6 print), the short edge follows the scan. */
export function printSize(aspect: number, long: number): Size {
	return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}

/** Long edge of a print for a desk of this size. */
export function printLongFor(deskW: number, areaH: number): number {
	const fit = deskW < 640 ? deskW * 0.4 : Math.min(deskW * 0.18, areaH * 0.42);
	return Math.round(clamp(fit, 118, 250));
}

/** How many prints the pile holds: enough to cover the desk about twice. */
export function pileCapacity(area: Size, long: number): number {
	const printArea = long * long * 0.667;
	return Math.round(clamp(((area.w * area.h) / printArea) * 1.8, 14, 64));
}

export interface PileSlot {
	/** Center, normalized to the pile area (0–1), so it survives resizes. */
	u: number;
	v: number;
	/** Rotation, degrees. */
	r: number;
}

function overlapArea(ax: number, ay: number, a: Size, b: { x: number; y: number; w: number; h: number }) {
	const ox = Math.min(ax + a.w / 2, b.x + b.w / 2) - Math.max(ax - a.w / 2, b.x - b.w / 2);
	const oy = Math.min(ay + a.h / 2, b.y + b.h / 2) - Math.max(ay - a.h / 2, b.y - b.h / 2);
	return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * Where each print lands, given sizes in bottom → top order.
 *
 * Everything scatters around the desk's center (a Gaussian, so the middle is
 * dense and the edges thin out like a real pile). The top layer — the frames
 * people can actually see and pick — is placed best-candidate: each tries a
 * dozen spots and keeps the one least covered by the prints already above it,
 * so the favorites fan out instead of hiding under each other.
 */
export function layoutPile(sizes: Size[], area: Size, rand: Rand): PileSlot[] {
	const n = sizes.length;
	const slots: PileSlot[] = new Array(n);
	const topCount = Math.max(4, Math.round(n * 0.4));
	const above: { x: number; y: number; w: number; h: number }[] = [];
	const cx = area.w / 2;
	const cy = area.h / 2;

	for (let i = n - 1; i >= 0; i--) {
		const size = sizes[i];
		const isTop = i >= n - topCount;
		const sx = area.w * (isTop ? 0.2 : 0.16);
		const sy = area.h * (isTop ? 0.22 : 0.18);

		// Mostly gentle angles, with the odd print skidding in crooked.
		const wild = rand() < 0.18;
		const r = clamp(gaussian(rand) * (wild ? 24 : 9), -40, 40);

		// Keep every print — rotated corners included — on the desk.
		const rad = (r * Math.PI) / 180;
		const cos = Math.abs(Math.cos(rad));
		const sin = Math.abs(Math.sin(rad));
		const mx = Math.min((size.w * cos + size.h * sin) / 2 + 6, cx);
		const my = Math.min((size.w * sin + size.h * cos) / 2 + 6, cy);
		const sample = () => ({
			x: clamp(cx + gaussian(rand) * sx, mx, area.w - mx),
			y: clamp(cy + gaussian(rand) * sy, my, area.h - my),
		});

		let best = sample();
		if (isTop) {
			let bestScore = Infinity;
			for (let c = 0; c < 12; c++) {
				const cand = c === 0 ? best : sample();
				let covered = 0;
				for (const box of above) covered += overlapArea(cand.x, cand.y, size, box);
				const dx = (cand.x - cx) / cx;
				const dy = (cand.y - cy) / cy;
				const score = covered / (size.w * size.h) + 0.3 * (dx * dx + dy * dy);
				if (score < bestScore) {
					bestScore = score;
					best = cand;
				}
			}
			above.push({ ...best, ...size });
		}

		slots[i] = { u: best.x / area.w, v: best.y / area.h, r };
	}
	return slots;
}

export interface GridGroupInput {
	key: string;
	items: number[];
}

export interface GridLayout {
	/** Print centers by photo index. */
	centers: Map<number, { x: number; y: number }>;
	/** Box each print is fitted into. */
	cell: Size;
	heads: { key: string; y: number }[];
	height: number;
	pad: number;
}

/**
 * Contact-sheet grid: one labeled block per group, prints centered in uniform
 * cells (rows shorter than columns — most scans are landscape 3:2).
 */
export function layoutGrid(
	groups: GridGroupInput[],
	width: number,
	opts: { top: number; bottom: number; maxContent: number }
): GridLayout {
	const narrow = width < 640;
	const pad = Math.max(narrow ? 16 : 24, (width - opts.maxContent) / 2);
	const inner = width - pad * 2;
	const gap = narrow ? 10 : 18;
	const target = narrow ? 150 : 176;
	const cols = Math.max(2, Math.floor((inner + gap) / (target + gap)));
	const cellW = (inner - gap * (cols - 1)) / cols;
	const cellH = cellW * 0.72;
	const headH = narrow ? 64 : 76;
	const groupGap = narrow ? 36 : 52;

	const centers = new Map<number, { x: number; y: number }>();
	const heads: { key: string; y: number }[] = [];
	let y = opts.top;
	groups.forEach((group, g) => {
		if (g > 0) y += groupGap;
		heads.push({ key: group.key, y });
		y += headH;
		group.items.forEach((idx, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			centers.set(idx, {
				x: pad + col * (cellW + gap) + cellW / 2,
				y: y + row * (cellH + gap) + cellH / 2,
			});
		});
		const rows = Math.ceil(group.items.length / cols);
		y += rows * cellH + Math.max(0, rows - 1) * gap;
	});

	return { centers, cell: { w: cellW, h: cellH }, heads, height: y + opts.bottom, pad };
}
