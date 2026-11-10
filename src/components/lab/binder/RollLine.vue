<script setup lang="ts">
/**
 * The line: every roll as a ribbon in its film's colour, on one time axis,
 * running through lanes the way the film went: along its camera's lane while
 * it was loaded, down into "waiting" once shot, "at a lab", "scans in", and a
 * dot where it was filed. Gaps in a camera's lane are days it sat empty; a
 * thick bundle in "waiting" is a backlog. Hover a ribbon to trace one roll,
 * click to open it, drag across the chart to pick a stretch of time (the
 * sheets below follow).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { Milestones } from '../../../lib/lab/almanac';
import { formatDay, STATUS_LABEL, type RollView, type Stage } from '../../../lib/lab/inventory';
import { addDaysIso, LEGS, segments, type LegKey, type Spread } from '../../../lib/lab/stats/pipeline';
import { canisterColors } from '../../film/canister';

const props = defineProps<{ rolls: RollView[]; milestones: Milestones; today: string; legs: Record<LegKey, Spread | null>; window: [string, string] | null }>();
const emit = defineEmits<{ window: [w: [string, string] | null] }>();

const LABEL = 128;
const RIGHT = 28;
const TRACK = 6;
const PAD = 7;
const AXIS = 30;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
const isoOf = (n: number) => new Date(Math.round(n) * 864e5).toISOString().slice(0, 10);

const host = ref<HTMLElement | null>(null);
const width = ref(1100);

/* ---------- paths through the stages ---------- */

type Seg = { stage: Stage; from: string; to: string };
const paths = computed(() =>
	props.rolls
		.filter((r) => r.status !== 'storage')
		.map((r) => ({
			roll: r,
			// A stage that began and ended the same day before the next (imported rolls: scanned and filed at once) isn't drawn.
			segs: segments(r, props.milestones, props.today).filter((s, i, all) => s.stage !== 'storage' && !(s.from === s.to && s.stage !== 'negatives' && i < all.length - 1)) as Seg[],
		}))
		.filter((p) => p.segs.length)
);

const start = computed(() => {
	const first = paths.value.reduce((m, p) => (p.segs[0].from < m ? p.segs[0].from : m), props.today);
	// At least four months on screen, and a little room before the first roll.
	const fourMonths = addDaysIso(props.today, -120);
	return addDaysIso(first < fourMonths ? first : fourMonths, -6);
});
const end = computed(() => addDaysIso(props.today, 4));
const span = computed(() => Math.max(1, dayNo(end.value) - dayNo(start.value)));
/** Wide enough to read: a pixel and a bit per day at least (the chart scrolls sideways beyond that). */
const inner = computed(() => Math.max(width.value - LABEL - RIGHT, span.value * 1.6));
const svgW = computed(() => LABEL + inner.value + RIGHT);
const x = (d: string) => r2(LABEL + ((dayNo(d) - dayNo(start.value)) / span.value) * inner.value);

/* ---------- lanes, with tracks for rolls that overlap ---------- */

interface Lane {
	key: string;
	label: string;
	kind: 'camera' | Stage;
	tracks: number;
	top: number;
	height: number;
}

