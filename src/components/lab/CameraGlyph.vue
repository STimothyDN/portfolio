<template>
	<!-- A camera as a spec-sheet line drawing: its shape by kind, its mount on the lens, its format underneath. -->
	<svg class="glyph" viewBox="0 0 120 70" aria-hidden="true">
		<g class="body">
			<template v-if="kind === 'slr'">
				<path d="M10 24h100a3 3 0 0 1 3 3v24a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V27a3 3 0 0 1 3-3z" />
				<path d="M44 24l6-13h20l6 13" />
				<path d="M53 15h14" class="thin" />
				<rect x="88" y="19" width="9" height="5" rx="1" />
				<rect x="19" y="19" width="11" height="5" rx="1" />
				<circle cx="60" cy="40" r="14" />
				<circle cx="60" cy="40" r="9" class="thin" />
				<circle cx="60" cy="40" r="4" class="glass" />
			</template>
			<template v-else-if="kind === 'rangefinder'">
				<path d="M10 22h100a3 3 0 0 1 3 3v25a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3z" />
				<rect x="15" y="27" width="15" height="8" rx="1" class="glass" />
				<rect x="86" y="27" width="13" height="8" rx="1" class="glass" />
				<rect x="80" y="17" width="9" height="5" rx="1" />
				<circle cx="55" cy="40" r="12" />
				<circle cx="55" cy="40" r="7" class="thin" />
				<circle cx="55" cy="40" r="3.5" class="glass" />
			</template>
			<template v-else-if="kind === 'tlr'">
				<rect x="40" y="4" width="40" height="52" rx="3" />
				<circle cx="60" cy="18" r="8" />
				<circle cx="60" cy="18" r="4" class="glass" />
				<circle cx="60" cy="40" r="10" />
				<circle cx="60" cy="40" r="5" class="glass" />
				<path d="M40 29h40" class="thin" />
			</template>
			<template v-else-if="kind === 'medium-format'">
				<rect x="22" y="14" width="66" height="42" rx="3" />
				<rect x="88" y="18" width="12" height="34" rx="2" />
				<circle cx="55" cy="35" r="15" />
				<circle cx="55" cy="35" r="9" class="thin" />
				<circle cx="55" cy="35" r="4.5" class="glass" />
			</template>
			<template v-else>
				<!-- point-and-shoot (and anything else): a rounded compact -->
				<rect x="12" y="20" width="96" height="34" rx="12" />
				<rect x="20" y="26" width="16" height="8" rx="2" class="glass" />
				<rect x="44" y="25" width="10" height="7" rx="1.5" class="glass" />
				<path d="M86 20v-3h12v3" />
				<circle cx="72" cy="38" r="11" />
				<circle cx="72" cy="38" r="6" class="thin" />
				<circle cx="72" cy="38" r="2.8" class="glass" />
			</template>
			<text v-if="mountShort" :x="lensX" :y="lensY - lensR - 3" text-anchor="middle" class="mount">{{ mountShort }}</text>
		</g>
		<!-- dimension line: the film it takes -->
		<g class="dim">
			<path d="M10 63h100M10 60v6M110 60v6" />
			<text x="60" y="61" text-anchor="middle">{{ format }}</text>
		</g>
	</svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ kind: string; mount: string | null; format: string }>();

const lens = computed(() => {
	switch (props.kind) {
		case 'slr':
			return [60, 40, 14];
		case 'rangefinder':
			return [55, 40, 12];
		case 'tlr':
			return [60, 40, 10];
		case 'medium-format':
			return [55, 35, 15];
		default:
			return [72, 38, 11];
	}
});
const lensX = computed(() => lens.value[0]);
const lensY = computed(() => lens.value[1]);
const lensR = computed(() => lens.value[2]);
/** "Minolta SR (MD)" → "MD", "Pentax K" → "K", "Canon FD" → "FD". */
const mountShort = computed(() => {
	const m = props.mount?.trim();
	if (!m) return '';
	const paren = m.match(/\(([^)]+)\)/);
	if (paren) return paren[1];
	const last = m.split(/\s+/).at(-1)!;
	return last.length <= 4 ? last : m.slice(0, 4);
});
</script>

<style scoped>
.glyph {
	display: block;
	width: 100%;
	max-width: 9.5rem;
	height: auto;
	overflow: visible;
}

.body > * {
	fill: none;
	stroke: var(--gray-200);
	stroke-width: 1.3;
	stroke-linejoin: round;
	vector-effect: non-scaling-stroke;
}

.body .thin {
	stroke: var(--gray-500);
	stroke-width: 1;
}

.body .glass {
	fill: color-mix(in oklch, var(--lab-edge-ink) 22%, transparent);
	stroke: var(--gray-400);
}

.mount {
	fill: var(--lab-edge-text);
	stroke: none;
	font-family: var(--font-mono);
	font-size: 6.5px;
	letter-spacing: 0.08em;
}

.dim path {
	fill: none;
	stroke: var(--gray-600);
	stroke-width: 0.8;
}

.dim text {
	fill: var(--gray-300);
	paint-order: stroke;
	stroke: var(--gray-999);
	stroke-width: 4px;
	font-family: var(--font-mono);
	font-size: 6.5px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
}

@media (prefers-reduced-motion: no-preference) {
	/* Drawn in, like a pen tracing the spec sheet. */
	.body > *:not(text) {
		stroke-dasharray: 400;
		animation: trace 1.4s ease-out both;
	}

	@keyframes trace {
		from {
			stroke-dashoffset: 400;
		}
	}
}
</style>
