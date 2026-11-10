<template>
	<!-- The exposure counter on a camera's top plate: a numbered disc seen
	     through a small window, turned so the frames logged sit under the red
	     index mark. It winds up from S as the page opens. -->
	<svg class="counter" viewBox="0 0 64 28" role="img" :aria-label="`Frame counter at ${count}`">
		<defs>
			<clipPath :id="`${uid}-win`">
				<path :d="windowPath" />
			</clipPath>
			<radialGradient :id="`${uid}-glass`" cx="50%" cy="20%" r="80%">
				<stop offset="0" stop-color="#fff" stop-opacity="0.32" />
				<stop offset="0.45" stop-color="#fff" stop-opacity="0.05" />
				<stop offset="1" stop-color="#000" stop-opacity="0.25" />
			</radialGradient>
		</defs>
		<!-- the bezel the window is cut into -->
		<path :d="windowPath" class="bezel" />
		<g :clip-path="`url(#${uid}-win)`">
			<rect x="0" y="0" width="64" height="28" class="disc-bg" />
			<g class="disc" :style="{ '--to': `${-count * STEP}deg`, '--from': `${2 * STEP}deg`, '--d': `${delay}s` }">
				<template v-for="m in marks" :key="m.k">
					<text v-if="m.label" :x="m.x" :y="m.y" :transform="`rotate(${m.a} ${m.x} ${m.y})`" :class="{ s: m.label === 'S' }">{{ m.label }}</text>
					<circle v-else :cx="m.x" :cy="m.y" r="0.9" />
				</template>
			</g>
			<rect x="0" y="0" width="64" height="28" :fill="`url(#${uid}-glass)`" />
		</g>
		<path :d="windowPath" class="rim" />
		<!-- index mark -->
		<path d="M29.4 1.4h5.2L32 5.6z" class="index" />
	</svg>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{ count: number; exposures: number; delay?: number }>(), { delay: 0.3 });

const uid = useId();
/** Degrees of disc per frame. */
const STEP = 9;
/** The disc's centre, below the window, and the radius the numbers sit on. */
const CX = 32;
const CY = 62;
const R = 50;
const round = (n: number) => Math.round(n * 100) / 100;

/** A window shaped like a slice of the ring: wide at the top, a little narrower below. */
const windowPath = (() => {
	const outer = 58;
	const inner = 40;
	const span = 25 * (Math.PI / 180);
	const pt = (r: number, a: number) => `${round(CX + r * Math.sin(a))} ${round(CY - r * Math.cos(a))}`;
	return `M${pt(outer, -span)} A${outer} ${outer} 0 0 1 ${pt(outer, span)} L${pt(inner, span)} A${inner} ${inner} 0 0 0 ${pt(inner, -span)} Z`;
})();

/** S two frames before 0, a dot on every odd frame, numbers on the evens. */
const marks = computed(() => {
	const out: { k: number; x: number; y: number; a: number; label: string }[] = [];
	const last = Math.max(props.exposures, props.count) + 3;
	for (let k = -2; k <= last; k++) {
		const deg = k * STEP;
		const a = deg * (Math.PI / 180);
		const label = k === -2 ? 'S' : k > 0 && k % 2 === 0 ? String(k) : '';
		if (k === -1) continue;
		out.push({ k, x: round(CX + R * Math.sin(a)), y: round(CY - R * Math.cos(a)), a: deg, label });
	}
	return out;
});
</script>

<style scoped>
.counter {
	display: block;
	width: 5.6rem;
	height: auto;
	overflow: visible;
	flex: none;
}

.bezel {
	fill: #0d0c0b;
	stroke: none;
}

.disc-bg {
	fill: #151413;
}

.disc {
	transform-box: view-box;
	transform-origin: 32px 62px;
	rotate: var(--to);
}

.disc text {
	fill: #f2efe8;
	font-family: var(--font-mono);
	font-size: 6.6px;
	font-weight: 600;
	text-anchor: middle;
	dominant-baseline: middle;
}

.disc text.s {
	fill: oklch(66% 0.2 28);
}

.disc circle {
	fill: #cfcac0;
}

.rim {
	fill: none;
	stroke: rgb(255 255 255 / 0.35);
	stroke-width: 0.6;
}

.index {
	fill: oklch(60% 0.22 28);
}

@media (prefers-reduced-motion: no-preference) {
	.disc {
		animation: wind 1.5s var(--d) cubic-bezier(0.3, 0.1, 0.15, 1) backwards;
		/* Loading or finishing a roll on the bench winds it on (or back to S). */
		transition: rotate 1.1s cubic-bezier(0.3, 0.1, 0.15, 1);
	}

	@keyframes wind {
		from {
			rotate: var(--from);
		}
	}
}
</style>
