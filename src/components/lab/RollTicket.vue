<template>
	<!-- A roll on the line takes the shape it has in the real world at each
	     stage: a strip of film in the camera, a rewound canister, an envelope
	     at the lab, a print once the scans are in, then a glassine sleeve. -->
	<article
		class="ticket"
		:class="{ dragging }"
		:data-roll="roll.id"
		:data-stage="roll.status"
		:data-delivery="roll.labDelivery ?? undefined"
		:style="{ '--c': color, '--c-ink': ink, '--tilt': `${tilt}deg`, '--p': progress }"
		:draggable="canMove"
		@dragstart="onDragStart"
		@dragend="dragging = false"
	>
		<span v-if="roll.status === 'lab'" class="postmark" aria-hidden="true">{{ postmark }}</span>
		<div class="t1">
			<a class="lab-code" :href="`/photography/lab/rolls/${roll.code}/`">{{ roll.code }}</a>
			<button
				v-if="canMove"
				type="button"
				class="next"
				:aria-label="`${stepVerb(next!, roll.labDelivery)}: ${roll.code}`"
				:title="stepVerb(next!, roll.labDelivery)"
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

import { daysBetween, formatComp, formatDays, nextStage, pushPull, STEP_VERB, stepVerb, type RollView } from '../../lib/lab/inventory';
import { TRACK_STATUS, type TrackView } from '../../lib/lab/tracking';
import { canisterColors } from '../film/canister';

const props = defineProps<{ roll: RollView; today: string; usualDays?: number | null; track?: TrackView | null }>();
const emit = defineEmits<{ next: [roll: RollView]; dragstart: [roll: RollView] }>();

const dragging = ref(false);
const next = computed(() => nextStage(props.roll.status));
const canMove = computed(() => next.value !== null && props.roll.status !== 'storage');
const can = computed(() => canisterColors({ stock: props.roll.stock.token ?? props.roll.stock.id, stockLabel: props.roll.stock.name, stockBrand: props.roll.stock.brand }));
const color = computed(() => can.value.can);
const ink = computed(() => can.value.ink);
/** Each print lands a little askew, the same way every time. */
const tilt = computed(() => {
	const h = [...props.roll.code].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 3);
	return Math.round(((h % 7) - 3) * 0.35 * 100) / 100;
});
const progress = computed(() => Math.min(1, props.roll.frameCount / Math.max(1, props.roll.exposures)).toFixed(3));
/** "NOV 4": the day it went in the post (or over the counter). */
const postmark = computed(() => {
	const [y, m, d] = props.roll.statusOn.split('-').map(Number);
	return `${new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()} ${d}`;
});
const days = computed(() => daysBetween(props.roll.statusOn, props.today));

