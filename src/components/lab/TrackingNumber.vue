<template>
	<span class="track" :class="{ compact }">
		<span v-if="label" class="t-label">{{ label }}</span>
		<a class="t-num" :href="carrier.url" target="_blank" rel="noopener" :title="`Track with ${carrier.name}`">
			<span class="t-carrier">{{ carrier.name }}</span>
			<span class="t-digits">{{ compact ? `…${number.slice(-6)}` : spaced(number) }}</span>
		</a>
		<span v-if="state" class="t-status" :class="state.tone">
			{{ state.label }}<template v-if="!compact && (track?.location || track?.eventAt)"> · {{ [track?.location, when].filter(Boolean).join(', ') }}</template>
		</span>
	</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { carrierOf, spaced, TRACK_STATUS, type TrackView } from '../../lib/lab/tracking';

const props = defineProps<{ number: string; track?: TrackView | null; label?: string; compact?: boolean }>();

const carrier = computed(() => carrierOf(props.number));
const state = computed(() => (props.track?.status ? (TRACK_STATUS[props.track.status] ?? { label: props.track.status, tone: 'info' as const }) : null));
const when = computed(() =>
	props.track?.eventAt ? new Date(props.track.eventAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
);
</script>

<style scoped>
.track {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.6rem;
	min-width: 0;
}

.t-label {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.t-num {
	display: inline-flex;
	gap: 0.4rem;
	font-family: var(--font-mono);
	font-size: 0.78rem;
	color: var(--gray-0);
	text-decoration: underline;
	text-decoration-color: var(--gray-600);
	text-underline-offset: 0.2em;
	overflow-wrap: anywhere;
}

.t-carrier {
	font-weight: 600;
}

.t-status {
	padding: 0.05rem 0.5rem;
	border-radius: 999px;
	background: var(--gray-900);
	font-size: 0.72rem;
	color: var(--gray-200);
}

.t-status.ok {
	color: var(--lab-ok);
}

.t-status.warn {
	color: var(--lab-warn);
}

.t-status.bad {
	color: var(--lab-warn);
	background: color-mix(in oklch, var(--lab-warn) 14%, transparent);
}

.compact .t-num {
	font-size: 0.7rem;
}

.compact .t-status {
	font-size: 0.66rem;
}
</style>
