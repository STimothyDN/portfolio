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

/** The least desk the pile gets, in print areas — about what a big monitor shows. */
const DESK_PRINTS = 50;
/** Where smaller screens start: a little zoomed out, so the pile's edges are in sight. */
const HOME_ZOOM = 0.85;

export interface DeskWorld extends Size {
	/** Long edge of a print, in desk px. */
	long: number;
	/** Zooms (screen px per desk px): the whole desk, where the view starts, and closest in. */
	fit: number;
	home: number;
	max: number;
}

/**
 * The pile's desk, for a screen whose free band (between the floating chrome)
 * is `band`. Prints keep the size they'd have on this screen, but the desk
 * never holds fewer than DESK_PRINTS of them: on a big monitor that's simply
 * the screen, while on a laptop or phone the desk runs off the edges and the
 * view zooms and pans over it. Same proportions as the band, so zooming all
 * the way out fills it.
 */
export function deskWorld(band: Size): DeskWorld {
	const long = printLongFor(band.w, band.h);
	const need = DESK_PRINTS * long * long * 0.667;
	const s = Math.max(1, Math.sqrt(need / (band.w * band.h)));
	const fit = 1 / s;
	const home = Math.max(fit, s > 1 ? HOME_ZOOM : 1);
	// Close enough that a print nearly fills the short side of the screen.
	const max = clamp((0.9 * Math.min(band.w, band.h)) / long, home * 1.5, 2.5);
	return { w: band.w * s, h: band.h * s, long, fit, home, max };
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

/** One cut strip of negatives: frames on a band of film base. */
export interface NegativeStrip {
	key: string;
	/** The roll this strip was cut from. */
	run: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Each frame window's photo index and top-left corner, relative to the strip. */
	frames: { idx: number; x: number; y: number }[];
	/** The roll's last strip: it runs out into a blank leader and cut tongue. */
	tail: boolean;
}

export interface StripLayout {
	/** Strips run down the page (narrow screens) instead of across it. */
	vertical: boolean;
	/** Frame-window centers by photo index. */
	centers: Map<number, { x: number; y: number }>;
	/** A 35mm frame window (3:2): landscape across the page, portrait down it. */
	frame: Size;
	/** Thickness of each sprocket rail along the strip's edges. */
	rail: number;
	strips: NegativeStrip[];
	/** A canister at the head of each roll, its film spooling out into the first
	 * strip: center point and standing height (it lies down on vertical layouts). */
	canisters: { key: string; run: string; x: number; y: number; h: number }[];
	/** The lab's sticker on each roll's leader, where the title is written. */
	stickers: { key: string; run: string; x: number; y: number; w: number; h: number }[];
	/** One subtle heading per group, when the grouping isn't by roll. */
	heads: { key: string; x: number; y: number; w: number }[];
	/** Length of the cut tongue at the very end of a leader. */
	tongue: number;
	height: number;
}

interface StripOpts {
	top: number;
	bottom: number;
	maxContent: number;
	/** The roll each frame belongs to — a strip never mixes rolls. */
	runOf: (idx: number) => string;
	/** Give each group a heading (off when grouping by roll: stickers name those). */
	headings: boolean;
}

/** Group items into runs of consecutive frames from one roll. */
function runsOf(items: number[], runOf: (idx: number) => string) {
	const runs: { key: string; items: number[] }[] = [];
	for (const idx of items) {
		const run = runOf(idx);
		if (runs.at(-1)?.key === run) runs.at(-1)!.items.push(idx);
		else runs.push({ key: run, items: [idx] });
	}
	return runs;
}

/**
 * Cut a roll's frames into strips of at most `cap` frames — fewer on the
 * strip that also carries the leader (`capTail`). One frame is held back
 * when needed so the leader never ends up on a strip of its own unless the
 * leader can't share a strip at all.
 */
function cutRoll(count: number, cap: (head: boolean) => number, capTail: (head: boolean) => number) {
	const pieces: { from: number; to: number; tail: boolean }[] = [];
	let i = 0;
	while (i < count) {
		const head = pieces.length === 0;
		const open = Math.max(1, cap(head));
		const withLeader = capTail(head);
		const left = count - i;
		let take: number;
		let tail = false;
		if (withLeader >= 1 && left <= withLeader) {
			take = left;
			tail = true;
		} else if (withLeader >= 1 && left <= open) {
			take = left - 1;
		} else {
			take = Math.min(left, open);
		}
		pieces.push({ from: i, to: i + take, tail });
		i += take;
	}
	if (!pieces.at(-1)?.tail) pieces.push({ from: count, to: count, tail: true });
	return pieces;
}

const LINE = 0.06; // frame line, as a fraction of frame width (horizontal strips)
const END = 0.12; // blank film at each cut end

/**
 * The organized view: each roll laid out as cut strips of 35mm negatives, all
 * evenly spaced. A roll's first strip spools out of its canister (which hangs
 * out into the margin rather than taking room from the frames); its last runs
 * on into a blank leader, where the lab's sticker carries the roll's name,
 * and ends in the cut tongue. A strip never holds two rolls.
 *
 * Wide screens lay strips across the page; narrow screens cut each roll in
 * half and stand the two long strips side by side. Either way the frames sit
 * as they were developed: along the film, so a shot taken the other way round
 * lies sideways in its frame.
 */
export function layoutStrips(groups: GridGroupInput[], width: number, opts: StripOpts): StripLayout {
	return width < 640 ? layoutColumns(groups, width, opts) : layoutRows(groups, width, opts);
}

function layoutRows(groups: GridGroupInput[], width: number, opts: StripOpts): StripLayout {
	const target = 188;
	const CAN = 1.2; // canister height, relative to the strip's
	const base = Math.max(24, (width - opts.maxContent) / 2);

	// Widen the side margins until the canister fits in the left one. (Each
	// pass sizes the frames for the current margins; stop as soon as they're
	// wide enough, so frames and margins always agree.)
	let pad = base;
	let inner = 0;
	let cols = 0;
	let fw = 0;
	for (let k = 0; k < 4; k++) {
		inner = width - pad * 2;
		cols = Math.max(2, Math.floor((inner / target - 2 * END + LINE) / (1 + LINE)));
		fw = inner / (cols + LINE * (cols - 1) + 2 * END);
		const need = fw * 0.96 * CAN * 0.43 - fw * END * 0.5 + 10;
		if (need <= pad + 0.5) break;
		pad = need;
	}
	const fh = fw / 1.5;
	const rail = fh * 0.22;
	const stripH = fh + rail * 2;
	const pitch = fw * (1 + LINE);
	const end = fw * END;
	const canH = stripH * CAN;
	const canW = canH * 0.43;
	const tongue = stripH * 0.42;
	const leader = fw * 1.9;
	const rowGap = 18;
	const groupGap = 40;
	const headH = 46;

	const fits = (room: number) => Math.max(0, Math.floor((room + fw * LINE) / pitch + 1e-6));
	const cap = () => fits(inner - end * 2);
	const capTail = () => fits(inner - end * 2 - leader);

	const centers = new Map<number, { x: number; y: number }>();
	const strips: NegativeStrip[] = [];
	const canisters: StripLayout['canisters'] = [];
	const stickers: StripLayout['stickers'] = [];
	const heads: StripLayout['heads'] = [];
	let y = opts.top;
	let first = true;

	groups.forEach((group) => {
		if (!first) y += groupGap;
		if (opts.headings) {
			heads.push({ key: group.key, x: pad, y, w: inner });
			y += headH;
		} else if (!first) {
			y -= groupGap - rowGap;
		}
		first = false;

		runsOf(group.items, opts.runOf).forEach((run, ri) => {
			if (ri > 0) y += rowGap;
			const pieces = cutRoll(run.items.length, cap, capTail);
			pieces.forEach((piece, r) => {
				if (r > 0) y += rowGap;
				const items = run.items.slice(piece.from, piece.to);
				const frames = items.map((idx, c) => ({ idx, x: end + c * pitch, y: rail }));
				for (const f of frames) centers.set(f.idx, { x: pad + f.x + fw / 2, y: y + rail + fh / 2 });
				const framesEnd = end + (items.length ? items.length * pitch - fw * LINE : 0);
				const w = piece.tail ? framesEnd + (items.length ? end : 0) + leader : framesEnd + end;
				if (r === 0) {
					// Standing in the margin, its lip at the strip's cut end.
					canisters.push({ key: `${run.key}@can`, run: run.key, x: pad + end * 0.5 - canW / 2, y: y + stripH / 2, h: canH });
				}
				if (piece.tail) {
					const zoneX = framesEnd + (items.length ? end : 0);
					const zone = w - tongue * 0.55 - zoneX;
					const sw = Math.min(zone * 0.9, fw * 1.5);
					const sh = Math.min(fh * 0.7, sw * 0.62);
					stickers.push({ key: `${run.key}@tag`, run: run.key, x: pad + zoneX + (zone - sw) / 2, y: y + (stripH - sh) / 2, w: sw, h: sh });
				}
				strips.push({ key: `${run.key}#${r}`, run: run.key, x: pad, y, w, h: stripH, frames, tail: piece.tail });
				y += stripH;
			});
		});
	});

	return {
		vertical: false,
		centers,
		frame: { w: fw, h: fh },
		rail,
		strips,
		canisters,
		stickers,
		heads,
		tongue,
		height: y + opts.bottom,
	};
}

function layoutColumns(groups: GridGroupInput[], width: number, opts: StripOpts): StripLayout {
	const pad = 14;
	const colGap = 14;
	const inner = width - pad * 2;
	const stripW = (inner - colGap) / 2;
	// True 35mm across the film: 35mm wide, 24mm of image, 5.5mm rails. Running
	// down the page, each 36mm frame is portrait-shaped, like a real strip.
	const rail = stripW * (5.5 / 35);
	const fw = stripW - rail * 2;
	const fh = fw * 1.5;
	const gap = fw * (2 / 24); // frame line
	const pitch = fh + gap;
	const end = fw * 0.16;
	// Lying across the head of the roll's first strip, a little wider than the film.
	const canH = stripW * 1.06;
	const canThick = canH * 0.43;
	const headStart = canThick * 0.82;
	const tongue = stripW * 0.4;
	const leader = fw * 1.25;
	const rowGap = 14;
	const groupGap = 32;
	const headH = 40;

	const centers = new Map<number, { x: number; y: number }>();
	const strips: NegativeStrip[] = [];
	const canisters: StripLayout['canisters'] = [];
	const stickers: StripLayout['stickers'] = [];
	const heads: StripLayout['heads'] = [];
	let y = opts.top;
	let first = true;

	groups.forEach((group) => {
		if (!first) y += groupGap;
		if (opts.headings) {
			heads.push({ key: group.key, x: pad, y, w: inner });
			y += headH;
		} else if (!first) {
			y -= groupGap - rowGap;
		}
		first = false;

		runsOf(group.items, opts.runOf).forEach((run, ri) => {
			if (ri > 0) y += rowGap;
			// Each roll is cut in half: two long strips side by side. The left
			// spools out of the canister; the right runs on into the leader.
			const half = Math.ceil(run.items.length / 2);
			const halves = [run.items.slice(0, half), run.items.slice(half)];
			let tallest = 0;
			halves.forEach((items, col) => {
				const head = col === 0;
				const tail = col === 1;
				const x = pad + col * (stripW + colGap);
				const s0 = head ? headStart : end;
				const frames = items.map((idx, c) => ({ idx, x: rail, y: s0 + c * pitch }));
				for (const f of frames) centers.set(f.idx, { x: x + rail + fw / 2, y: y + f.y + fh / 2 });
				const framesEnd = s0 + (items.length ? items.length * pitch - gap : 0);
				const h = tail ? framesEnd + (items.length ? end : 0) + leader : framesEnd + end;
				if (head) {
					// Lying across the strip's head, lip down, overhanging its sides.
					canisters.push({ key: `${run.key}@can`, run: run.key, x: x + stripW / 2, y: y + canThick / 2 - 6, h: canH });
				}
				if (tail) {
					const zoneY = framesEnd + (items.length ? end : 0);
					const zone = h - tongue * 0.55 - zoneY;
					const sw = fw * 0.96;
					const sh = Math.min(zone * 0.88, sw * 0.62);
					stickers.push({ key: `${run.key}@tag`, run: run.key, x: x + (stripW - sw) / 2, y: y + zoneY + (zone - sh) / 2, w: sw, h: sh });
				}
				strips.push({ key: `${run.key}#${col}`, run: run.key, x, y, w: stripW, h, frames, tail });
				tallest = Math.max(tallest, h);
			});
			y += tallest;
		});
	});

	return {
		vertical: true,
		centers,
		frame: { w: fw, h: fh },
		rail,
		strips,
		canisters,
		stickers,
		heads,
		tongue,
		height: y + opts.bottom,
	};
}
