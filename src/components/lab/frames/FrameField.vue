<script setup lang="ts">
/**
 * The field: every frame you've logged as one dot, and the same dots
 * re-arranged by whatever question you ask, the way the film desk re-files the
 * same prints. Exposure (aperture against shutter, with lines of equal light),
 * light against density (thin negatives float up), the hour of day, or roll by
 * roll. Colour by film, camera or density. Frames that can't be placed in an
 * arrangement (no settings logged, no scan yet) wait in a tray along the
 * bottom, counted, not hidden. The search above dims everything it doesn't match.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { formatExposure, frameTime } from '../../../lib/lab/inventory';
import { shutterSeconds } from '../../../lib/lab/almanac';
import type { FrameRow, RollBrief } from '../../../lib/lab/server/frames';

const props = defineProps<{ rows: FrameRow[]; rolls: Record<string, RollBrief>; matched: Set<string> | null }>();

type Arrangement = 'exposure' | 'density' | 'clock' | 'rolls';
const ARRANGEMENTS: { key: Arrangement; label: string; hint: string }[] = [
	{ key: 'exposure', label: 'Exposure', hint: 'Aperture against shutter speed; diagonals are equal light (EV at the film’s speed)' },
	{ key: 'density', label: 'Light × density', hint: 'The light you metered against how dense the negative came back; higher is thinner' },
	{ key: 'clock', label: 'Time of day', hint: 'When each frame was taken, where it was taken' },
	{ key: 'rolls', label: 'Roll by roll', hint: 'Each roll a row, frame 1 on the left' },
];
type ColorBy = 'film' | 'camera' | 'density';
const arrangement = ref<Arrangement>('exposure');
const colorBy = ref<ColorBy>('film');

const canvas = ref<HTMLCanvasElement | null>(null);
const host = ref<HTMLElement | null>(null);
const W = ref(900);
const H = 380;
const PAD = { l: 52, r: 18, t: 18, b: 64 };
const TRAY = 26;

/* ---------- colours ---------- */

/*
 * The validated categorical order (dataviz palette), light and dark steps.
 * Films and cameras each take slots by how many frames they have (most first),
 * worked out over every frame so a search never repaints the survivors; past
 * eight, the rest share "Other" grey. Canister colours can't do this job:
 * half of Kodak's boxes are the same yellow.
 */
const HUES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const HUES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER = '#8a8a8a';
const dark = ref(false);
const hues = computed(() => (dark.value ? HUES_DARK : HUES_LIGHT));
const byCount = (key: (r: FrameRow) => string) => {
	const n = new Map<string, number>();
	for (const r of props.rows) n.set(key(r), (n.get(key(r)) ?? 0) + 1);
	return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
};
const cameraOrder = computed(() => byCount((r) => props.rolls[r.rollId]?.camera ?? '—'));
const filmOrder = computed(() => byCount((r) => props.rolls[r.rollId]?.stock ?? '—'));
const slot = (order: string[], key: string) => {
	const i = order.indexOf(key);
	return i >= 0 && i < hues.value.length ? hues.value[i] : OTHER;
};
function colorOf(r: FrameRow): string {
	const b = props.rolls[r.rollId];
	if (colorBy.value === 'camera') return slot(cameraOrder.value, b?.camera ?? '—');
	if (colorBy.value === 'density') return r.lift == null ? '#9a948a' : r.thin ? '#e0862a' : r.lift <= -0.02 ? '#2a68b0' : '#7aa0c8';
	return slot(filmOrder.value, b?.stock ?? '—');
}
const legendOf = (order: string[]) => {
	const named = order.slice(0, hues.value.length).map((label, i) => ({ label, color: hues.value[i] }));
	return order.length > hues.value.length ? [...named, { label: `Other (${order.length - hues.value.length})`, color: OTHER }] : named;
};
const legend = computed(() => {
	if (colorBy.value === 'camera') return legendOf(cameraOrder.value);
	if (colorBy.value === 'density')
		return [
			{ label: 'thin', color: '#e0862a' },
			{ label: 'normal', color: '#7aa0c8' },
			{ label: 'dense', color: '#2a68b0' },
			{ label: 'no scan', color: '#9a948a' },
		];
	return legendOf(filmOrder.value);
});