const where = computed(() => {
	const r = props.roll;
	const push = pushPull(r.stock.iso, r.shotAtIso);
	switch (r.status) {
		case 'camera':
			return [r.camera?.name, push ?? (r.shotAtIso ? `ISO ${r.shotAtIso}` : null), formatComp(r.exposureComp)].filter(Boolean).join(' · ');
		case 'shot':
			return [r.camera?.name, push ?? r.stock.process].filter(Boolean).join(' · ');
		case 'lab':
			return [r.lab?.name ?? 'Lab not recorded', r.labDelivery === 'mail' ? 'mailed' : null, r.labOrder ? `#${r.labOrder}` : null].filter(Boolean).join(' · ');
		case 'scanned':
			return [r.lab?.name ?? r.camera?.name, r.labDelivery === 'mail' ? 'negatives in the mail' : null].filter(Boolean).join(' · ');
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
		// Mailed and not there yet: where the envelope is says more than a day count.
		const t = props.track?.status;
		if (t && t !== 'Delivered') {
			const s = TRACK_STATUS[t];
			return { text: s?.label.toLowerCase() ?? t, tone: s?.tone === 'bad' || s?.tone === 'warn' ? 'warn' : undefined, title: props.track?.detail ?? undefined };
		}
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
	--paper: var(--gray-999);
	--t-ink: var(--gray-0);
	--t-dim: var(--gray-300);
	--t-line: var(--gray-700);
	position: relative;
	min-width: 0;
	display: grid;
	gap: 0.3rem;
	padding: 0.65rem 0.75rem 0.7rem 1.35rem;
	border-radius: 0.4rem;
	background: var(--paper);
	color: var(--t-ink);
	/* Lying on the light table: a soft contact shadow. */
	box-shadow:
		0 0 0 1px var(--gray-800),
		0 1px 1px rgb(0 0 0 / 0.06),
		0 6px 14px -10px rgb(0 0 0 / 0.5);
	cursor: default;
	transition:
		box-shadow 0.2s ease,
		translate 0.25s ease,
		rotate 0.25s ease;
}

.ticket:hover {
	translate: 0 -2px;
	rotate: 0deg;
}

/* Just moved here: it turns over into its new shape and catches the light. */
.ticket.arrived {
	animation: arrive 1.2s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes arrive {
	0% {
		scale: 0.2 1;
		box-shadow:
			0 0 0 2px var(--lab-edge-ink),
			0 0 26px -2px var(--lab-lit-glow);
	}
	22% {
		scale: 1.04 1;
	}
	36% {
		scale: 1;
		box-shadow:
			0 0 0 2px var(--lab-edge-ink),
			0 0 26px -2px var(--lab-lit-glow);
	}
}

@media (prefers-reduced-motion: reduce) {
	.ticket.arrived {
		animation: none;
	}
}

.ticket[draggable='true'] {
	cursor: grab;
}

.ticket.dragging {
	opacity: 0.45;
}

/* ---- In the camera: a length of film along the edge, exposed as far as it's shot ---- */
.ticket[data-stage='camera']::before {
	content: '';
	position: absolute;
	inset: 0 auto 0 0;
	width: 0.9rem;
	border-radius: 0.4rem 0 0 0.4rem;
	background:
		repeating-linear-gradient(180deg, oklch(86% 0.01 80) 0 3px, transparent 3px 7px) 2px 0 / 2px 100% no-repeat,
		repeating-linear-gradient(180deg, oklch(86% 0.01 80) 0 3px, transparent 3px 7px) calc(100% - 2px) 0 / 2px 100% no-repeat,
		linear-gradient(180deg, oklch(63% 0.13 56) calc(var(--p) * 100%), oklch(30% 0.02 50) 0) 50% 0 / 4px 100% no-repeat,
		var(--lab-film);
}

/* ---- Shot: the rewound canister, standing by the ticket ---- */
.ticket[data-stage='shot'] {
	padding-left: 1.55rem;
}

.ticket[data-stage='shot']::before {
	content: '';
	position: absolute;
	top: 0.45rem;
	bottom: 0.45rem;
	left: 0.35rem;
	width: 0.85rem;
	border-radius: 2px;
	background:
		linear-gradient(90deg, rgb(0 0 0 / 0.3), rgb(255 255 255 / 0.32) 30%, rgb(255 255 255 / 0.06) 55%, rgb(0 0 0 / 0.35)),
		linear-gradient(180deg, oklch(76% 0.006 80) 0 0.3rem, var(--c) 0.3rem calc(100% - 0.3rem), oklch(76% 0.006 80) calc(100% - 0.3rem));
	box-shadow: 1px 1px 2px rgb(0 0 0 / 0.25);
}

/* ---- At the lab: a kraft envelope, flap down, postmarked ---- */
.ticket[data-stage='lab'] {
	--paper: oklch(82% 0.06 75);
	--t-ink: oklch(24% 0.03 60);
	--t-dim: oklch(36% 0.04 60);
	--t-line: oklch(45% 0.05 60 / 0.6);
	padding: 1.45rem 0.8rem 0.75rem;
	background:
		repeating-linear-gradient(118deg, oklch(60% 0.06 65 / 0.07) 0 1px, transparent 1px 4px),
		repeating-linear-gradient(28deg, oklch(98% 0.03 85 / 0.08) 0 1px, transparent 1px 5px),
		var(--paper);
	box-shadow:
		0 0 0 1px oklch(70% 0.06 70),
		0 1px 1px rgb(0 0 0 / 0.08),
		0 8px 16px -10px rgb(0 0 0 / 0.55);
}

:root.theme-dark .ticket[data-stage='lab'] {
	--paper: oklch(70% 0.06 72);
	--t-ink: oklch(18% 0.02 60);
	--t-dim: oklch(25% 0.03 60);
}

.ticket[data-stage='lab']::before {
	content: '';
	position: absolute;
	inset: 0 0 auto;
	height: 1.15rem;
	border-radius: 0.4rem 0.4rem 0 0;
	background: linear-gradient(180deg, color-mix(in oklch, var(--paper) 88%, black), color-mix(in oklch, var(--paper) 94%, black));
	clip-path: polygon(0 0, 100% 0, 100% 15%, 50% 100%, 0 15%);
	filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.15));
}

/* Mailed: the airmail border. */
.ticket[data-stage='lab'][data-delivery='mail'] {
	box-shadow:
		0 0 0 1px oklch(70% 0.06 70),
		0 8px 16px -10px rgb(0 0 0 / 0.55);
	background:
		repeating-linear-gradient(118deg, oklch(60% 0.06 65 / 0.07) 0 1px, transparent 1px 4px),
		linear-gradient(var(--paper) 0 0) padding-box,
		repeating-linear-gradient(-45deg, oklch(52% 0.19 25) 0 7px, oklch(96% 0.01 85) 7px 12px, oklch(45% 0.14 255) 12px 19px, oklch(96% 0.01 85) 19px 24px) border-box;
	border: 4px solid transparent;
	padding: calc(1.45rem - 4px) calc(0.8rem - 4px) calc(0.75rem - 4px);
}

.ticket[data-stage='lab'][data-delivery='mail']::before {
	inset: 0 0 auto;
	border-radius: 0;
}

.postmark {
	position: absolute;
	right: 0.45rem;
	bottom: 0.4rem;
	display: grid;
	place-items: center;
	width: 2.4rem;
	height: 2.4rem;
	border: 1.5px solid oklch(42% 0.1 25 / 0.55);
	border-radius: 50%;
	color: oklch(42% 0.1 25 / 0.7);
	font-family: var(--font-mono);
	font-size: 0.5rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	line-height: 1;
	rotate: -14deg;
	pointer-events: none;
	box-shadow: inset 0 0 0 2px transparent, inset 0 0 0 3px oklch(42% 0.1 25 / 0.25);
}

/* ---- Scans in: a darkroom print, white border and the carrier's black edge ---- */
.ticket[data-stage='scanned'] {
	--paper: oklch(98.5% 0.006 85);
	--t-ink: oklch(20% 0.01 60);
	--t-dim: oklch(42% 0.012 60);
	--t-line: oklch(70% 0.01 60);
	padding: 0.8rem 0.85rem 0.85rem 0.95rem;
	border-radius: 2px;
	rotate: var(--tilt);
	box-shadow:
		0 1px 1px rgb(0 0 0 / 0.1),
		0 2px 4px -1px rgb(0 0 0 / 0.14),
		0 10px 18px -10px rgb(0 0 0 / 0.45);
}

:root.theme-dark .ticket[data-stage='scanned'] {
	--paper: oklch(92% 0.012 85);
}

.ticket[data-stage='scanned']::before {
	content: '';
	position: absolute;
	inset: 0.3rem;
	border: 1px solid oklch(20% 0.005 60 / 0.75);
	border-radius: 1px;
	pointer-events: none;
}

/* ---- Negatives home: a glassine sleeve, the strips showing through ---- */
.ticket[data-stage='negatives'] {
	padding: 0.85rem 0.8rem 0.7rem;
	background:
		linear-gradient(color-mix(in oklch, var(--gray-999) 84%, transparent), color-mix(in oklch, var(--gray-999) 84%, transparent)),
		repeating-linear-gradient(90deg, oklch(62% 0.12 52) 0 1.6rem, oklch(30% 0.03 45) 1.6rem 1.75rem) 0 32% / 100% 0.95rem no-repeat,
		repeating-linear-gradient(90deg, oklch(64% 0.11 54) 0 1.6rem, oklch(30% 0.03 45) 1.6rem 1.75rem) 0.6rem 72% / 100% 0.95rem no-repeat,
		oklch(86% 0.02 80);
	box-shadow:
		0 0 0 1px color-mix(in oklch, var(--gray-700) 70%, transparent),
		0 1px 1px rgb(0 0 0 / 0.06),
		0 6px 14px -10px rgb(0 0 0 / 0.5);
}

:root.theme-dark .ticket[data-stage='negatives'] {
	background:
		linear-gradient(color-mix(in oklch, var(--gray-999) 80%, transparent), color-mix(in oklch, var(--gray-999) 80%, transparent)),
		repeating-linear-gradient(90deg, oklch(62% 0.12 52) 0 1.6rem, oklch(22% 0.02 45) 1.6rem 1.75rem) 0 32% / 100% 0.95rem no-repeat,
		repeating-linear-gradient(90deg, oklch(64% 0.11 54) 0 1.6rem, oklch(22% 0.02 45) 1.6rem 1.75rem) 0.6rem 72% / 100% 0.95rem no-repeat,
		oklch(30% 0.02 60);
}

/* The sleeve's folded lip. */
.ticket[data-stage='negatives']::before {
	content: '';
	position: absolute;
	inset: 0.38rem 0 auto;
	height: 1px;
	background: color-mix(in oklch, var(--gray-500) 60%, transparent);
	box-shadow: 0 1px 0 color-mix(in oklch, var(--gray-999) 80%, transparent);
}

.t1 {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.lab-code {
	position: relative;
	font-size: 0.9rem;
	color: var(--t-ink);
}

.next {
	position: relative;
	z-index: 1;
	margin-left: auto;
	display: grid;
	place-items: center;
	width: 1.9rem;
	height: 1.9rem;
	border: 1px solid var(--t-line);
	border-radius: 50%;
	background: color-mix(in oklch, var(--paper) 60%, transparent);
	color: var(--t-ink);
	cursor: pointer;
	transition:
		background-color 0.2s ease,
		color 0.2s ease;
}

.next:hover {
	background: var(--t-ink);
	border-color: var(--t-ink);
	color: var(--paper);
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

@media (prefers-reduced-motion: no-preference) {
	.next:hover svg {
		animation: nudge 0.6s ease-in-out infinite alternate;
	}

	@keyframes nudge {
		to {
			translate: 2px 0;
		}
	}
}

.stock {
	position: relative;
	overflow-wrap: anywhere;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	font-size: var(--text-base);
	line-height: 1.25;
	color: var(--t-ink);
}

.where {
	position: relative;
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--t-dim);
	overflow-wrap: anywhere;
}

.where:empty {
	display: none;
}

.lab-chip {
	position: relative;
	justify-self: start;
	max-width: 100%;
	white-space: normal;
	color: var(--t-dim);
	border-color: var(--t-line);
}

.lab-chip--warn {
	color: var(--lab-warn);
	border-color: color-mix(in oklch, var(--lab-warn) 45%, transparent);
}

.ticket:is([data-stage='lab'], [data-stage='scanned']) .lab-chip--warn {
	color: oklch(42% 0.14 45);
	border-color: oklch(42% 0.14 45 / 0.5);
}

.ticket[data-stage='scanned'] .lab-chip--ok {
	color: oklch(38% 0.1 150);
	border-color: oklch(38% 0.1 150 / 0.5);
}
</style>
