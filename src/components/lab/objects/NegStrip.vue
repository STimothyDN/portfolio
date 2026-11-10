<script setup lang="ts">
/**
 * A cut strip of negatives: film base, sprocket holes, edge print with frame
 * numbers, and in each frame either the scan as a negative (through the film
 * desk's filter for that stock and exposure) or, before scans are linked, a
 * latent frame. `lit` puts it on a light table: the base glows.
 */
import { computed } from 'vue';

import { negativeBaseVars, negativeFilterId, type NegativeProfileKey } from '../../film/negative';

const props = withDefaults(
	defineProps<{
		code: string;
		stock: string;
		profile?: NegativeProfileKey | null;
		scans?: { src: string; exposure: number; keeper?: boolean }[] | null;
		/** Frames to draw when there are no scans. */
		frames?: number;
		lit?: boolean;
		/** Show the scans as positives (prints) instead. */
		positive?: boolean;
		first?: number;
		/** The code on a strip of tape (off where whatever holds the strip shows it). */
		tape?: boolean;
	}>(),
	{ profile: null, scans: null, frames: 6, lit: false, positive: false, first: 1, tape: true }
);

const base = computed(() => (props.profile ? negativeBaseVars(props.profile) : {}));
const cells = computed(() =>
	props.scans?.length
		? props.scans.map((s, i) => ({ n: props.first + i, ...s }))
		: Array.from({ length: props.frames }, (_, i) => ({ n: props.first + i, src: '', exposure: 0, keeper: false }))
);
const edge = computed(() => props.stock.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 18));
</script>

<template>
	<span class="neg-strip" :class="{ lit, positive, latent: !scans?.length }" :style="base">
		<span class="rail top" aria-hidden="true"></span>
		<span class="frames">
			<span v-for="c in cells" :key="c.n" class="cell">
				<span class="edge" aria-hidden="true">{{ c.n }} <i>▸</i> {{ c.n }}A<template v-if="c.n % 3 === 1"> · {{ edge }}</template></span>
				<span class="win">
					<img
						v-if="c.src"
						:src="c.src"
						alt=""
						loading="lazy"
						decoding="async"
						draggable="false"
						:style="!positive && profile ? { filter: `url(#${negativeFilterId(profile, c.exposure)})` } : undefined"
					/>
					<span v-if="c.keeper" class="keeper" aria-hidden="true"></span>
				</span>
			</span>
		</span>
		<span class="rail bottom" aria-hidden="true"></span>
		<span v-if="tape" class="tape">{{ code }}</span>
	</span>
</template>

<style scoped>
.neg-strip {
	--frame: var(--stock-frame, oklch(70% 0.12 55));
	--rail: var(--stock-rail, oklch(64% 0.12 52));
	--ink: var(--stock-ink, oklch(40% 0.1 45));
	position: relative;
	display: grid;
	width: 100%;
	padding-inline: 0.35rem;
	border-radius: 2px;
	background: var(--rail);
	box-shadow: var(--lab-lift-0);
	-webkit-user-select: none;
	user-select: none;
}

.latent {
	--frame: oklch(26% 0.015 50);
	--rail: oklch(20% 0.015 50);
	--ink: oklch(68% 0.12 60);
}

.positive {
	--frame: oklch(14% 0.005 60);
	--rail: oklch(11% 0.005 60);
	--ink: oklch(70% 0.1 65);
}

.rail {
	height: 0.55rem;
	background: repeating-linear-gradient(90deg, color-mix(in oklch, var(--lab-table, white) 92%, transparent) 0 0.32rem, transparent 0.32rem 0.62rem) 0 50% / 100% 0.3rem no-repeat;
	opacity: 0.85;
}

.lit .rail {
	background-image: repeating-linear-gradient(90deg, oklch(99% 0.02 90) 0 0.32rem, transparent 0.32rem 0.62rem);
}

.frames {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(0, 1fr);
	gap: 0.18rem;
}

.cell {
	position: relative;
	display: grid;
	min-width: 0;
}

.edge {
	position: absolute;
	top: -0.62rem;
	left: 0.1rem;
	font-family: var(--font-mono);
	font-size: 0.42rem;
	letter-spacing: 0.08em;
	white-space: nowrap;
	color: var(--ink);
	pointer-events: none;
}

.edge i {
	font-style: normal;
}

.win {
	position: relative;
	display: block;
	aspect-ratio: 3 / 2;
	overflow: hidden;
	border-radius: 1px;
	background: var(--frame);
}

.win img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.latent .win {
	background:
		radial-gradient(70% 60% at 50% 45%, oklch(34% 0.03 55), transparent 75%),
		var(--frame);
}

/* A grease-pencil tick on the frames the scans rate highly. */
.keeper {
	position: absolute;
	inset: 8% 10%;
	border: 2px solid oklch(62% 0.2 28 / 0.85);
	border-radius: 45% 55% 48% 52%;
	rotate: -4deg;
}

.positive .keeper {
	border-color: oklch(85% 0.15 90 / 0.85);
}

.tape {
	position: absolute;
	left: -0.4rem;
	top: -0.75rem;
	padding: 0.14rem 0.38rem 0.1rem;
	background: oklch(93% 0.035 88 / 0.95);
	box-shadow: 0 1px 1px oklch(30% 0.03 60 / 0.25);
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 0.72rem;
	line-height: 1.1;
	color: oklch(20% 0.01 60);
	rotate: -5deg;
	clip-path: polygon(2% 8%, 98% 0, 100% 92%, 1% 100%);
}

/* On the light table: lit from below. */
.lit {
	box-shadow:
		0 0 0 1px oklch(100% 0 0 / 0.25),
		0 0 22px -6px var(--lab-lit-glow);
}
</style>