/* ---------- where each dot goes, per arrangement ---------- */

interface Target {
	x: number;
	y: number;
	placed: boolean;
}
const STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
const lg = Math.log2;
const r2 = (n: number) => Math.round(n * 100) / 100;

const scales = computed(() => {
	const iw = W.value - PAD.l - PAD.r;
	const ih = H - PAD.t - PAD.b;
	const lift = props.rows.map((r) => r.lift).filter((v): v is number => v != null);
	return {
		iw,
		ih,
		// Shutter: 1s (left) to 1/2000 (right), log scale; aperture: f/1.4 (bottom) to f/22 (top).
		sx: (t: number) => PAD.l + ((lg(1) - lg(t)) / (lg(1) - lg(1 / 2000))) * iw,
		sy: (f: number) => PAD.t + ih - ((lg(f) - lg(1.4)) / (lg(22) - lg(1.4))) * ih,
		ex: (ev: number) => PAD.l + ((ev - 2) / (17 - 2)) * iw,
		ly: (v: number) => {
			const lo = Math.min(-0.08, ...lift);
			const hi = Math.max(0.2, ...lift);
			return PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
		},
		liftRange: [Math.min(-0.08, ...lift), Math.max(0.2, ...lift)] as [number, number],
	};
});

/** A tiny deterministic jitter so frames at the same setting don't sit on one pixel. */
const jit = (id: string, k: number) => {
	let h = k * 97;
	for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 10007;
	return (h / 10007 - 0.5) * 2;
};

const rollRows = computed(() => {
	const ids = [...new Set(props.rows.map((r) => r.rollId))];
	return ids.slice(0, 18);
});

const targets = computed<Map<string, Target>>(() => {
	const s = scales.value;
	const out = new Map<string, Target>();
	const tray: FrameRow[] = [];
	for (const r of props.rows) {
		let t: Target | null = null;
		if (arrangement.value === 'exposure') {
			const sec = shutterSeconds(r.shutter);
			if (r.aperture && sec) t = { x: s.sx(sec) + jit(r.id, 1) * 5, y: s.sy(r.aperture) + jit(r.id, 2) * 5, placed: true };
		} else if (arrangement.value === 'density') {
			if (r.ev != null && r.lift != null) t = { x: s.ex(r.ev) + jit(r.id, 1) * 3, y: s.ly(r.lift), placed: true };
		} else if (arrangement.value === 'clock') {
			if (r.shotAt) {
				const d = new Date(r.shotAt + r.tzOffset * 60_000);
				const h = d.getUTCHours() + d.getUTCMinutes() / 60;
				t = { x: PAD.l + (h / 24) * s.iw, y: PAD.t + s.ih / 2 + jit(r.id, 3) * (s.ih / 2 - 6), placed: true };
			}
		} else {
			const row = rollRows.value.indexOf(r.rollId);
			if (row !== -1) {
				const rh = s.ih / Math.max(1, rollRows.value.length);
				t = { x: PAD.l + ((r.number - 0.5) / 38) * s.iw, y: PAD.t + rh * (row + 0.5), placed: true };
			}
		}
		if (t) out.set(r.id, { x: r2(t.x), y: r2(t.y), placed: true });
		else tray.push(r);
	}
	// The tray: what can't be placed here, lined up along the bottom.
	const step = Math.min(9, (W.value - PAD.l - PAD.r) / Math.max(1, tray.length));
	tray.forEach((r, i) => out.set(r.id, { x: r2(PAD.l + i * step + 4), y: H - TRAY / 2 - 2, placed: false }));
	return out;
});
const trayCount = computed(() => [...targets.value.values()].filter((t) => !t.placed).length);

/* ---------- drawing and the glide between arrangements ---------- */

const pos = new Map<string, { x: number; y: number }>();
let from = new Map<string, { x: number; y: number }>();
let t0 = 0;
let raf = 0;
const DUR = 780;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function ink(name: string, fallback: string) {
	return (host.value && getComputedStyle(host.value).getPropertyValue(name).trim()) || fallback;
}