const layout = computed(() => {
	// Cameras that have held a roll, most recently used first.
	const camLast = new Map<string, { name: string; last: string }>();
	for (const p of paths.value) {
		for (const s of p.segs) {
			if (s.stage !== 'camera') continue;
			const id = p.roll.camera?.id ?? 'none';
			const was = camLast.get(id);
			if (!was || s.to > was.last) camLast.set(id, { name: p.roll.camera?.name ?? 'Camera not recorded', last: s.to });
		}
	}
	const laneKeys: { key: string; label: string; kind: Lane['kind'] }[] = [
		...[...camLast.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([id, c]) => ({ key: `cam:${id}`, label: c.name, kind: 'camera' as const })),
		{ key: 'shot', label: 'Waiting to send', kind: 'shot' },
		{ key: 'lab', label: 'At a lab', kind: 'lab' },
		{ key: 'scanned', label: 'Scans in', kind: 'scanned' },
		{ key: 'negatives', label: 'Filed', kind: 'negatives' },
	];
	const laneOf = (rollCam: string | undefined, s: Seg) => (s.stage === 'camera' ? `cam:${rollCam ?? 'none'}` : s.stage);
	// Interval partitioning per lane: each segment takes the lowest track that's free by its start.
	const ends = new Map<string, number[]>();
	const trackOf = new Map<string, number>();
	const items = paths.value.flatMap((p) => p.segs.map((s, i) => ({ id: `${p.roll.id}:${i}`, lane: laneOf(p.roll.camera?.id, s), a: dayNo(s.from), b: s.stage === 'negatives' ? dayNo(s.from) + 3 : Math.max(dayNo(s.to), dayNo(s.from) + 1) })));
	items.sort((m, n) => m.a - n.a || m.b - n.b);
	for (const it of items) {
		const list = ends.get(it.lane) ?? [];
		let t = list.findIndex((e) => e < it.a);
		if (t === -1) {
			t = list.length;
			list.push(it.b);
		} else list[t] = it.b;
		ends.set(it.lane, list);
		trackOf.set(it.id, t);
	}
	let top = AXIS;
	const lanes: Lane[] = laneKeys.map((l) => {
		const tracks = Math.max(1, Math.min(ends.get(l.key)?.length ?? 1, 14));
		const height = PAD * 2 + tracks * TRACK;
		const lane = { ...l, tracks, top, height };
		top += height;
		return lane;
	});
	const byKey = new Map(lanes.map((l) => [l.key, l]));
	const yOf = (lane: string, track: number) => {
		const l = byKey.get(lane)!;
		return r2(l.top + PAD + (Math.min(track, l.tracks - 1) + 0.5) * TRACK);
	};
	const ribbons = paths.value.map((p) => {
		const pts = p.segs.map((s, i) => ({ s, y: yOf(laneOf(p.roll.camera?.id, s), trackOf.get(`${p.roll.id}:${i}`) ?? 0), x1: x(s.from), x2: x(s.to) }));
		let d = '';
		pts.forEach((pt, i) => {
			if (pt.s.stage === 'negatives') return;
			if (!d) d = `M${pt.x1} ${pt.y}`;
			const next = pts[i + 1];
			if (next && next.s.stage !== 'negatives') {
				// Down (or up) into the next lane where this stage ended.
				const r = Math.min(5, Math.max(1, (pt.x2 - pt.x1) / 2));
				d += ` H${r2(pt.x2 - r)} C${pt.x2} ${pt.y} ${pt.x2} ${next.y} ${r2(pt.x2 + r)} ${next.y}`;
			} else {
				d += ` H${Math.max(pt.x2, r2(pt.x1 + 1.5))}`;
			}
		});
		const filed = pts.find((pt) => pt.s.stage === 'negatives');
		const { can } = canisterColors({ stock: p.roll.stock.token ?? p.roll.stock.id, stockLabel: p.roll.stock.name, stockBrand: p.roll.stock.brand });
		return { roll: p.roll, segs: p.segs, d, filed: filed ? { x: filed.x1, y: filed.y } : null, color: can };
	});
	return { lanes, ribbons, height: top + 8 };
});

const months = computed(() => {
	const out: { x: number; label: string; year: boolean }[] = [];
	let y = +start.value.slice(0, 4);
	let m = +start.value.slice(5, 7) + 1;
	const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
	for (;;) {
		if (m > 12) {
			m = 1;
			y++;
		}
		const iso = `${y}-${String(m).padStart(2, '0')}-01`;
		if (iso > end.value) break;
		out.push({ x: x(iso), label: MON[m - 1], year: m === 1 || out.length === 0 });
		if (out.at(-1)!.year) out.at(-1)!.label += ` ${y}`;
		m++;
	}
	return out;
});

/* ---------- hover and picking a stretch of time ---------- */

const hover = ref<string | null>(null);
const tip = ref<{ x: number; y: number } | null>(null);
const hovered = computed(() => layout.value.ribbons.find((r) => r.roll.id === hover.value) ?? null);
function onRibbon(e: PointerEvent, id: string) {
	hover.value = id;
	const box = host.value!.getBoundingClientRect();
	tip.value = { x: Math.round(e.clientX - box.left + host.value!.scrollLeft), y: Math.round(e.clientY - box.top) };
}

