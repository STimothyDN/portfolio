<script setup lang="ts">
/**
 * The index card pinned in the middle of the bench: today's date, the light
 * (golden hour, sunset), and at most three things worth doing next, each with
 * its one button. When there's nothing, it says so and gets out of the way.
 */
import { computed, onMounted, ref } from 'vue';

import type { Nudge } from '../../../lib/lab/nudges';
import { sunReport } from '../../../lib/lab/light';

const props = defineProps<{ nudges: Nudge[]; today: string; rewind?: { when: string; title: string; code: string | null } | null; readOnly?: boolean }>();
const emit = defineEmits<{ act: [nudge: Nudge] }>();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateLine = computed(() => {
	const [y, m, d] = props.today.split('-').map(Number);
	const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${DAYS[wd]}, ${MONTHS[m - 1]} ${d}`;
});

// The light where you are: worked out on the device (time zone and place are its own).
const light = ref<string | null>(null);
onMounted(() => {
	try {
		light.value = sunReport(Date.now(), 35.99, -78.9).line;
	} catch {
		light.value = null;
	}
});
</script>

<template>
	<section class="today" aria-labelledby="today-h">
		<span class="pin" aria-hidden="true"></span>
		<header>
			<h2 id="today-h">{{ dateLine }}</h2>
			<p class="light" aria-live="polite">{{ light ?? ' ' }}</p>
		</header>
		<ol v-if="nudges.length" class="list">
			<li v-for="n in nudges" :key="n.key" :class="n.tone">
				<span class="text">{{ n.text }}</span>
				<button v-if="!readOnly" type="button" class="act" @click="emit('act', n)">{{ n.label }}</button>
			</li>
		</ol>
		<p v-else class="clear">{{ readOnly ? 'Nothing waiting today.' : 'Nothing waiting on you. Go shoot something.' }}</p>
		<p v-if="rewind" class="rewind">
			{{ rewind.when }}: <a v-if="rewind.code" :href="`/photography/lab/rolls/${rewind.code}/`">{{ rewind.title }}</a><template v-else>{{ rewind.title }}</template>
		</p>
	</section>
</template>

<style scoped>
.today {
	position: relative;
	display: grid;
	gap: 0.35rem;
	padding: 0.75rem 1.05rem 0.6rem 1.2rem;
	border-radius: 2px;
	container-type: inline-size;
	background: var(--lab-card);
	color: var(--gray-0);
	box-shadow: var(--lab-lift-1);
	rotate: -0.6deg;
}

/* A push pin, top centre, its shadow falling away from the lamp. */
.pin {
	position: absolute;
	top: -0.45rem;
	left: 50%;
	width: 0.9rem;
	height: 0.9rem;
	translate: -50% 0;
	border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, oklch(80% 0.17 28), oklch(52% 0.2 28) 60%, oklch(38% 0.15 28));
	box-shadow: -3px 4px 4px -1px oklch(20% 0.02 60 / 0.35);
}

/* The red rule under the heading, then blue lines (on the list, so they follow the heading's height). */
header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.15rem 1rem;
	padding-bottom: 0.35rem;
	border-bottom: 1.5px solid var(--lab-card-red);
}

h2 {
	font-family: var(--font-brand);
	font-style: italic;
	font-weight: 420;
	font-variation-settings: 'opsz' 60, 'SOFT' 60, 'WONK' 1;
	font-size: 1.2rem;
	line-height: 1.2;
}

.light {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.04em;
	color: var(--lab-edge-text);
}

.list {
	display: grid;
	gap: 0;
	margin: 0;
	padding: 0;
	list-style: none;
	counter-reset: n;
}

.list li + li {
	border-top: 1px solid var(--lab-card-rule);
}

.list li {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-height: 2.6rem;
	padding-block: 0.25rem;
	counter-increment: n;
}

.list li::before {
	content: counter(n);
	flex: none;
	display: grid;
	place-items: center;
	width: 1.25rem;
	height: 1.25rem;
	border: 1.5px solid currentColor;
	border-radius: 50%;
	font-family: var(--font-mono);
	font-size: 0.62rem;
	color: var(--lab-note);
}

.list li.warn::before {
	color: var(--lab-warn);
}

.text {
	flex: 1;
	min-width: 0;
	font-size: 0.9rem;
	line-height: 1.3;
	text-wrap: pretty;
}

.act {
	flex: none;
	min-height: 2.25rem;
	padding: 0.25rem 0.8rem;
	border: 1px solid var(--gray-600);
	border-radius: 999px;
	background: transparent;
	color: var(--gray-0);
	font: inherit;
	font-size: var(--text-sm);
	white-space: nowrap;
	cursor: pointer;
}

.act:hover {
	background: var(--gray-0);
	color: var(--gray-999);
}

.act:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.clear {
	font-style: italic;
	color: var(--gray-200);
	min-height: 2.9rem;
	display: flex;
	align-items: center;
}

.rewind {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.03em;
	color: var(--gray-300);
}

.rewind a {
	color: inherit;
}

/* Pinned in a narrow column (or on a phone): each note, then its button under it. */
@container (max-width: 24rem) {
	.list li {
		flex-wrap: wrap;
		padding-block: 0.45rem;
	}

	.text {
		flex-basis: calc(100% - 1.85rem);
	}

	.act {
		margin-left: 1.85rem;
	}
}
</style>
