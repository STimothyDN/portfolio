<template>
	<div class="exposure">
		<figure class="map">
			<svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="mapLabel">
				<!-- grid -->
				<g class="grid">
					<line v-for="(_, j) in SH" :key="`v${j}`" :x1="x(j)" :x2="x(j)" :y1="PAD.t" :y2="H - PAD.b" />
					<line v-for="(_, i) in AP" :key="`h${i}`" :x1="PAD.l" :x2="W - PAD.r" :y1="y(i)" :y2="y(i)" />
				</g>
				<!-- Exposure value lines: every setting on one has the same exposure. -->
				<g class="ev">
					<template v-for="ev in EV_LINES" :key="ev.ev">
						<line v-if="evLine(ev.ev)" v-bind="evLine(ev.ev)!" :class="{ sunny: ev.ev === 15 }" />
						<text v-if="evLine(ev.ev)" :x="evLine(ev.ev)!.x2 - 4" :y="evLine(ev.ev)!.y2 - 6" text-anchor="end" class="ev-label">{{ ev.label }}</text>
					</template>
				</g>
				<!-- axes -->
				<g class="axis">
					<text v-for="(a, i) in AP" :key="`a${a}`" :x="PAD.l - 8" :y="y(i)" text-anchor="end" dominant-baseline="middle">{{ a }}</text>
					<text v-for="(s, j) in SH" :key="`s${s}`" :x="x(j)" :y="H - PAD.b + 14" text-anchor="middle">{{ j % 2 === 0 || W > 500 ? s.replace('1/', '') : '' }}</text>
					<text :x="PAD.l - 8" :y="PAD.t - 12" text-anchor="end" class="title">f/</text>
					<text :x="W - PAD.r" :y="H - 4" text-anchor="end" class="title">shutter (1/s)</text>
				</g>
				<!-- frames -->
				<g class="dots">
					<circle
						v-for="(c, k) in cells"
						:key="`${c.i}-${c.j}`"
						:cx="x(c.j)"
						:cy="y(c.i)"
						:r="3 + 9 * Math.sqrt(c.n / maxCell)"
						:style="{ '--k': k }"
						tabindex="0"
						@mouseenter="hover = c"
						@focus="hover = c"
						@mouseleave="hover = null"
						@blur="hover = null"
					>
						<title>{{ describe(c) }}</title>
					</circle>
				</g>
			</svg>
			<figcaption class="lab-edge-print">{{ hover ? describe(hover) : mapCaption }}</figcaption>
		</figure>

		<figure class="clock">
			<svg viewBox="-14 -14 228 228" role="img" :aria-label="clockLabel">
				<circle cx="100" cy="100" r="92" class="face" />
				<circle cx="100" cy="100" r="50" class="inner" />
				<template v-for="h in 24" :key="h">
					<g v-if="hours[h - 1]" class="hour" :class="{ peak: h - 1 === peak }">
						<line
							:x1="cpt(54, h - 1).x"
							:y1="cpt(54, h - 1).y"
							:x2="cpt(56 + 30 * (hours[h - 1] / maxHour), h - 1).x"
							:y2="cpt(56 + 30 * (hours[h - 1] / maxHour), h - 1).y"
							:style="{ '--h': h }"
							pathLength="1"
						/>
					</g>
				</template>
				<text v-for="h in [0, 6, 12, 18]" :key="`l${h}`" :x="cpt(106, h).x" :y="cpt(106, h).y" text-anchor="middle" dominant-baseline="middle" class="hl">
					{{ h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p` }}
				</text>
				<text x="100" y="98" text-anchor="middle" class="peak-big">{{ timed ? hourLabel(peak) : '—' }}</text>
				<text x="100" y="114" text-anchor="middle" class="peak-sub">{{ timed ? 'busiest hour' : 'no times yet' }}</text>
			</svg>
			<figcaption class="lab-edge-print">{{ timed ? `${timed} frames with a time` : 'Frames logged in shooting mode land here' }}</figcaption>
		</figure>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { shutterSeconds, type FrameDigest } from '../../lib/lab/almanac';

const props = defineProps<{ frames: FrameDigest[] }>();

/** Full-stop apertures (rows, top = wide open) and shutter speeds (columns, slow → fast). */
const AP = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
const SH = ['1s', '1/2', '1/4', '1/8', '1/15', '1/30', '1/60', '1/125', '1/250', '1/500', '1/1000', '1/2000', '1/4000'];
const EV_LINES = [
	{ ev: 15, label: 'EV 15 · sunny 16 @ ISO 100' },
	{ ev: 12, label: 'EV 12 · overcast' },
	{ ev: 9, label: 'EV 9 · shade, dusk' },
	{ ev: 6, label: 'EV 6 · indoors' },
];
const W = 560;
const H = 300;
const PAD = { l: 40, r: 16, t: 24, b: 30 };
const x = (j: number) => Math.round((PAD.l + 8 + (j * (W - PAD.l - PAD.r - 16)) / (SH.length - 1)) * 100) / 100;
const y = (i: number) => Math.round((PAD.t + 6 + (i * (H - PAD.t - PAD.b - 12)) / (AP.length - 1)) * 100) / 100;

/** Snap a value to the nearest full stop on an axis (by log scale). */
const nearest = (v: number, list: number[]) =>
	list.reduce((best, s, idx) => (Math.abs(Math.log2(s / v)) < Math.abs(Math.log2(list[best] / v)) ? idx : best), 0);
const shutterIdx = (s: string) => {
	const sec = shutterSeconds(s);
	return sec == null ? -1 : nearest(sec, SH.map((x) => shutterSeconds(x)!));
};

interface Cell {
	i: number;
	j: number;
	n: number;
}

const cells = computed<Cell[]>(() => {
	const map = new Map<string, Cell>();
	for (const [a, s] of props.frames) {
		if (a == null || s == null) continue;
		const j = shutterIdx(s);
		if (j < 0) continue;
		const i = nearest(a, AP);
		const key = `${i}-${j}`;
		const c = map.get(key) ?? { i, j, n: 0 };
		c.n++;
		map.set(key, c);
	}
	return [...map.values()];
});
const maxCell = computed(() => Math.max(1, ...cells.value.map((c) => c.n)));
const set = computed(() => cells.value.reduce((n, c) => n + c.n, 0));
const auto = computed(() => props.frames.length - set.value);
const hover = ref<Cell | null>(null);

// On this grid (full stops each way) EV ≈ 1 + row + column, so each EV line is
// a diagonal: row = EV − 1 − column.
function evLine(ev: number) {
	const pts: { i: number; j: number }[] = [];
	for (let j = 0; j < SH.length; j++) {
		const i = ev - 1 - j;
		if (i >= 0 && i <= AP.length - 1) pts.push({ i, j });
	}
	if (pts.length < 2) return null;
	const a = pts[0];
	const b = pts[pts.length - 1];
	return { x1: x(a.j), y1: y(a.i), x2: x(b.j), y2: y(b.i) };
}

const describe = (c: Cell) => `f/${AP[c.i]} · ${SH[c.j]} · ${c.n} ${c.n === 1 ? 'frame' : 'frames'} · EV ${1 + c.i + c.j}`;
const mapCaption = computed(() =>
	set.value
		? `${set.value} frames with aperture and shutter${auto.value ? ` · ${auto.value} set by the camera` : ''}`
		: 'Note aperture and shutter in shooting mode to see where you work'
);
const mapLabel = computed(() => `Exposure map: ${mapCaption.value}`);

/* ---------- the clock ---------- */

const hours = computed(() => {
	const h = Array.from({ length: 24 }, () => 0);
	for (const f of props.frames) if (f[2] != null) h[f[2]]++;
	return h;
});
const timed = computed(() => hours.value.reduce((a, b) => a + b, 0));
const maxHour = computed(() => Math.max(1, ...hours.value));
const peak = computed(() => hours.value.indexOf(Math.max(...hours.value)));
// Rounded so the server's render and the browser's agree to the digit.
const r2 = (n: number) => Math.round(n * 100) / 100;
const cpt = (r: number, h: number) => {
	const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
	return { x: r2(100 + r * Math.cos(a)), y: r2(100 + r * Math.sin(a)) };
};
const hourLabel = (h: number) => (h === 0 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`);
const clockLabel = computed(() => (timed.value ? `Frames by hour of day; busiest around ${hourLabel(peak.value)}` : 'No frame times yet'));
</script>

<style scoped>
.exposure {
	display: grid;
	grid-template-columns: minmax(0, 2.2fr) minmax(12rem, 1fr);
	gap: 1.5rem 2rem;
	align-items: start;
}

@media (max-width: 52em) {
	.exposure {
		grid-template-columns: minmax(0, 1fr);
	}
}

figure {
	margin: 0;
	display: grid;
	gap: 0.5rem;
}

svg {
	display: block;
	width: 100%;
	height: auto;
	overflow: visible;
}

.grid line {
	stroke: var(--gray-800);
	stroke-width: 1;
}

.ev line {
	stroke: var(--gray-600);
	stroke-width: 1;
	stroke-dasharray: 3 4;
}

.ev line.sunny {
	stroke: var(--lab-edge-ink);
	stroke-dasharray: none;
	stroke-width: 1.5;
}

.ev-label {
	font-family: var(--font-mono);
	font-size: 8.5px;
	fill: var(--gray-400);
}

.axis text {
	font-family: var(--font-mono);
	font-size: 9.5px;
	fill: var(--gray-300);
}

.axis .title {
	fill: var(--lab-edge-text);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	font-size: 8.5px;
}

.dots circle {
	fill: color-mix(in oklch, var(--lab-edge-ink) 70%, transparent);
	stroke: var(--lab-edge-ink);
	stroke-width: 1;
	cursor: default;
	outline: none;
	transition: fill 0.15s ease;
}

.dots circle:hover,
.dots circle:focus-visible {
	fill: var(--gray-0);
	stroke: var(--gray-0);
}

.face {
	fill: none;
	stroke: var(--gray-700);
	stroke-dasharray: 1 5.02;
	stroke-width: 5;
}

.inner {
	fill: none;
	stroke: var(--gray-800);
}

.hour line {
	stroke: var(--gray-600);
	stroke-width: 6;
	stroke-linecap: round;
}

.hour.peak line {
	stroke: var(--lab-edge-ink);
}

.hl {
	font-family: var(--font-mono);
	font-size: 9px;
	fill: var(--gray-300);
}

.peak-big {
	font-family: var(--font-brand);
	font-size: 20px;
	fill: var(--gray-0);
}

.peak-sub {
	font-family: var(--font-mono);
	font-size: 8px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	fill: var(--gray-300);
}

@media (prefers-reduced-motion: no-preference) {
	.dots circle {
		transform-box: fill-box;
		transform-origin: center;
		animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
		animation-delay: calc(0.3s + var(--k) * 25ms);
	}

	@keyframes pop {
		from {
			scale: 0;
		}
	}

	.hour line {
		stroke-dasharray: 1;
		animation: sweep 0.6s ease-out both;
		animation-delay: calc(var(--h) * 30ms + 0.2s);
	}

	@keyframes sweep {
		from {
			stroke-dashoffset: 1;
		}
	}
}
</style>
