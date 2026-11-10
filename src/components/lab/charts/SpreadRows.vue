<script setup lang="ts">
/**
 * How long things take, row by row: every individual roll as a dot, the
 * middle half as a band, the median as a tick, on one shared scale of days.
 */
import { computed, ref } from 'vue';

export interface SpreadRow {
	key: string;
	label: string;
	values: number[];
	median: number | null;
	lo: number | null;
	hi: number | null;
	color?: string;
	note?: string;
}

const props = withDefaults(defineProps<{ rows: SpreadRow[]; unit?: string; max?: number | null }>(), { unit: 'days', max: null });
const hover = ref<string | null>(null);
const top = computed(() => props.max ?? Math.max(4, ...props.rows.flatMap((r) => [...r.values, r.hi ?? 0])) * 1.05);
const x = (v: number) => `${Math.round((v / top.value) * 10000) / 100}%`;
const ticks = computed(() => {
	const step = top.value > 60 ? 14 : top.value > 25 ? 7 : top.value > 10 ? 2 : 1;
	return Array.from({ length: Math.floor(top.value / step) + 1 }, (_, i) => i * step);
});
// Dots on the same day stack a little so they stay countable.
const jitter = (vals: number[]) => {
	const seen = new Map<number, number>();
	return vals.map((v) => {
		const k = Math.round(v);
		const n = seen.get(k) ?? 0;
		seen.set(k, n + 1);
		return { v, dy: (n % 3) - 1 };
	});
};
</script>

<template>
	<div class="spread">
		<ul role="list">
			<li v-for="r in rows" :key="r.key" :class="{ dim: hover && hover !== r.key }" @pointerenter="hover = r.key" @pointerleave="hover = null">
				<span class="name">{{ r.label }}</span>
				<span class="track" role="img" :aria-label="`${r.label}: median ${r.median ?? '—'} ${unit}${r.lo != null ? `, usually ${r.lo}–${r.hi}` : ''}, ${r.values.length} rolls`" :style="{ '--c': r.color ?? 'var(--gray-200)' }">
					<span v-if="r.lo != null && r.hi != null" class="iqr" :style="{ left: x(r.lo), width: `calc(${x(r.hi)} - ${x(r.lo)})` }"></span>
					<span v-for="(d, i) in jitter(r.values)" :key="i" class="dot" :style="{ left: x(d.v), '--dy': d.dy }"></span>
					<span v-if="r.median != null" class="med" :style="{ left: x(r.median) }"></span>
					<span v-if="hover === r.key" class="tip" :style="{ left: x(r.median ?? 0) }">
						<b>{{ r.median ?? '—' }} {{ unit }}</b> median<template v-if="r.lo != null"> · usually {{ r.lo }}–{{ r.hi }}</template> · {{ r.values.length }} rolls<template v-if="r.note"> · {{ r.note }}</template>
					</span>
				</span>
				<span class="val">{{ r.median != null ? `${Math.round(r.median)}d` : '—' }}</span>
			</li>
		</ul>
		<div class="ticks" aria-hidden="true">
			<span class="pad"></span>
			<span class="scale">
				<i v-for="t in ticks" :key="t" :style="{ left: x(t) }">{{ t }}</i>
			</span>
			<span class="pad unit">{{ unit }}</span>
		</div>
	</div>
</template>

<style scoped>
.spread {
	display: grid;
	gap: 0.3rem;
}

ul {
	display: grid;
	gap: 0.35rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

li,
.ticks {
	display: grid;
	grid-template-columns: minmax(6rem, 11rem) minmax(0, 1fr) 3rem;
	align-items: center;
	gap: 0.7rem;
}

li {
	min-height: 2rem;
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
	height: 1.6rem;
	border-bottom: 1px solid var(--gray-800);
}

.iqr {
	position: absolute;
	top: 0.35rem;
	bottom: 0.35rem;
	border-radius: 4px;
	background: color-mix(in oklch, var(--c) 28%, transparent);
}

.dot {
	position: absolute;
	top: calc(50% + var(--dy) * 4px);
	width: 8px;
	height: 8px;
	translate: -50% -50%;
	border-radius: 50%;
	background: var(--c);
	box-shadow: 0 0 0 2px var(--lab-card);
}

.med {
	position: absolute;
	top: 0.1rem;
	bottom: 0.1rem;
	width: 2px;
	translate: -50% 0;
	background: var(--gray-0);
}

.val {
	font-family: var(--font-mono);
	font-size: 0.8rem;
	text-align: right;
}

.ticks {
	font-family: var(--font-mono);
	font-size: 0.6rem;
	color: var(--lab-edge-text);
}

.scale {
	position: relative;
	height: 0.9rem;
}

.scale i {
	position: absolute;
	translate: -50% 0;
	font-style: normal;
}

.unit {
	text-align: right;
}

.tip {
	position: absolute;
	bottom: calc(100% + 4px);
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

@media (max-width: 40em) {
	li,
	.ticks {
		grid-template-columns: minmax(5rem, 7rem) minmax(0, 1fr) 2.6rem;
		gap: 0.5rem;
	}
}
</style>
