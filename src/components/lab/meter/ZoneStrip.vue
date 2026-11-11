<script setup lang="ts">
/**
 * The Zone System scale, 0 to X, with what the film holds shaded and where
 * the metered spot, the scene's shadows and its highlights land at this
 * exposure. A list says the same for screen readers.
 */
import { computed } from 'vue';

import { zoneName, type ZoneMark } from '../../../lib/lab/meter/advise';

const props = defineProps<{ marks: ZoneMark[]; toe: number; shoulder: number; film: string }>();

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** −5.5 … +5.5 stops across the strip. */
const pos = (at: number) => Math.max(0, Math.min(100, ((at + 5.5) / 11) * 100));
const band = computed(() => ({ left: `${pos(props.toe)}%`, width: `${pos(props.shoulder) - pos(props.toe)}%` }));
const placed = computed(() =>
	[...props.marks]
		.sort((a, b) => a.at - b.at)
		.map((m, i) => ({
			...m,
			left: pos(m.at),
			// Metered above the scale, the others below, so labels don't collide.
			above: m.key === 'metered',
			off: m.at < -5.5 || m.at > 5.5,
			i,
		}))
);
const boundWord = (m: ZoneMark) => (m.bound === 'at-least' ? ' or brighter' : m.bound === 'at-most' ? ' or darker' : '');
</script>

<template>
	<div class="zs">
		<div class="scale" aria-hidden="true">
			<div class="band" :style="band"></div>
			<span v-for="(r, z) in ROMAN" :key="r" class="cell" :class="{ mid: z === 5, pale: z >= 6 }">{{ r }}</span>
			<span v-for="m in placed" :key="m.key" class="mark" :class="[m.key, { above: m.above, off: m.off, 'edge-l': m.left < 16, 'edge-r': m.left > 84 }]" :style="{ left: `${m.left}%` }">
				<i></i><b>{{ m.label }}</b>
			</span>
		</div>
		<p class="key" aria-hidden="true"><span class="sw"></span>What {{ film }} holds</p>
		<ul class="sr-only">
			<li v-for="m in placed" :key="m.key">{{ m.label }}: {{ zoneName(m.at) }}{{ boundWord(m) }}</li>
			<li>{{ film }} holds {{ zoneName(toe) }} to {{ zoneName(shoulder) }}</li>
		</ul>
	</div>
</template>

<style scoped>
.zs {
	display: grid;
	gap: 0.3rem;
	padding-block: 1.3rem 1.2rem;
}

.scale {
	position: relative;
	display: grid;
	grid-template-columns: repeat(11, 1fr);
	height: 1.6rem;
	border-radius: 0.3rem;
	/* Zone 0 to X, black to white: the scale is the legend. */
	background: linear-gradient(to right, #0d0d0d, #1e1e1e 9%, #383838 18%, #555 27%, #727272 36%, #8f8f8f 45%, #ababab 55%, #c6c6c6 64%, #ddd 73%, #eee 82%, #fafafa 91%);
	box-shadow: inset 0 0 0 1px var(--shoot-line);
}

.band {
	position: absolute;
	top: -0.25rem;
	bottom: -0.25rem;
	border: 1.5px solid var(--shoot-ink);
	border-radius: 0.35rem;
	pointer-events: none;
}

.cell {
	display: grid;
	place-items: center;
	font-family: var(--font-mono);
	font-size: 0.58rem;
	color: #f2f2f2;
}

.cell.pale {
	color: #161616;
}

.cell.mid {
	font-weight: 700;
}

.mark {
	position: absolute;
	top: 100%;
	display: grid;
	justify-items: center;
	translate: -50% 0;
	white-space: nowrap;
}

.mark i {
	width: 0;
	height: 0;
	border-inline: 0.3rem solid transparent;
	border-bottom: 0.45rem solid var(--shoot-ink);
	margin-top: 0.15rem;
}

.mark b {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	font-weight: 400;
	color: var(--shoot-meta);
}

.mark.above {
	top: auto;
	bottom: 100%;
}

.mark.above i {
	order: 2;
	border-bottom: 0;
	border-top: 0.45rem solid var(--shoot-mark);
	margin: 0 0 0.15rem;
}

.mark.above b {
	color: var(--shoot-ink);
	font-weight: 600;
}

.mark.shadows {
	translate: -100% 0;
	justify-items: end;
}

.mark.highlights {
	translate: 0 0;
	justify-items: start;
}

/* Near an end of the scale, a label hangs inward so it isn't cut off. */
.mark.edge-l {
	translate: -0.3rem 0;
	justify-items: start;
}

.mark.edge-r {
	translate: calc(-100% + 0.3rem) 0;
	justify-items: end;
}

.mark.off b::after {
	content: ' ›';
}

.mark.shadows.off b::after {
	content: '';
}

.mark.shadows.off b::before {
	content: '‹ ';
}

.key {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	margin-top: 1.5rem;
	font-size: 0.68rem;
	color: var(--shoot-meta);
}

.sw {
	width: 1rem;
	height: 0.6rem;
	border: 1.5px solid var(--shoot-ink);
	border-radius: 0.2rem;
}
</style>
