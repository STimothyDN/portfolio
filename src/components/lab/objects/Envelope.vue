<script setup lang="ts">
/**
 * Film at a lab, as the envelope it went in: kraft, the lab's name in marker,
 * the rolls listed on the flap, and a postmark with the day it left. Mailed
 * ones get an airmail border and a stamp; dropped-off ones the lab's order
 * number. Along the bottom, the road to the lab: how far along the usual
 * turnaround the days have come.
 */
import { computed } from 'vue';

import { formatDay } from '../../../lib/lab/inventory';

const props = withDefaults(
	defineProps<{
		lab: string;
		codes: string[];
		sentOn: string;
		delivery?: 'mail' | 'dropoff' | null;
		order?: string | null;
		/** "day 5 of ~8" */
		readout?: string | null;
		/** 0–1+ of the usual turnaround. */
		progress?: number | null;
		late?: boolean;
		/** A blank envelope waiting for film (a drop target). */
		blank?: boolean;
		tilt?: number;
	}>(),
	{ delivery: null, order: null, readout: null, progress: null, late: false, blank: false, tilt: 0 }
);

const postmark = computed(() => formatDay(props.sentOn, false).toUpperCase());
const codesLine = computed(() => (props.codes.length > 3 ? `${props.codes.slice(0, 3).join(', ')} +${props.codes.length - 3}` : props.codes.join(', ')));
</script>

<template>
	<span class="envelope" :class="{ mail: delivery === 'mail', late, blank }" :style="{ '--tilt': `${tilt}deg`, '--p': Math.min(1, progress ?? 0) }">
		<span class="flap" aria-hidden="true"></span>
		<span v-if="!blank && delivery === 'mail'" class="stamp" aria-hidden="true"><i>FILM</i></span>
		<span v-if="!blank" class="postmark" aria-hidden="true">
			<b>{{ postmark }}</b>
		</span>
		<span class="to">{{ lab }}</span>
		<span class="codes">{{ blank ? 'Film for development' : codesLine }}</span>
		<span v-if="!blank && order" class="order">№ {{ order }}</span>
		<span v-if="!blank && progress != null" class="road" aria-hidden="true"><i></i></span>
		<span v-if="!blank && readout" class="readout">{{ readout }}</span>
	</span>
</template>

<style scoped>
.envelope {
	position: relative;
	display: grid;
	align-content: end;
	gap: 0.15rem;
	width: 100%;
	min-height: 6.4rem;
	padding: 1.9rem 0.75rem 0.6rem;
	border-radius: 3px;
	background:
		radial-gradient(120% 90% at 20% 0%, oklch(100% 0 0 / 0.12), transparent 60%),
		repeating-linear-gradient(115deg, oklch(0% 0 0 / 0.02) 0 2px, transparent 2px 5px),
		var(--lab-kraft);
	color: var(--lab-kraft-ink);
	box-shadow: var(--lab-lift-0);
	rotate: var(--tilt);
	overflow: hidden;
}

/* The flap, folded down over the top. */
.flap {
	position: absolute;
	inset: 0 0 auto;
	height: 1.6rem;
	background: linear-gradient(180deg, var(--lab-kraft-deep), color-mix(in oklch, var(--lab-kraft-deep) 70%, var(--lab-kraft)));
	clip-path: polygon(0 0, 100% 0, 100% 35%, 50% 100%, 0 35%);
	box-shadow: 0 2px 2px oklch(0% 0 0 / 0.1);
}

.mail {
	/* Airmail: the red and blue chevrons round the edge. */
	background:
		repeating-linear-gradient(135deg, oklch(55% 0.18 25) 0 6px, transparent 6px 12px, oklch(45% 0.13 255) 12px 18px, transparent 18px 24px) border-box,
		radial-gradient(120% 90% at 20% 0%, oklch(100% 0 0 / 0.12), transparent 60%) padding-box,
		var(--lab-kraft) padding-box;
	border: 4px solid transparent;
}

.stamp {
	position: absolute;
	top: 0.45rem;
	right: 0.55rem;
	display: grid;
	place-items: center;
	width: 1.6rem;
	height: 1.9rem;
	background: oklch(96% 0.01 85);
	outline: 2px dotted oklch(96% 0.01 85);
	outline-offset: -1px;
	box-shadow: 0 1px 1px oklch(0% 0 0 / 0.2);
	rotate: 3deg;
}

.stamp i {
	font-family: var(--font-mono);
	font-size: 0.42rem;
	font-style: normal;
	letter-spacing: 0.05em;
	color: oklch(45% 0.13 255);
	writing-mode: vertical-rl;
}

/* The postmark: a ring with the date, struck at an angle. */
.postmark {
	position: absolute;
	top: 0.35rem;
	right: 2.3rem;
	display: grid;
	place-items: center;
	width: 2.4rem;
	height: 2.4rem;
	border: 1.5px solid oklch(35% 0.04 270 / 0.55);
	border-radius: 50%;
	rotate: -14deg;
}

.envelope:not(.mail) .postmark {
	right: 0.5rem;
}

.postmark b {
	font-family: var(--font-mono);
	font-size: 0.46rem;
	font-weight: 600;
	letter-spacing: 0.04em;
	color: oklch(35% 0.04 270 / 0.75);
}

:root.theme-dark .postmark {
	border-color: oklch(85% 0.03 270 / 0.45);
}

:root.theme-dark .postmark b {
	color: oklch(90% 0.03 270 / 0.7);
}

.to {
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 0.95rem;
	line-height: 1.1;
	overflow-wrap: anywhere;
}

.codes,
.order,
.readout {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.04em;
	opacity: 0.85;
}

.readout {
	opacity: 1;
	font-weight: 600;
}

.late .readout {
	color: var(--lab-warn);
}

:root.theme-dark .late .readout {
	color: oklch(85% 0.13 70);
}

/* Home on the left, the lab on the right; the dot is the roll. */
.road {
	position: relative;
	height: 0.5rem;
	margin-top: 0.2rem;
	background: linear-gradient(90deg, currentColor 50%, transparent 50%) 0 50% / 6px 1px repeat-x;
	opacity: 0.7;
}

.road::before,
.road::after {
	content: '';
	position: absolute;
	top: 50%;
	width: 5px;
	height: 5px;
	translate: 0 -50%;
	border: 1px solid currentColor;
}

.road::before {
	left: 0;
	border-radius: 1px;
}

.road::after {
	right: 0;
	border-radius: 50%;
}

.road i {
	position: absolute;
	top: 50%;
	left: calc(var(--p) * (100% - 8px));
	width: 8px;
	height: 8px;
	translate: 0 -50%;
	border-radius: 50%;
	background: currentColor;
	transition: left 0.8s cubic-bezier(0.22, 1, 0.36, 1);
}

.late .road i {
	background: var(--lab-warn);
}

/* Blank: waiting for film, dashed where the rolls would be listed. */
.blank {
	min-height: 5.2rem;
	background:
		radial-gradient(120% 90% at 20% 0%, oklch(100% 0 0 / 0.14), transparent 60%),
		color-mix(in oklch, var(--lab-kraft) 75%, var(--lab-bench));
	box-shadow: var(--lab-lift-0);
}

.blank .codes {
	opacity: 0.6;
}
</style>