const brush = ref<{ a: number; b: number } | null>(null);
/* A press anywhere on the chart: a click (on a ribbon, it opens that roll) unless it moves; then it's a brush. */
let press: { x: number; id: number; moved: boolean } | null = null;
let swallowClick = false;
const toDate = (px: number) => isoOf(dayNo(start.value) + ((px - LABEL) / inner.value) * span.value);
const svgX = (e: PointerEvent) => {
	const box = (e.currentTarget as SVGElement).getBoundingClientRect();
	return Math.min(svgW.value - RIGHT, Math.max(LABEL, e.clientX - box.left));
};
function onDown(e: PointerEvent) {
	if (e.button !== 0) return;
	press = { x: svgX(e), id: e.pointerId, moved: false };
}
function onMove(e: PointerEvent) {
	if (!press || e.pointerId !== press.id) return;
	const px = svgX(e);
	if (!press.moved) {
		if (Math.abs(px - press.x) < 6) return;
		press.moved = true;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	}
	brush.value = { a: press.x, b: px };
}
function onUp(e: PointerEvent) {
	if (!press || e.pointerId !== press.id) return;
	const moved = press.moved;
	press = null;
	if (!moved) return;
	swallowClick = true;
	const [a, b] = brush.value ? [Math.min(brush.value.a, brush.value.b), Math.max(brush.value.a, brush.value.b)] : [0, 0];
	if (b - a < 8) {
		brush.value = null;
		emit('window', null);
		return;
	}
	emit('window', [toDate(a), toDate(b)]);
}
function onClick(e: MouseEvent) {
	// The click that ends a brush mustn't follow a ribbon's link.
	if (swallowClick) {
		swallowClick = false;
		e.preventDefault();
		e.stopPropagation();
	}
}
watch(
	() => props.window,
	(w) => {
		if (!w) brush.value = null;
		else brush.value = { a: x(w[0]), b: x(w[1]) };
	}
);

/* ---------- the average roll ---------- */

const average = computed(() => {
	const legs = LEGS.map((l) => ({ ...l, s: props.legs[l.key] })).filter((l) => l.s);
	const total = legs.reduce((t, l) => t + Math.max(0.5, l.s!.median), 0);
	return { legs: legs.map((l) => ({ ...l, share: Math.max(0.5, l.s!.median) / total })), total: Math.round(legs.reduce((t, l) => t + l.s!.median, 0)) };
});
const STAGE_OF: Record<LegKey, Stage> = { camera: 'camera', waiting: 'shot', lab: 'lab', filing: 'scanned' };

let ro: ResizeObserver | null = null;
onMounted(() => {
	if (!host.value) return;
	ro = new ResizeObserver(([e]) => (width.value = Math.round(e.contentRect.width)));
	ro.observe(host.value);
	width.value = Math.round(host.value.clientWidth);
	// Start at today, on the right.
	void nextTick(() => host.value && (host.value.scrollLeft = host.value.scrollWidth));
});
onBeforeUnmount(() => ro?.disconnect());

const summary = computed(() => {
	const n = layout.value.ribbons.length;
	const cams = layout.value.lanes.filter((l) => l.kind === 'camera').length;
	return `${n} rolls across ${cams} cameras, from ${formatDay(start.value)} to today.`;
});
</script>

