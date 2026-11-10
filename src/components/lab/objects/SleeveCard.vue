<script setup lang="ts">
/**
 * One roll as a page in the binder: a glassine sleeve with a strip of its
 * best frames showing through (the scans, once they're in), the code on tape,
 * and a rubber stamp saying where it is now.
 */
import { computed } from 'vue';

import { formatDay, STAGES, stageLabel, type RollView } from '../../../lib/lab/inventory';
import NegStrip from './NegStrip.vue';
import type { NegativeProfileKey } from '../../film/negative';

const props = defineProps<{
	roll: RollView;
	strip?: { profile: NegativeProfileKey; scans: { src: string; exposure: number; keeper: boolean }[]; count: number; keepers: number } | null;
	count?: number | null;
}>();

const step = computed(() => (props.roll.status === 'lost' ? -1 : STAGES.indexOf(props.roll.status)));
const sub = computed(() => [props.roll.title ? props.roll.stock.name : null, props.roll.camera?.name, props.roll.lab?.name].filter(Boolean).join(' · '));
</script>

<template>
	<span class="sleeve" :data-stage="roll.status">
		<span class="label">
			<span class="tape">{{ roll.code }}</span>
			<span class="names">
				<b>{{ roll.title || roll.stock.name }}</b>
				<i>{{ sub }}</i>
			</span>
		</span>
		<span class="window">
			<NegStrip :code="roll.code" :stock="roll.stock.name" :profile="strip?.profile ?? null" :scans="strip?.scans ?? null" :frames="6" positive :tape="false" />
		</span>
		<span class="foot">
			<span class="stamp">{{ stageLabel(roll.status, roll.labDelivery) }} · {{ formatDay(roll.statusOn, false) }}</span>
			<span class="meter" :aria-hidden="true"><i v-for="(s, k) in STAGES" :key="s" :class="{ on: k <= step }"></i></span>
			<span v-if="count || strip || roll.frameCount" class="n">{{ count ? `${count} scans` : strip ? `${strip.count} scans` : `${roll.frameCount} frames` }}<template v-if="strip?.keepers"> · {{ strip.keepers }} ★</template></span>
		</span>
	</span>
</template>

<style scoped>
.sleeve {
	position: relative;
	display: grid;
	gap: 0.55rem;
	padding: 0.75rem 0.8rem 0.65rem;
	border-radius: 3px;
	/* Glassine: milky, faintly crinkled, with the stitched edge of a sleeve page. */
	background:
		linear-gradient(90deg, transparent 0.45rem, oklch(80% 0.01 80 / 0.5) 0.45rem 0.5rem, transparent 0.5rem),
		repeating-linear-gradient(160deg, oklch(100% 0 0 / 0.05) 0 3px, transparent 3px 9px),
		oklch(97.5% 0.008 85 / 0.92);
	box-shadow: var(--lab-lift-0);
	color: oklch(22% 0.01 60);
}

:root.theme-dark .sleeve {
	background:
		linear-gradient(90deg, transparent 0.45rem, oklch(40% 0.01 80 / 0.5) 0.45rem 0.5rem, transparent 0.5rem),
		repeating-linear-gradient(160deg, oklch(100% 0 0 / 0.03) 0 3px, transparent 3px 9px),
		oklch(24% 0.01 60 / 0.95);
	color: oklch(93% 0.01 80);
}

.label {
	display: flex;
	align-items: start;
	gap: 0.6rem;
	min-width: 0;
	padding-left: 0.5rem;
}

.tape {
	flex: none;
	padding: 0.18rem 0.42rem 0.12rem;
	background: oklch(92% 0.04 88);
	color: oklch(20% 0.01 60);
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 0.82rem;
	line-height: 1.1;
	rotate: -3deg;
	clip-path: polygon(2% 8%, 98% 0, 100% 92%, 1% 100%);
}

.names {
	display: grid;
	min-width: 0;
}

.names b {
	font-weight: 500;
	line-height: 1.25;
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}

.names i {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	font-style: normal;
	opacity: 0.75;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.window {
	display: block;
	padding: 0.75rem 0.15rem 0.1rem 0.6rem;
}

.foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3rem 0.6rem;
	padding-left: 0.5rem;
}

/* A rubber stamp: inked in the stage's colour, slightly crooked. */
.stamp {
	padding: 0.12rem 0.45rem;
	border: 1.5px solid currentColor;
	border-radius: 3px;
	color: var(--lab-stage-negatives);
	font-family: var(--font-mono);
	font-size: 0.6rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	rotate: -2deg;
	opacity: 0.9;
}

[data-stage='storage'] .stamp {
	color: var(--lab-stage-storage);
}
[data-stage='camera'] .stamp {
	color: var(--lab-stage-camera);
}
[data-stage='shot'] .stamp {
	color: oklch(55% 0.14 70);
}
[data-stage='lab'] .stamp {
	color: var(--lab-stage-lab);
}
[data-stage='scanned'] .stamp {
	color: oklch(55% 0.12 98);
}
[data-stage='lost'] .stamp {
	color: var(--lab-warn);
}

:root.theme-dark [data-stage] .stamp {
	filter: brightness(1.25);
}

.meter {
	display: inline-flex;
	gap: 2px;
}

.meter i {
	width: 0.55rem;
	height: 0.3rem;
	border-radius: 1px;
	background: oklch(70% 0.01 80 / 0.4);
}

.meter i.on {
	background: currentColor;
	opacity: 0.7;
}

.n {
	margin-left: auto;
	font-family: var(--font-mono);
	font-size: 0.64rem;
	opacity: 0.8;
}
</style>
