<template>
	<svg class="dial" viewBox="0 0 320 196" role="group" aria-label="Rolls by film speed">
		<!-- The dial: a knurled outer ring and the speed scale, turned into place on load. -->
		<g class="ring">
			<path :d="arc(R + 16, 180, 360)" class="knurl" />
			<path :d="arc(R, 180, 360)" class="scale" />
			<g v-for="(s, i) in stops" :key="s.iso">
				<line :x1="pt(R - 8, s.angle).x" :y1="pt(R - 8, s.angle).y" :x2="pt(R, s.angle).x" :y2="pt(R, s.angle).y" class="tick" />
				<text :x="pt(R - 20, s.angle).x" :y="pt(R - 20, s.angle).y" class="iso" :class="{ on: s.count }" text-anchor="middle" dominant-baseline="middle">
					{{ s.iso }}
				</text>
				<!-- Spoke: how many rolls at this speed. -->
				<g
					v-if="s.count"
					class="spoke"
					:class="{ picked: active?.kind === 'iso' && active.value === String(s.iso), dim: active?.kind === 'iso' && active.value !== String(s.iso) }"
					role="button"
					tabindex="0"
					:aria-label="`ISO ${s.iso}: ${s.count} ${s.count === 1 ? 'roll' : 'rolls'}`"
					:aria-pressed="active?.kind === 'iso' && active.value === String(s.iso)"
					:style="{ '--i': i }"
					@click="pick(s.iso)"
					@keydown.enter.prevent="pick(s.iso)"
					@keydown.space.prevent="pick(s.iso)"
					@mouseenter="hovered = s.iso"
					@mouseleave="hovered = null"
					@focus="hovered = s.iso"
					@blur="hovered = null"
				>
					<line :x1="pt(R + 4, s.angle).x" :y1="pt(R + 4, s.angle).y" :x2="pt(R + 4 + s.len, s.angle).x" :y2="pt(R + 4 + s.len, s.angle).y" class="bar" pathLength="1" />
					<line :x1="pt(R - 4, s.angle).x" :y1="pt(R - 4, s.angle).y" :x2="pt(R + 50, s.angle).x" :y2="pt(R + 50, s.angle).y" class="hit" />
				</g>
			</g>
		</g>
		<!-- The index mark and the readout in the middle -->
		<path :d="`M ${C.x - 6} ${C.y - R - 30} L ${C.x + 6} ${C.y - R - 30} L ${C.x} ${C.y - R - 21} Z`" class="index" />
		<text :x="C.x" :y="C.y - 14" text-anchor="middle" class="big">{{ focus ? focus.iso : '—' }}</text>
		<text :x="C.x" :y="C.y + 8" text-anchor="middle" class="sub">{{ focusText }}</text>
	</svg>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { ISO_STOPS, isoBucket, type Facet } from '../../lib/lab/almanac';
import type { RollView } from '../../lib/lab/inventory';

const props = defineProps<{ rolls: RollView[]; active: Facet | null }>();
const emit = defineEmits<{ filter: [facet: Facet] }>();

const R = 100;
const C = { x: 160, y: 176 };
const hovered = ref<number | null>(null);

// Rounded so the server's render and the browser's agree to the digit.
const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (r: number, deg: number) => ({ x: r2(C.x + r * Math.cos((deg * Math.PI) / 180)), y: r2(C.y + r * Math.sin((deg * Math.PI) / 180)) });
const arc = (r: number, from: number, to: number) => {
	const a = pt(r, from);
	const b = pt(r, to);
	return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
};

const counts = computed(() => {
	const map = new Map<number, number>();
	for (const r of props.rolls) {
		const b = isoBucket(r.stock.iso);
		if (b) map.set(b, (map.get(b) ?? 0) + 1);
	}
	return map;
});
const max = computed(() => Math.max(1, ...counts.value.values()));
const total = computed(() => [...counts.value.values()].reduce((a, b) => a + b, 0));

/** Speeds spread across the top half of the dial, slowest on the left. */
const stops = computed(() =>
	ISO_STOPS.map((iso, i) => {
		const count = counts.value.get(iso) ?? 0;
		return { iso, count, angle: 192 + (i * 156) / (ISO_STOPS.length - 1), len: count ? 8 + 34 * (count / max.value) : 0 };
	})
);

const top = computed(() => stops.value.reduce((best, s) => (s.count > (best?.count ?? 0) ? s : best), null as (typeof stops.value)[number] | null));
const focus = computed(() => stops.value.find((s) => s.iso === (hovered.value ?? Number(props.active?.kind === 'iso' ? props.active.value : NaN))) ?? top.value);
const focusText = computed(() => {
	const f = focus.value;
	if (!f || !total.value) return 'no film speeds yet';
	return `ISO · ${f.count} ${f.count === 1 ? 'roll' : 'rolls'} · ${Math.round((f.count / total.value) * 100)}%`;
});

function pick(iso: number) {
	emit('filter', { kind: 'iso', value: String(iso), label: `ISO ${iso}` });
}
</script>

<style scoped>
.dial {
	display: block;
	width: 100%;
	max-width: 26rem;
	margin-inline: auto;
	overflow: visible;
}

.knurl {
	fill: none;
	stroke: var(--gray-600);
	stroke-width: 8;
	stroke-dasharray: 1.4 2.6;
}

.scale {
	fill: none;
	stroke: var(--gray-700);
	stroke-width: 1;
}

.tick {
	stroke: var(--gray-500);
	stroke-width: 1.2;
}

.iso {
	font-family: var(--font-mono);
	font-size: 10px;
	fill: var(--gray-500);
}

.iso.on {
	fill: var(--gray-0);
	font-weight: 600;
}

.bar {
	stroke: var(--lab-edge-ink);
	stroke-width: 9;
	stroke-linecap: round;
	transition: stroke 0.2s ease;
}

.hit {
	stroke: transparent;
	stroke-width: 22;
}

.spoke {
	cursor: pointer;
	outline: none;
}

.spoke:hover .bar,
.spoke:focus-visible .bar,
.spoke.picked .bar {
	stroke: var(--gray-0);
}

.spoke.dim .bar {
	opacity: 0.35;
}

.index {
	fill: oklch(58% 0.19 28);
}

.big {
	font-family: var(--font-brand);
	font-size: 34px;
	font-weight: 450;
	fill: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

.sub {
	font-family: var(--font-mono);
	font-size: 9.5px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	fill: var(--gray-300);
}

@media (prefers-reduced-motion: no-preference) {
	.ring {
		transform-origin: 160px 176px;
		animation: turn 1.1s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes turn {
		from {
			rotate: -24deg;
		}
	}

	.bar {
		stroke-dasharray: 1;
		animation: grow 0.8s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.35s + var(--i) * 60ms);
	}

	@keyframes grow {
		from {
			stroke-dashoffset: 1;
		}
	}
}
</style>
