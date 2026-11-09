<template>
	<article
		class="ticket"
		:class="{ dragging }"
		:data-roll="roll.id"
		:style="{ '--c': color }"
		:draggable="canMove"
		@dragstart="onDragStart"
		@dragend="dragging = false"
	>
		<div class="t1">
			<a class="lab-code" :href="`/photography/lab/rolls/${roll.code}/`">{{ roll.code }}</a>
			<button
				v-if="canMove"
				type="button"
				class="next"
				:aria-label="`${STEP_VERB[next!]}: ${roll.code}`"
				:title="STEP_VERB[next!]"
				@click="emit('next', roll)"
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>
			</button>
		</div>
		<p class="stock">{{ roll.title && roll.status !== 'camera' ? roll.title : roll.stock.name }}</p>
		<p class="where">{{ where }}</p>
		<span v-if="chip" class="lab-chip" :class="chip.tone && `lab-chip--${chip.tone}`" :title="chip.title">{{ chip.text }}</span>
	</article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { daysBetween, formatDays, nextStage, pushPull, STEP_VERB, type RollView } from '../../lib/lab/inventory';
import { canisterColors } from '../film/canister';

const props = defineProps<{ roll: RollView; today: string; usualDays?: number | null }>();
const emit = defineEmits<{ next: [roll: RollView]; dragstart: [roll: RollView] }>();

const dragging = ref(false);
const next = computed(() => nextStage(props.roll.status));
const canMove = computed(() => next.value !== null && props.roll.status !== 'storage');
const color = computed(
	() => canisterColors({ stock: props.roll.stock.token ?? props.roll.stock.id, stockLabel: props.roll.stock.name, stockBrand: props.roll.stock.brand }).can
);
const days = computed(() => daysBetween(props.roll.statusOn, props.today));

const where = computed(() => {
	const r = props.roll;
	const push = pushPull(r.stock.iso, r.shotAtIso);
	switch (r.status) {
		case 'camera':
			return [r.camera?.name, push ?? (r.shotAtIso ? `ISO ${r.shotAtIso}` : null)].filter(Boolean).join(' · ');
		case 'shot':
			return [r.camera?.name, push ?? r.stock.process].filter(Boolean).join(' · ');
		case 'lab':
			return [r.lab?.name ?? 'Lab not recorded', r.labOrder ? `#${r.labOrder}` : null].filter(Boolean).join(' · ');
		case 'scanned':
			return r.lab?.name ?? r.camera?.name ?? '';
		case 'negatives':
			return r.negativesAt ?? r.camera?.name ?? '';
		default:
			return r.storageSpot ?? '';
	}
});

// Short: the column already says which stage it's in.
const chip = computed((): { text: string; tone?: 'warn' | 'ok'; title?: string } | null => {
	const r = props.roll;
	if (r.status === 'camera') return { text: formatDays(days.value), title: `Loaded ${formatDays(days.value)} ago` };
	if (r.status === 'lab') {
		const late = props.usualDays != null && days.value > props.usualDays + 1;
		return {
			text: formatDays(days.value),
			tone: late ? 'warn' : undefined,
			title: props.usualDays != null ? `At the lab ${formatDays(days.value)}; usually ${props.usualDays} days` : undefined,
		};
	}
	if (r.status === 'scanned') return r.publicRollId ? { text: '✓ on the desk', tone: 'ok' } : { text: 'scans not linked' };
	if (r.status === 'shot' && days.value > 30) return { text: `${formatDays(days.value)} waiting`, tone: 'warn' };
	return null;
});

function onDragStart(e: DragEvent) {
	dragging.value = true;
	e.dataTransfer?.setData('text/plain', props.roll.id);
	if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	emit('dragstart', props.roll);
}
</script>

<style scoped>
.ticket {
	position: relative;
	min-width: 0;
	display: grid;
	gap: 0.3rem;
	padding: 0.65rem 0.75rem 0.7rem 0.95rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.4rem;
	background: var(--gray-999);
	/* Lying on the light table: a soft contact shadow. */
	box-shadow: 0 1px 1px rgb(0 0 0 / 0.06), 0 6px 14px -10px rgb(0 0 0 / 0.5);
	cursor: default;
	overflow: hidden;
	transition:
		box-shadow 0.2s ease,
		translate 0.2s ease;
}

/* The canister's color, as a strip of leader down the side. */
.ticket::before {
	content: '';
	position: absolute;
	inset: 0 auto 0 0;
	width: 0.3rem;
	background: var(--c);
	box-shadow: inset -1px 0 0 rgb(0 0 0 / 0.15);
}

.ticket:hover {
	translate: 0 -1px;
	box-shadow: 0 1px 1px rgb(0 0 0 / 0.06), 0 10px 20px -10px rgb(0 0 0 / 0.55);
}

/* Just moved here: it catches the light for a moment. */
.ticket.arrived {
	animation: arrive 1.2s ease-out;
}

@keyframes arrive {
	0%,
	30% {
		box-shadow:
			0 0 0 2px var(--lab-edge-ink),
			0 0 26px -2px var(--lab-lit-glow);
	}
}

.ticket[draggable='true'] {
	cursor: grab;
}

.ticket.dragging {
	opacity: 0.45;
}

.t1 {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.lab-code {
	font-size: 0.9rem;
}

.next {
	margin-left: auto;
	display: grid;
	place-items: center;
	width: 1.9rem;
	height: 1.9rem;
	border: 1px solid var(--gray-700);
	border-radius: 50%;
	background: none;
	color: var(--gray-0);
	cursor: pointer;
}

.next:hover {
	background: var(--accent-regular);
	border-color: var(--accent-regular);
	color: var(--accent-text-over);
}

.next:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.next svg {
	width: 0.95rem;
	height: 0.95rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.stock {
	overflow-wrap: anywhere;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	font-size: var(--text-base);
	line-height: 1.25;
	color: var(--gray-0);
}

.where {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--gray-300);
	overflow-wrap: anywhere;
}

.where:empty {
	display: none;
}

.lab-chip {
	justify-self: start;
	max-width: 100%;
	white-space: normal;
}
</style>
