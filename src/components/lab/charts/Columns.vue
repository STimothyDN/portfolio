<script setup lang="ts">
/**
 * Columns over time or around the clock (months, weeks, hours), one series or
 * up to three stacked with a 2px gap between segments. Rounded tops, a
 * recessive baseline, labels thinned to fit, a tooltip per column. An
 * optional band shades a stretch of the axis (a window, the night).
 */
import { computed, ref } from 'vue';

export interface Series {
	key: string;
	label: string;
	color: string;
}

const props = withDefaults(
	defineProps<{
		labels: string[];
		/** One array of values per series, aligned with labels. */
		values: number[][];
		series: Series[];
		format?: (v: number) => string;
		height?: number;
		/** Indices [from, to] to shade, with a label. */
		band?: { from: number; to: number; label: string } | null;
		/** Show every nth label. */
		every?: number;
		/** Mark a column (today, the current month). */
		mark?: number | null;
	}>(),
	{ format: (v: number) => String(v), height: 150, band: null, every: 1, mark: null }
);

const hover = ref<number | null>(null);
const totals = computed(() => props.labels.map((_, i) => props.values.reduce((t, s) => t + (s[i] ?? 0), 0)));
const max = computed(() => Math.max(1, ...totals.value));
</script>

<template>
	<div class="cols" :style="{ '--h': `${height}px`, '--n': labels.length }">
		<div class="plot" role="img" :aria-label="labels.map((l, i) => `${l}: ${format(totals[i])}`).join(', ')">
			<span v-if="band" class="band" :style="{ left: `calc(${band.from} / var(--n) * 100%)`, width: `calc(${band.to - band.from + 1} / var(--n) * 100%)` }"><i>{{ band.label }}</i></span>
			<div v-for="(l, i) in labels" :key="l + i" class="col" :class="{ on: hover === i, marked: mark === i }" @pointerenter="hover = i" @pointerleave="hover = null">
				<span class="stack" :style="{ height: `${(totals[i] / max) * 100}%` }">
					<span v-for="(s, k) in series" v-show="values[k][i]" :key="s.key" class="seg" :style="{ flexGrow: values[k][i], background: s.color }"></span>
				</span>
				<span v-if="hover === i" class="tip">
					<b>{{ l }}</b>
					<template v-if="series.length > 1">
						<span v-for="(s, k) in series" :key="s.key"><i :style="{ background: s.color }"></i>{{ s.label }} {{ format(values[k][i] ?? 0) }}</span>
					</template>
					<span v-else>{{ format(totals[i]) }}</span>
				</span>
			</div>
		</div>
		<div class="axis" aria-hidden="true">
			<span v-for="(l, i) in labels" :key="l + i">{{ i % every === 0 ? l : '' }}</span>
		</div>
		<p v-if="series.length > 1" class="legend">
			<span v-for="s in series" :key="s.key"><i :style="{ background: s.color }"></i>{{ s.label }}</span>
		</p>
	</div>
</template>

<style scoped>
.cols {
	display: grid;
	gap: 0.35rem;
}

.plot {
	position: relative;
	display: grid;
	grid-template-columns: repeat(var(--n), minmax(0, 1fr));
	align-items: end;
	gap: 2px;
	height: var(--h);
	border-bottom: 1px solid var(--gray-700);
}

.col {
	position: relative;
	display: flex;
	align-items: end;
	height: 100%;
	cursor: default;
}

/* Hit area: the whole column height, not just the bar. */
.col::before {
	content: '';
	position: absolute;
	inset: 0;
}

.col.on::before {
	background: color-mix(in oklch, var(--gray-0) 6%, transparent);
}

.stack {
	display: flex;
	flex-direction: column-reverse;
	gap: 2px;
	width: 100%;
	min-height: 0;
}

.seg {
	display: block;
	min-height: 2px;
	flex-basis: 0;
}

.stack .seg:last-child {
	border-radius: 4px 4px 0 0;
}

.marked .stack {
	outline: 1.5px solid var(--gray-0);
	outline-offset: 1px;
	border-radius: 4px 4px 0 0;
}

.band {
	position: absolute;
	top: 0;
	bottom: 0;
	background: color-mix(in oklch, var(--lab-ok) 12%, transparent);
	border-inline: 1px dashed color-mix(in oklch, var(--lab-ok) 60%, transparent);
	pointer-events: none;
}

.band i {
	position: absolute;
	top: 0.2rem;
	left: 0.35rem;
	font-family: var(--font-mono);
	font-size: 0.6rem;
	font-style: normal;
	letter-spacing: 0.06em;
	color: var(--lab-ok);
	white-space: nowrap;
}

.tip {
	position: absolute;
	bottom: calc(100% + 4px);
	left: 50%;
	z-index: 3;
	translate: -50% 0;
	display: grid;
	gap: 0.1rem;
	padding: 0.35rem 0.55rem;
	border-radius: 0.4rem;
	background: var(--gray-0);
	color: var(--gray-999);
	font-size: 0.72rem;
	white-space: nowrap;
	pointer-events: none;
}

.tip i {
	display: inline-block;
	width: 0.55rem;
	height: 0.55rem;
	margin-right: 0.3rem;
	border-radius: 2px;
}

.axis {
	display: grid;
	grid-template-columns: repeat(var(--n), minmax(0, 1fr));
	gap: 2px;
	font-family: var(--font-mono);
	font-size: 0.6rem;
	letter-spacing: 0.06em;
	color: var(--lab-edge-text);
}

.axis span {
	overflow: visible;
	white-space: nowrap;
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 1rem;
	font-size: 0.72rem;
	color: var(--gray-200);
}

.legend span {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
}

.legend i {
	width: 0.8rem;
	height: 0.55rem;
	border-radius: 2px;
}
</style>
