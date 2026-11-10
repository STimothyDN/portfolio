<script setup lang="ts">
/**
 * A camera on the bench, seen from above and behind: the top plate (brushed
 * chrome by day, black paint at night) with its engraved name and frame
 * counter, and the back with the memo holder and the film across the gate.
 * Empty, its back hangs open and the counter sits on S, ready for a canister.
 */
import { computed } from 'vue';

import { canisterColors } from '../../film/canister';
import FilmCanister from '../../film/FilmCanister.vue';
import FrameCounter from '../FrameCounter.vue';
import { ratingLine, type RollView } from '../../../lib/lab/inventory';

const props = withDefaults(
	defineProps<{
		name: string;
		kind?: string;
		roll?: RollView | null;
		/** Seconds before the counter winds up. */
		delay?: number;
		/** 'compact' on the bench, 'full' where there's room. */
		size?: 'compact' | 'full';
	}>(),
	{ kind: 'point-and-shoot', roll: null, delay: 0.35, size: 'compact' }
);

const colors = computed(() =>
	props.roll ? canisterColors({ stock: props.roll.stock.token ?? props.roll.stock.id, stockLabel: props.roll.stock.name, stockBrand: props.roll.stock.brand }) : null
);
const frames = computed(() => Math.min(props.roll?.exposures ?? 36, 40));
</script>

<template>
	<span class="cam-top" :class="[size, { empty: !roll }]" :data-kind="kind" :style="colors ? { '--can': colors.can, '--can-ink': colors.ink } : undefined">
		<span class="plate">
			<span class="engraved">{{ name }}</span>
			<FrameCounter :count="roll ? roll.frameCount : -2" :exposures="roll?.exposures ?? 36" :delay="delay" />
		</span>
		<span class="back">
			<template v-if="roll">
				<span class="memo">
					<span class="box-end">
						<b>{{ roll.stock.name }}</b>
						<i>{{ ratingLine(roll) || roll.stock.process }}</i>
					</span>
					<span class="tape">{{ roll.code }}</span>
				</span>
				<span class="gate">
					<FilmCanister :stock="roll.stock.token ?? roll.stock.id" :stock-label="roll.stock.name" :stock-brand="roll.stock.brand" />
					<span class="film">
						<i v-for="n in frames" :key="n" :class="{ shot: n <= roll.frameCount, next: n === roll.frameCount + 1 }"></i>
					</span>
					<span class="takeup"></span>
				</span>
			</template>
			<span v-else class="gate open">
				<span class="rails"></span>
				<span class="takeup"></span>
			</span>
		</span>
	</span>
</template>

<style scoped>
.cam-top {
	--plate: linear-gradient(180deg, oklch(94% 0.004 80), oklch(83% 0.006 80) 48%, oklch(89% 0.005 80) 52%, oklch(77% 0.008 75));
	--plate-ink: oklch(30% 0.01 60);
	--plate-shine: oklch(100% 0 0 / 0.65);
	position: relative;
	display: grid;
	width: 100%;
	border-radius: 0.8rem 0.8rem 0.6rem 0.6rem;
	background:
		radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.06) 0.7px, transparent 1.1px) 0 0 / 3px 3px,
		radial-gradient(circle at 2px 2px, oklch(0% 0 0 / 0.35) 0.8px, transparent 1.2px) 0 0 / 4px 4px,
		linear-gradient(180deg, oklch(24% 0.006 60), oklch(19% 0.006 60));
	color: oklch(94% 0.01 80);
	box-shadow:
		0 1px 0 oklch(100% 0 0 / 0.08) inset,
		var(--lab-lift-1);
}

:root.theme-dark .cam-top {
	--plate: linear-gradient(180deg, oklch(30% 0.004 60), oklch(19% 0.004 60) 50%, oklch(23% 0.004 60));
	--plate-ink: oklch(93% 0.006 80);
	--plate-shine: oklch(100% 0 0 / 0.12);
}

.plate {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.35rem 0.5rem 0.3rem 0.75rem;
	border-radius: 0.8rem 0.8rem 0 0;
	background:
		repeating-linear-gradient(90deg, oklch(100% 0 0 / 0.05) 0 1px, transparent 1px 3px),
		var(--plate);
	box-shadow:
		0 1px 0 var(--plate-shine) inset,
		0 -1px 0 rgb(0 0 0 / 0.25) inset,
		0 3px 6px -3px rgb(0 0 0 / 0.6);
}

.plate :deep(svg) {
	width: 3.2rem;
	height: auto;
	flex: none;
}