<template>
	<figure class="roll-line">
		<figcaption class="head">
			<div class="avg" v-if="average.legs.length">
				<span class="lab-edge-print">The average roll · {{ average.total }} days from loading to filing</span>
				<span class="avg-bar" role="img" :aria-label="average.legs.map((l) => `${l.label}: ${l.s!.median} days`).join(', ')">
					<span v-for="l in average.legs" :key="l.key" class="leg" :style="{ flexGrow: l.share, '--c': `var(--lab-stage-${STAGE_OF[l.key]})` }" :title="`${l.label}: median ${l.s!.median} days, middle half ${l.s!.lo}–${l.s!.hi} (n=${l.s!.n})`">
						<b>{{ Math.round(l.s!.median) }}d</b>
						<i>{{ l.label }}</i>
					</span>
				</span>
			</div>
			<p class="hint lab-edge-print">
				<template v-if="window">{{ formatDay(window[0]) }} – {{ formatDay(window[1]) }} · <button type="button" class="lab-link" @click="emit('window', null)">clear</button></template>
				<template v-else>Drag across the line to pick a stretch of time</template>
			</p>
		</figcaption>

		<div ref="host" class="scroller" @pointerleave="hover = null">
			<svg
				class="chart"
				:class="{ hovering: !!hover }"
				:width="svgW"
				:height="layout.height"
				:viewBox="`0 0 ${svgW} ${layout.height}`"
				role="img"
				:aria-label="summary"
				@pointerdown="onDown"
				@pointermove="onMove"
				@pointerup="onUp"
				@pointercancel="onUp"
				@click.capture="onClick"
			>
				<!-- lanes -->
				<g class="lanes">
					<g v-for="(l, i) in layout.lanes" :key="l.key" :class="['lane', `lane-${l.kind}`, { odd: i % 2 }]">
						<rect :x="0" :y="l.top" :width="svgW" :height="l.height" />
						<line v-if="l.kind === 'shot'" :x1="0" :x2="svgW" :y1="l.top" :y2="l.top" class="divider" />
					</g>
				</g>
				<!-- months, along the top like edge print -->
				<g class="months">
					<g v-for="m in months" :key="m.label + m.x">
						<line :x1="m.x" :x2="m.x" :y1="AXIS - 6" :y2="layout.height" />
						<text :x="m.x + 4" :y="AXIS - 10" :class="{ year: m.year }">{{ m.label }}</text>
					</g>
				</g>
				<!-- the background you drag across -->
				<rect class="catch" :x="LABEL" :y="0" :width="inner" :height="layout.height" />
				<rect v-if="brush" class="brush" :x="Math.min(brush.a, brush.b)" :y="AXIS - 4" :width="Math.abs(brush.b - brush.a)" :height="layout.height - AXIS + 4" />
				<!-- today -->
				<g class="today">
					<line :x1="x(today)" :x2="x(today)" :y1="AXIS - 18" :y2="layout.height" />
					<text :x="x(today) - 4" :y="AXIS - 20" text-anchor="end">TODAY</text>
				</g>
				<!-- every roll -->
				<g class="ribbons">
					<a
						v-for="rb in layout.ribbons"
						:key="rb.roll.id"
						:href="`/photography/lab/rolls/${rb.roll.code}/`"
						class="ribbon"
						:class="{ on: hover === rb.roll.id }"
						:style="{ '--c': rb.color }"
						tabindex="-1"
						aria-hidden="true"
						@pointermove="onRibbon($event, rb.roll.id)"
						@pointerenter="onRibbon($event, rb.roll.id)"
					>
						<path v-if="rb.d" :d="rb.d" class="halo" />
						<path v-if="rb.d" :d="rb.d" class="stroke" />
						<circle v-if="rb.filed" :cx="rb.filed.x" :cy="rb.filed.y" r="3.4" class="dot" />
					</a>
				</g>
				<!-- lane names, over a fade so ribbons slide under them -->
				<g class="labels">
					<rect x="0" :y="AXIS" :width="LABEL - 6" :height="layout.height - AXIS" class="label-bg" />
					<text v-for="l in layout.lanes" :key="l.key" x="10" :y="l.top + l.height / 2 + 3.5" :class="`t-${l.kind}`">{{ l.label.length > 18 ? `${l.label.slice(0, 17)}…` : l.label }}</text>
				</g>
			</svg>
			<div v-if="hovered && tip" class="tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }" aria-hidden="true">
				<b><span class="lab-code">{{ hovered.roll.code }}</span> {{ hovered.roll.title ?? hovered.roll.stock.name }}</b>
				<span class="sub">{{ [hovered.roll.title ? hovered.roll.stock.name : null, hovered.roll.camera?.name].filter(Boolean).join(' · ') }}</span>
				<ol>
					<li v-for="s in hovered.segs" :key="s.stage" :style="{ '--c': `var(--lab-stage-${s.stage})` }">
						<span>{{ STATUS_LABEL[s.stage] }}</span>
						<span>{{ formatDay(s.from, false) }}<template v-if="s.stage !== 'negatives' && s.to !== s.from"> → {{ s.to === today ? 'now' : formatDay(s.to, false) }}</template></span>
					</li>
				</ol>
			</div>
		</div>
	</figure>
</template>

<style scoped>
.roll-line {
	display: grid;
	gap: 0.75rem;
	margin: 0;
	min-width: 0;
}

.head {
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	justify-content: space-between;
	gap: 0.75rem 1.5rem;
}

.avg {
	display: grid;
	gap: 0.4rem;
	flex: 1 1 26rem;
	min-width: 0;
}

