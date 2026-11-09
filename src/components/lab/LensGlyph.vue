<template>
	<!-- What a lens sees: its horizontal field of view on 35mm, and its iris at the widest aperture. -->
	<svg class="lens-glyph" viewBox="0 0 96 48" role="img" :aria-label="label">
		<g class="fov">
			<path v-if="wide" :d="wedge(wide, 40)" class="wide" />
			<path v-if="tele && tele !== wide" :d="wedge(tele, 40)" class="tele" />
			<circle cx="8" cy="24" r="2" class="eye" />
		</g>
		<g class="iris" transform="translate(76 24)">
			<circle r="13" class="barrel" />
			<polygon :points="irisPoints(10.5)" class="blades" />
			<polygon :points="irisPoints(opening)" class="opening" />
		</g>
	</svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ min: number | null; max: number | null; aperture: number | null }>();

/** Horizontal angle of view on a 36 mm wide frame, in degrees. */
const hfov = (f: number) => (2 * Math.atan(36 / (2 * f)) * 180) / Math.PI;
const wide = computed(() => (props.min ? hfov(props.min) : null));
const tele = computed(() => (props.max ? hfov(props.max) : null));

const r2 = (n: number) => Math.round(n * 100) / 100;
function wedge(deg: number, r: number) {
	const half = Math.min(deg, 150) / 2;
	const a = (half * Math.PI) / 180;
	const x = r2(8 + r * Math.cos(a));
	const y1 = r2(24 - r * Math.sin(a));
	const y2 = r2(24 + r * Math.sin(a));
	return `M8 24 L${x} ${y1} A${r} ${r} 0 0 1 ${x} ${y2} Z`;
}

/** Six-sided opening, wider for faster lenses (f/1.4 nearly fills the barrel). */
const opening = computed(() => Math.max(2.5, Math.min(10, 10 * (1.4 / (props.aperture ?? 4)))));
function irisPoints(r: number) {
	return Array.from({ length: 6 }, (_, i) => {
		const a = ((i * 60 + 30) * Math.PI) / 180;
		return `${r2(r * Math.cos(a))},${r2(r * Math.sin(a))}`;
	}).join(' ');
}

const label = computed(() => {
	const parts = [];
	if (wide.value) parts.push(`${Math.round(wide.value)}° wide${tele.value && tele.value !== wide.value ? ` to ${Math.round(tele.value)}°` : ''}`);
	if (props.aperture) parts.push(`opens to f/${props.aperture}`);
	return parts.join(', ') || 'Lens';
});
</script>

<style scoped>
.lens-glyph {
	display: block;
	width: 5.5rem;
	height: auto;
	flex: none;
	overflow: visible;
}

.wide {
	fill: color-mix(in oklch, var(--lab-edge-ink) 22%, transparent);
	stroke: var(--lab-edge-ink);
	stroke-width: 1;
}

.tele {
	fill: color-mix(in oklch, var(--lab-edge-ink) 45%, transparent);
	stroke: var(--lab-edge-ink);
	stroke-width: 1;
}

.eye {
	fill: var(--gray-0);
}

.barrel {
	fill: var(--gray-900);
	stroke: var(--gray-500);
}

.blades {
	fill: var(--gray-700);
	stroke: var(--gray-500);
	stroke-width: 0.6;
}

.opening {
	fill: color-mix(in oklch, var(--lab-lit) 85%, transparent);
	stroke: var(--gray-400);
	stroke-width: 0.6;
}

@media (prefers-reduced-motion: no-preference) {
	.fov path {
		transform-origin: 8px 24px;
		animation: sweep 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes sweep {
		from {
			scale: 0.1;
			opacity: 0;
		}
	}

	/* The iris opens up to its widest aperture. */
	.opening {
		transform-origin: center;
		transform-box: fill-box;
		animation: open 1s cubic-bezier(0.22, 1, 0.36, 1) both 0.2s;
	}

	@keyframes open {
		from {
			scale: 0.15;
		}
	}
}
</style>
