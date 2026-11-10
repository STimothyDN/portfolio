<script setup lang="ts">
/**
 * Ranked horizontal bars, one per thing (a camera, a film, a lab), each with
 * its value, its sample size, and optionally an interval whisker (how sure we
 * are). A reference line marks the overall figure. Diverging mode centres on
 * zero: one hue each way, gray at the middle.
 */
import { computed, ref } from 'vue';

export interface Bar {
	key: string;
	label: string;
	value: number;
	lo?: number;
	hi?: number;
	n?: number;
	note?: string;
}

const props = withDefaults(
	defineProps<{
		rows: Bar[];
		format: (v: number) => string;
		reference?: { value: number; label: string } | null;
		diverging?: { neg: string; pos: string } | null;
		max?: number | null;
		/** The noun for n ("scans"). */
		unit?: string;
	}>(),
	{ reference: null, diverging: null, max: null, unit: '' }
);

const hover = ref<string | null>(null);
const extent = computed(() => {
	const vals = props.rows.flatMap((r) => [r.value, r.hi ?? r.value, r.lo ?? r.value]);
	if (props.diverging) {
		const m = Math.max(0.0001, ...vals.map(Math.abs), Math.abs(props.reference?.value ?? 0));
		return { lo: -m, hi: m };
	}
	return { lo: 0, hi: props.max ?? Math.max(0.0001, ...vals, props.reference?.value ?? 0) };
});
const pos = (v: number) => `${Math.round(((v - extent.value.lo) / (extent.value.hi - extent.value.lo)) * 10000) / 100}%`;
const zero = computed(() => pos(0));
</script>

<template>
	<div class="bars" :class="{ div: !!diverging }">
		<ul role="list">
			<li v-for="r in rows" :key="r.key" :class="{ dim: hover && hover !== r.key }" @pointerenter="hover = r.key" @pointerleave="hover = null">
				<span class="name" :title="r.label">{{ r.label }}</span>
				<span class="track" :aria-label="`${r.label}: ${format(r.value)}${r.n != null ? `, ${r.n} ${unit}` : ''}${r.lo != null ? ` (likely ${format(r.lo)} to ${format(r.hi!)})` : ''}`" role="img">
					<span v-if="diverging" class="axis0" :style="{ left: zero }"></span>
					<span
						class="fill"
						:class="diverging ? (r.value < 0 ? 'neg' : 'pos') : ''"
						:style="diverging ? (r.value < 0 ? { left: pos(r.value), right: `calc(100% - ${zero})` } : { left: zero, right: `calc(100% - ${pos(r.value)})` }) : { left: '0', width: pos(r.value) }"
					></span>
					<span v-if="r.lo != null && r.hi != null" class="whisker" :style="{ left: pos(r.lo), width: `calc(${pos(r.hi)} - ${pos(r.lo)})` }"></span>
					<span v-if="reference" class="ref" :style="{ left: pos(reference.value) }"></span>
					<span v-if="hover === r.key" class="tip" :style="{ left: diverging ? zero : pos(r.value) }">
						<b>{{ format(r.value) }}</b>
						<template v-if="r.lo != null"> · likely {{ format(r.lo) }}–{{ format(r.hi!) }}</template>
						<template v-if="r.n != null"> · {{ r.n }} {{ unit }}</template>
						<template v-if="r.note"> · {{ r.note }}</template>
					</span>
				</span>
				<span class="val">{{ format(r.value) }}<small v-if="r.n != null">{{ r.n }}</small></span>
			</li>
		</ul>
		<p v-if="reference || diverging" class="key">
			<span v-if="reference"><i class="ref-key"></i>{{ reference.label }}</span>
			<template v-if="diverging"><span><i class="sw neg"></i>{{ diverging.neg }}</span><span><i class="sw pos"></i>{{ diverging.pos }}</span></template>
			<span v-if="rows.some((r) => r.lo != null)"><i class="wh-key"></i>likely range (95%)</span>
		</p>
	</div>
</template>

<style scoped>
.bars {
	/* One series, one hue: the amber of edge print. Diverging: amber one way, blue the other. */
	--bar: oklch(64% 0.13 62);
	--neg: oklch(56% 0.12 245);
	--pos: oklch(66% 0.14 55);
	display: grid;
	gap: 0.5rem;
}

:root.theme-dark .bars {
	--bar: oklch(66% 0.12 65);
	--neg: oklch(62% 0.12 245);
	--pos: oklch(66% 0.14 55);
}

ul {
	display: grid;
	gap: 0.15rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

li {
	display: grid;
	grid-template-columns: minmax(6rem, 11rem) minmax(0, 1fr) 4.6rem;
	align-items: center;
	gap: 0.7rem;
	min-height: 1.9rem;
	transition: opacity 0.15s ease;
}

li.dim {
	opacity: 0.45;
}

.name {
	font-size: var(--text-sm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.track {
	position: relative;
	height: 1.1rem;
	border-radius: 2px;
	background: color-mix(in oklch, var(--gray-800) 50%, transparent);
}

.fill {
	position: absolute;
	top: 0.2rem;
	bottom: 0.2rem;
	border-radius: 0 4px 4px 0;
	background: var(--bar);
}

.fill.neg {
	background: var(--neg);
	border-radius: 4px 0 0 4px;
}

.fill.pos {
	background: var(--pos);
}

.axis0 {
	position: absolute;
	top: -2px;
	bottom: -2px;
	width: 1px;
	background: var(--gray-400);
}

.whisker {
	position: absolute;
	top: 50%;
	height: 0;
	border-top: 1.5px solid var(--gray-0);
	opacity: 0.6;
}

.whisker::before,
.whisker::after {
	content: '';
	position: absolute;
	top: -5px;
	height: 8px;
	border-left: 1.5px solid var(--gray-0);
}

.whisker::before {
	left: 0;
}

.whisker::after {
	right: 0;
}

.ref {
	position: absolute;
	top: -4px;
	bottom: -4px;
	width: 0;
	border-left: 1.5px dashed var(--gray-200);
}

.val {
	font-family: var(--font-mono);
	font-size: 0.8rem;
	text-align: right;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.val small {
	margin-left: 0.35rem;
	font-size: 0.64rem;
	color: var(--gray-300);
}

.tip {
	position: absolute;
	bottom: calc(100% + 6px);
	z-index: 3;
	translate: -50% 0;
	padding: 0.3rem 0.55rem;
	border-radius: 0.4rem;
	background: var(--gray-0);
	color: var(--gray-999);
	font-size: 0.72rem;
	white-space: nowrap;
	pointer-events: none;
}

.key {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 1rem;
	font-size: 0.72rem;
	color: var(--gray-300);
}

.key span {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
}

.ref-key {
	width: 0;
	height: 0.8rem;
	border-left: 1.5px dashed var(--gray-200);
}

.wh-key {
	width: 1rem;
	border-top: 1.5px solid var(--gray-0);
	opacity: 0.6;
}

.sw {
	width: 0.8rem;
	height: 0.55rem;
	border-radius: 2px;
}

.sw.neg {
	background: var(--neg);
}

.sw.pos {
	background: var(--pos);
}

@media (max-width: 40em) {
	li {
		grid-template-columns: minmax(5rem, 7.5rem) minmax(0, 1fr) 3.8rem;
		gap: 0.5rem;
	}
}
</style>