function drawFrame(now: number) {
	const c = canvas.value;
	if (!c) return;
	const dpr = Math.min(2, devicePixelRatio || 1);
	const ctx = c.getContext('2d')!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, W.value, H);
	drawAxes(ctx);
	const tAll = reduce() ? 1 : Math.min(1, (now - t0) / DUR);
	let moving = false;
	const n = props.rows.length;
	props.rows.forEach((r, i) => {
		const to = targets.value.get(r.id);
		if (!to) return;
		const a = from.get(r.id) ?? to;
		// A little stagger, left to right, like prints re-filed one after another.
		const lag = (i / Math.max(1, n)) * 0.25;
		const t = Math.min(1, Math.max(0, (tAll - lag) / (1 - lag)));
		if (t < 1) moving = true;
		const e = ease(t);
		const p = { x: a.x + (to.x - a.x) * e, y: a.y + (to.y - a.y) * e };
		pos.set(r.id, p);
		const dim = props.matched && !props.matched.has(r.id);
		ctx.globalAlpha = dim ? 0.12 : to.placed ? 0.92 : 0.5;
		ctx.beginPath();
		ctx.arc(p.x, p.y, hover.value === r.id ? 6 : 4.2, 0, Math.PI * 2);
		ctx.fillStyle = colorOf(r);
		ctx.fill();
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = ink('--lab-card', '#fff');
		ctx.stroke();
	});
	ctx.globalAlpha = 1;
	if (moving) raf = requestAnimationFrame(drawFrame);
	else raf = 0;
}