.avg-bar {
	display: flex;
	gap: 2px;
	min-height: 2.3rem;
	border-radius: 3px;
	overflow: hidden;
}

.leg {
	display: grid;
	align-content: center;
	min-width: 3.2rem;
	padding: 0.2rem 0.5rem;
	background: color-mix(in oklch, var(--c) 22%, var(--lab-bench, var(--gray-999)));
	border-top: 3px solid var(--c);
	line-height: 1.1;
}

.leg b {
	font-family: var(--font-mono);
	font-size: 0.82rem;
}

.leg i {
	font-style: normal;
	font-size: 0.66rem;
	color: var(--gray-200);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.hint {
	margin: 0;
}

.scroller {
	position: relative;
	overflow-x: auto;
	border-radius: 0.7rem;
	background: var(--lab-bench);
	box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--lab-bench-rule) 60%, transparent);
	scrollbar-width: thin;
}

.chart {
	display: block;
	user-select: none;
	-webkit-user-select: none;
}

.lane rect {
	fill: transparent;
}

.lane.odd rect {
	fill: color-mix(in oklch, var(--lab-bench-deep) 55%, transparent);
}

.lane-negatives rect {
	fill: color-mix(in oklch, var(--lab-stage-negatives) 10%, transparent);
}

.divider {
	stroke: var(--lab-bench-rule);
	stroke-dasharray: 3 3;
}

.months line {
	stroke: var(--lab-bench-grid);
	stroke-width: 1;
}

.months text {
	font-family: var(--font-mono);
	font-size: 9.5px;
	letter-spacing: 0.14em;
	fill: var(--lab-edge-text);
}

.months text.year {
	font-weight: 600;
}

.catch {
	fill: transparent;
	cursor: crosshair;
}

.brush {
	fill: color-mix(in oklch, var(--lab-note) 14%, transparent);
	stroke: var(--lab-note);
	stroke-width: 1;
	pointer-events: none;
}

.today line {
	stroke: var(--lab-stage-camera);
	stroke-width: 1.2;
	stroke-dasharray: 2 3;
}

.today text {
	font-family: var(--font-mono);
	font-size: 9px;
	letter-spacing: 0.12em;
	fill: var(--lab-stage-camera);
}

.ribbon {
	cursor: pointer;
	transition: opacity 0.2s ease;
}

.ribbon .stroke {
	fill: none;
	stroke: var(--c);
	stroke-width: 4;
	stroke-linecap: round;
	stroke-linejoin: round;
}

/* A dark edge so pale films (HP5's white can) read on the light mat. */
.ribbon .halo {
	fill: none;
	stroke: oklch(25% 0.02 60 / 0.55);
	stroke-width: 5.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}

:root.theme-dark .ribbon .halo {
	stroke: oklch(5% 0 0 / 0.8);
}

.ribbon .dot {
	fill: var(--c);
	stroke: oklch(25% 0.02 60 / 0.6);
	stroke-width: 1;
}

.hovering .ribbon:not(.on) {
	opacity: 0.16;
}

.ribbon.on .stroke {
	stroke-width: 5;
}

.label-bg {
	fill: var(--lab-bench);
	opacity: 0.92;
}

.labels text {
	font-family: var(--font-mono);
	font-size: 10.5px;
	fill: var(--gray-0);
}

.labels text:not(.t-camera) {
	fill: var(--lab-bench-ink);
	font-style: italic;
}

.tip {
	position: absolute;
	z-index: 5;
	translate: 12px -50%;
	display: grid;
	gap: 0.2rem;
	min-width: 13rem;
	max-width: 18rem;
	padding: 0.6rem 0.75rem;
	border-radius: 0.5rem;
	background: var(--lab-card);
	box-shadow:
		0 0 0 1px var(--gray-800),
		var(--lab-lift-1);
	pointer-events: none;
	font-size: var(--text-sm);
}

.tip .sub {
	font-family: var(--font-mono);
	font-size: 0.68rem;
	color: var(--gray-300);
}

.tip ol {
	display: grid;
	gap: 0.1rem;
	margin: 0.3rem 0 0;
	padding: 0;
	list-style: none;
}

.tip li {
	display: flex;
	justify-content: space-between;
	gap: 0.75rem;
	padding-left: 0.6rem;
	border-left: 3px solid var(--c);
	font-family: var(--font-mono);
	font-size: 0.68rem;
}
</style>
