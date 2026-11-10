<script setup lang="ts">
/**
 * The light you metered against how dense the negative came back: one dot
 * per logged frame with a scan, x = scene light (EV at ISO 100), y = how far
 * its black point sits above the rest of its roll's. Bands mark the light
 * (night, dim, shade, bright); thin frames are filled, the rest hollow.
 */
import { computed, ref } from 'vue';

const props = defineProps<{ points: { ev: number; black: number; thin: boolean; label: string }[] }>();

const W = 640;
const H = 260;
const P = { l: 40, r: 14, t: 22, b: 30 };
const r2 = (n: number) => Math.round(n * 100) / 100;
const xr = computed(() => {
	const evs = props.points.map((p) => p.ev);
	return [Math.min(4, Math.floor(Math.min(...evs))), Math.max(16, Math.ceil(Math.max(...evs)))];
});
const yr = computed(() => [0, Math.max(0.3, Math.ceil(Math.max(...props.points.map((p) => p.black)) * 10) / 10)]);
const x = (ev: number) => r2(P.l + ((ev - xr.value[0]) / (xr.value[1] - xr.value[0])) * (W - P.l - P.r));
const y = (b: number) => r2(H - P.b - ((b - yr.value[0]) / (yr.value[1] - yr.value[0])) * (H - P.t - P.b));
const bands = computed(() =>
	[
		{ label: 'night', from: xr.value[0], to: 7 },
		{ label: 'dim', from: 7, to: 10 },
		{ label: 'shade', from: 10, to: 13 },
		{ label: 'bright', from: 13, to: xr.value[1] },
	].map((b, i) => ({ ...b, x: x(b.from), w: r2(x(b.to) - x(b.from)), odd: i % 2 }))
);
const hover = ref<number | null>(null);
const evTicks = computed(() => Array.from({ length: Math.floor((xr.value[1] - xr.value[0]) / 2) + 1 }, (_, i) => xr.value[0] + i * 2));
</script>

<template>
	<div class="scatter">
		<svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${points.length} logged frames; ${points.filter((p) => p.thin).length} came back thin`">
			<g class="bands">
				<g v-for="b in bands" :key="b.label">
					<rect :x="b.x" :y="P.t" :width="b.w" :height="H - P.t - P.b" :class="{ odd: b.odd }" />
					<text :x="b.x + b.w / 2" :y="P.t - 8" text-anchor="middle">{{ b.label }}</text>
				</g>
			</g>
			<line :x1="P.l" :x2="W - P.r" :y1="y(0.15)" :y2="y(0.15)" class="flat" />
			<text :x="W - P.r - 2" :y="y(0.15) - 5" text-anchor="end" class="flat-t">flat from here</text>
			<g class="axis">
				<text v-for="t in evTicks" :key="t" :x="x(t)" :y="H - 10" text-anchor="middle">EV {{ t }}</text>
				<text v-for="t in [0, 0.1, 0.2, 0.3].filter((v) => v <= yr[1])" :key="`y${t}`" :x="P.l - 6" :y="y(t) + 3" text-anchor="end">{{ t.toFixed(1) }}</text>
			</g>
			<circle
				v-for="(p, i) in points"
				:key="i"
				:cx="x(p.ev)"
				:cy="y(p.black)"
				:r="hover === i ? 6.5 : 4.5"
				:class="{ thin: p.thin }"
				@pointerenter="hover = i"
				@pointerleave="hover = null"
			/>
		</svg>
		<p class="read" aria-live="polite">
			<template v-if="hover != null">{{ points[hover].label }} · EV {{ points[hover].ev }} · black point {{ points[hover].black.toFixed(2) }}{{ points[hover].thin ? ' · thin' : '' }}</template>
			<template v-else><i class="k thin"></i> came back thin <i class="k"></i> fine · up = flatter than the rest of its roll</template>
		</p>
	</div>
</template>

<style scoped>
.scatter {
	display: grid;
	gap: 0.3rem;
}

svg {
	display: block;
	width: 100%;
	height: auto;
	overflow: visible;
}

.bands rect {
	fill: transparent;
}

.bands rect.odd {
	fill: color-mix(in oklch, var(--gray-800) 45%, transparent);
}

.bands text,
.axis text,
.flat-t {
	font-family: var(--font-mono);
	font-size: 10px;
	fill: var(--lab-edge-text);
}

.flat {
	stroke: var(--lab-warn);
	stroke-dasharray: 4 4;
	opacity: 0.7;
}

circle {
	fill: var(--lab-card);
	stroke: oklch(56% 0.12 245);
	stroke-width: 2;
	transition: r 0.12s ease;
}

circle.thin {
	fill: oklch(66% 0.14 55);
	stroke: var(--lab-card);
	stroke-width: 2;
}

.read {
	min-height: 1.2rem;
	font-size: 0.75rem;
	color: var(--gray-300);
}

.k {
	display: inline-block;
	width: 0.6rem;
	height: 0.6rem;
	margin: 0 0.2rem 0 0.6rem;
	border-radius: 50%;
	border: 2px solid oklch(56% 0.12 245);
	vertical-align: -1px;
}

.k.thin {
	margin-left: 0;
	border-color: transparent;
	background: oklch(66% 0.14 55);
}

@media (max-width: 40em) {
	.bands text,
	.axis text,
	.flat-t {
		font-size: 16px;
	}

	circle {
		r: 7px;
	}
}
</style>