.engraved {
	min-width: 0;
	font-family: var(--font-mono);
	font-size: 0.78rem;
	font-weight: 600;
	letter-spacing: 0.14em;
	line-height: 1.15;
	font-variant-caps: all-small-caps;
	color: var(--plate-ink);
	text-shadow: 0 1px 0 var(--plate-shine);
	overflow-wrap: anywhere;
}

.back {
	display: grid;
	gap: 0.4rem;
	padding: 0.45rem 0.5rem 0.5rem;
}

.memo {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	min-width: 0;
}

.box-end {
	display: grid;
	min-width: 0;
	padding: 0.22rem 0.45rem 0.25rem;
	border-radius: 2px;
	background: linear-gradient(180deg, color-mix(in oklch, var(--can) 100%, white 12%), var(--can));
	color: var(--can-ink);
	box-shadow:
		0 0 0 2px oklch(14% 0.004 60),
		0 0 0 3px oklch(40% 0.006 60);
	rotate: -0.6deg;
}

.box-end b {
	font-family: var(--font-brand);
	font-size: 0.66rem;
	font-weight: 700;
	letter-spacing: 0.03em;
	line-height: 1.15;
	font-variant-caps: all-small-caps;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.box-end i {
	font-family: var(--font-mono);
	font-size: 0.55rem;
	font-style: normal;
	opacity: 0.85;
	white-space: nowrap;
}

.tape {
	flex: none;
	padding: 0.2rem 0.4rem 0.16rem;
	background: linear-gradient(180deg, oklch(92% 0.035 88 / 0.95), oklch(88% 0.04 85 / 0.95));
	color: oklch(22% 0.01 60);
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 0.78rem;
	line-height: 1;
	white-space: nowrap;
	clip-path: polygon(2% 8%, 24% 6%, 58% 7%, 91% 5%, 100% 1%, 98% 92%, 72% 94%, 37% 95%, 0 100%);
	rotate: 2.5deg;
}

.gate {
	--can-h: 34px;
	display: flex;
	align-items: center;
	min-height: 2.6rem;
	padding: 0.25rem 0.35rem;
	border-radius: 0.3rem;
	background: linear-gradient(180deg, oklch(13% 0.004 60), oklch(16% 0.004 60) 50%, oklch(13% 0.004 60));
	box-shadow: inset 0 2px 6px rgb(0 0 0 / 0.7);
}

.gate :deep(.canister) {
	z-index: 1;
	flex: none;
}

.film {
	position: relative;
	flex: 1;
	display: flex;
	gap: 1px;
	margin-left: -3px;
	padding: 7px 4px 7px 6px;
	background: var(--lab-film);
}

.film::before,
.film::after {
	content: '';
	position: absolute;
	inset-inline: 6px 3px;
	height: 2px;
	background: repeating-linear-gradient(90deg, oklch(80% 0.01 80) 0 3px, transparent 3px 6px);
	opacity: 0.7;
}

.film::before {
	top: 2px;
}

.film::after {
	bottom: 2px;
}

.film i {
	position: relative;
	flex: 1;
	height: 12px;
	border-radius: 1px;
	background: var(--lab-film-frame);
}

.film i.shot {
	background: linear-gradient(180deg, oklch(66% 0.13 58), oklch(56% 0.12 50));
}

.film i.next {
	box-shadow: inset 0 0 0 1px oklch(95% 0.02 85);
}

.takeup {
	flex: none;
	width: 10px;
	height: 34px;
	margin-left: -1px;
	border-radius: 3px;
	background:
		repeating-linear-gradient(180deg, oklch(55% 0.005 70) 0 3px, oklch(32% 0.005 70) 3px 6px),
		oklch(40% 0.005 70);
}

/* Empty: the back hangs open, rails and pressure plate showing. */
.gate.open {
	justify-content: space-between;
	background:
		linear-gradient(90deg, transparent 0 18%, oklch(30% 0.004 60) 18% 82%, transparent 82%),
		linear-gradient(180deg, oklch(13% 0.004 60), oklch(17% 0.004 60));
}

.rails {
	flex: 1;
	height: 1.6rem;
	margin-inline: 1.2rem 0.6rem;
	border-block: 2px solid oklch(48% 0.006 60);
	opacity: 0.8;
}

.empty .back {
	opacity: 0.85;
}

.full .engraved {
	font-size: 0.95rem;
}

.full .plate :deep(svg) {
	width: 4rem;
}

@media (prefers-reduced-motion: no-preference) {
	/* The film draws out of the canister as it appears. */
	.film {
		animation: draw-out 1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: 0.2s;
	}

	@keyframes draw-out {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
}
</style>