function drawAxes(ctx: CanvasRenderingContext2D) {
	const s = scales.value;
	const grid = ink('--lab-bench-grid', 'rgba(0,0,0,.08)');
	const text = ink('--lab-edge-text', '#8a5a1a');
	ctx.font = '10px "Geist Mono Variable", ui-monospace, monospace';
	ctx.fillStyle = text;
	ctx.strokeStyle = grid;
	ctx.lineWidth = 1;
	const line = (x1: number, y1: number, x2: number, y2: number) => {
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.stroke();
	};
	const bottom = PAD.t + s.ih;
	if (arrangement.value === 'exposure') {
		const shutters: [number, string][] = [
			[1, '1s'],
			[1 / 4, '1/4'],
			[1 / 15, '1/15'],
			[1 / 60, '1/60'],
			[1 / 250, '1/250'],
			[1 / 1000, '1/1000'],
		];
		ctx.textAlign = 'center';
		for (const [t, l] of shutters) {
			line(s.sx(t), PAD.t, s.sx(t), bottom);
			ctx.fillText(l, s.sx(t), bottom + 14);
		}
		ctx.textAlign = 'right';
		for (const f of STOPS.filter((v) => v <= 22)) {
			line(PAD.l, s.sy(f), PAD.l + s.iw, s.sy(f));
			ctx.fillText(`f/${f}`, PAD.l - 6, s.sy(f) + 3);
		}
		// Lines of equal light: EV = log2(N²/t).
		ctx.save();
		ctx.setLineDash([3, 4]);
		ctx.strokeStyle = ink('--lab-note', '#3a6ab0');
		ctx.globalAlpha = 0.35;
		for (let ev = 4; ev <= 18; ev += 2) {
			const pts: [number, number][] = [];
			for (const f of [1.4, 22]) {
				const t = (f * f) / 2 ** ev;
				pts.push([s.sx(t), s.sy(f)]);
			}
			line(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
		}
		ctx.restore();
	} else if (arrangement.value === 'density') {
		ctx.textAlign = 'center';
		for (let ev = 2; ev <= 17; ev += 3) {
			line(s.ex(ev), PAD.t, s.ex(ev), bottom);
			ctx.fillText(`EV ${ev}`, s.ex(ev), bottom + 14);
		}
		ctx.textAlign = 'right';
		const [lo, hi] = s.liftRange;
		for (let v = Math.ceil(lo * 10) / 10; v <= hi; v += 0.1) {
			line(PAD.l, s.ly(v), PAD.l + s.iw, s.ly(v));
			ctx.fillText(`${v > 0 ? '+' : ''}${v.toFixed(1)}`, PAD.l - 6, s.ly(v) + 3);
		}
		ctx.save();
		ctx.strokeStyle = ink('--lab-warn', '#b06020');
		ctx.setLineDash([4, 4]);
		line(PAD.l, s.ly(0.06), PAD.l + s.iw, s.ly(0.06));
		ctx.fillStyle = ink('--lab-warn', '#b06020');
		ctx.textAlign = 'left';
		ctx.fillText('thin above here', PAD.l + 4, s.ly(0.06) - 5);
		ctx.restore();
	} else if (arrangement.value === 'clock') {
		ctx.textAlign = 'center';
		for (let h = 0; h <= 24; h += 3) {
			const x = PAD.l + (h / 24) * s.iw;
			line(x, PAD.t, x, bottom);
			ctx.fillText(h === 0 || h === 24 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`, x, bottom + 14);
		}
	} else {
		ctx.textAlign = 'right';
		const rh = s.ih / Math.max(1, rollRows.value.length);
		rollRows.value.forEach((id, i) => {
			ctx.fillText(props.rolls[id]?.code ?? '', PAD.l - 6, PAD.t + rh * (i + 0.5) + 3);
		});
		ctx.textAlign = 'center';
		for (const n of [1, 12, 24, 36]) ctx.fillText(String(n), PAD.l + ((n - 0.5) / 38) * s.iw, bottom + 14);
	}
	// The tray.
	ctx.textAlign = 'left';
	ctx.fillStyle = ink('--gray-300', '#888');
	ctx.strokeStyle = grid;
	line(PAD.l, H - TRAY - 6, W.value - PAD.r, H - TRAY - 6);
}

function rearrange() {
	from = new Map(pos);
	t0 = performance.now();
	if (!raf) raf = requestAnimationFrame(drawFrame);
}
watch([arrangement, W], () => void nextTick(rearrange));
watch([colorBy, () => props.matched, dark], () => {
	if (!raf) raf = requestAnimationFrame(drawFrame);
});

/* ---------- hover and click ---------- */

const hover = ref<string | null>(null);
const tip = ref<{ x: number; y: number } | null>(null);
const hovered = computed(() => props.rows.find((r) => r.id === hover.value) ?? null);
function nearest(e: PointerEvent): string | null {
	const box = canvas.value!.getBoundingClientRect();
	const x = e.clientX - box.left;
	const y = e.clientY - box.top;
	let best: string | null = null;
	let d = 100;
	for (const [id, p] of pos) {
		if (props.matched && !props.matched.has(id)) continue;
		const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
		if (dd < d) {
			d = dd;
			best = id;
		}
	}
	tip.value = { x: Math.round(x), y: Math.round(y) };
	return best;
}
function onMove(e: PointerEvent) {
	const id = nearest(e);
	if (id !== hover.value) {
		hover.value = id;
		if (!raf) raf = requestAnimationFrame(drawFrame);
	}
}
function onClick(e: PointerEvent) {
	const id = nearest(e);
	const r = props.rows.find((x) => x.id === id);
	if (r) location.href = `/photography/lab/rolls/${props.rolls[r.rollId].code}/#frames`;
}

let ro: ResizeObserver | null = null;
function size() {
	const c = canvas.value;
	if (!c || !host.value) return;
	W.value = Math.max(320, Math.round(host.value.clientWidth));
	const dpr = Math.min(2, devicePixelRatio || 1);
	c.width = W.value * dpr;
	c.height = H * dpr;
	c.style.width = `${W.value}px`;
	c.style.height = `${H}px`;
}
let themeWatch: MutationObserver | null = null;
onMounted(() => {
	// Dark mode gets the palette's dark steps (the theme toggles a class on <html>).
	const root = document.documentElement;
	dark.value = root.classList.contains('theme-dark');
	themeWatch = new MutationObserver(() => (dark.value = root.classList.contains('theme-dark')));
	themeWatch.observe(root, { attributes: true, attributeFilter: ['class'] });
	size();
	// The first arrangement grows out of the tray.
	for (const r of props.rows) pos.set(r.id, { x: PAD.l + Math.random() * (W.value - PAD.l - PAD.r), y: H - TRAY / 2 });
	rearrange();
	ro = new ResizeObserver(() => size());
	if (host.value) ro.observe(host.value);
});
onBeforeUnmount(() => {
	themeWatch?.disconnect();
	ro?.disconnect();
	cancelAnimationFrame(raf);
});

const placedCount = computed(() => props.rows.length - trayCount.value);
const hint = computed(() => ARRANGEMENTS.find((a) => a.key === arrangement.value)!.hint);
</script>

<template>
	<section class="frame-field" aria-labelledby="field-h">
		<header class="f-head">
			<h2 id="field-h" class="lab-h2">The field</h2>
			<div class="controls">
				<div class="seg" role="group" aria-label="Arrange the frames by">
					<button v-for="a in ARRANGEMENTS" :key="a.key" type="button" :aria-pressed="arrangement === a.key" @click="arrangement = a.key">{{ a.label }}</button>
				</div>
				<label class="color">
					<span>Colour by</span>
					<select id="field-color" v-model="colorBy" class="lab-input lab-select">
						<option value="film">Film</option>
						<option value="camera">Camera</option>
						<option value="density">Density</option>
					</select>
				</label>
			</div>
		</header>
		<p class="lab-meta">{{ hint }}. {{ placedCount }} of {{ rows.length }} frames placed<template v-if="trayCount">; {{ trayCount }} in the tray below can’t be ({{ arrangement === 'density' ? 'no scan or no settings' : arrangement === 'exposure' ? 'camera set the exposure' : arrangement === 'clock' ? 'added later, no time' : 'beyond the first 18 rolls' }})</template>.</p>
		<div ref="host" class="plot" @pointerleave="hover = null">
			<canvas ref="canvas" role="img" :aria-label="`${rows.length} frames arranged by ${arrangement}`" @pointermove="onMove" @click="onClick"></canvas>
			<div v-if="hovered && tip" class="tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }" aria-hidden="true">
				<b><span class="lab-code">{{ rolls[hovered.rollId]?.code }}</span> frame {{ hovered.number }}</b>
				<span>{{ formatExposure(hovered) }}<template v-if="hovered.ev != null"> · EV {{ hovered.ev }}</template></span>
				<span>{{ frameTime(hovered, true) }} · {{ rolls[hovered.rollId]?.stock }}</span>
				<span v-if="hovered.thin" class="thin">came back thin</span>
			</div>
		</div>
		<ul class="legend" role="list" aria-label="Colours">
			<li v-for="l in legend.slice(0, 10)" :key="l.label"><i :style="{ background: l.color }"></i>{{ l.label }}</li>
			<li v-if="legend.length > 10">+{{ legend.length - 10 }} more</li>
		</ul>
	</section>
</template>

<style scoped>
.frame-field {
	display: grid;
	gap: 0.7rem;
	min-width: 0;
}

.f-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem 1rem;
}

.controls {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem;
}

.seg {
	display: inline-flex;
	flex-wrap: wrap;
	padding: 0.18rem;
	border: 1px solid var(--gray-800);
	border-radius: 999px;
}

.seg button {
	min-height: 2.2rem;
	padding: 0.2rem 0.8rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.seg button[aria-pressed='true'] {
	background: var(--gray-0);
	color: var(--gray-999);
}

.seg button:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.color {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.color select {
	min-height: 2.4rem;
	width: auto;
}

.plot {
	position: relative;
	border-radius: 0.7rem;
	background: var(--lab-card);
	box-shadow: 0 0 0 1px var(--gray-800);
	overflow: hidden;
}

canvas {
	display: block;
	cursor: crosshair;
}

.tip {
	position: absolute;
	z-index: 3;
	translate: 12px -50%;
	display: grid;
	gap: 0.1rem;
	padding: 0.45rem 0.6rem;
	border-radius: 0.45rem;
	background: var(--gray-0);
	color: var(--gray-999);
	font-size: 0.72rem;
	white-space: nowrap;
	pointer-events: none;
}

.tip .lab-code {
	color: inherit;
}

.tip .thin {
	color: oklch(80% 0.14 60);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 1rem;
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 0.74rem;
	color: var(--gray-200);
}

.legend li {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
}

.legend i {
	width: 0.65rem;
	height: 0.65rem;
	border-radius: 50%;
}
</style>
