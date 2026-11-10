<script setup lang="ts">
/**
 * One figure in the almanac: the question it answers, the finding in a
 * sentence (with its numbers and sample size), the chart, and the one thing
 * to do about it. With too little data it says what it needs instead of
 * drawing noise. A table view is a click away for every chart.
 */
import { ref, useId } from 'vue';

defineProps<{
	title: string;
	finding?: string | null;
	/** Shown instead of the chart while there isn't enough to say anything. */
	need?: string | null;
	action?: { href: string; label: string } | null;
	tone?: 'warn' | 'good' | 'info' | null;
	hasTable?: boolean;
	wide?: boolean;
}>();

const id = useId();
const table = ref(false);
</script>

<template>
	<figure class="fig" :class="{ wide }" :aria-labelledby="`${id}-t`">
		<figcaption>
			<h3 :id="`${id}-t`">{{ title }}</h3>
			<p v-if="finding && !need" class="finding" :class="tone">{{ finding }}</p>
		</figcaption>
		<p v-if="need" class="need">{{ need }}</p>
		<template v-else>
			<div v-show="!table" class="plot"><slot /></div>
			<div v-if="hasTable" v-show="table" class="table"><slot name="table" /></div>
			<div class="fig-foot">
				<button v-if="hasTable" type="button" class="lab-link small" :aria-pressed="table" @click="table = !table">{{ table ? 'Chart' : 'Table' }}</button>
				<slot name="legend" />
				<a v-if="action" class="act" :href="action.href">{{ action.label }} <span aria-hidden="true">→</span></a>
			</div>
		</template>
	</figure>
</template>

<style scoped>
.fig {
	position: relative;
	display: grid;
	align-content: start;
	gap: 0.8rem;
	min-width: 0;
	margin: 0;
	padding: 1.1rem 1.2rem 1rem;
	border-radius: 0.8rem;
	background: var(--lab-card);
	box-shadow:
		0 0 0 1px var(--gray-800),
		var(--lab-lift-0);
}

figcaption {
	display: grid;
	gap: 0.35rem;
}

h3 {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	font-variation-settings: 'opsz' 30;
	line-height: 1.2;
	letter-spacing: -0.01em;
	text-wrap: balance;
}

.finding {
	max-width: 46rem;
	font-size: var(--text-base);
	line-height: 1.45;
	color: var(--gray-200);
	text-wrap: pretty;
}

.finding.warn {
	color: var(--gray-0);
	border-left: 3px solid var(--lab-warn);
	padding-left: 0.6rem;
}

.finding.good {
	border-left: 3px solid var(--lab-ok);
	padding-left: 0.6rem;
	color: var(--gray-0);
}

.need {
	display: grid;
	place-items: center;
	min-height: 7rem;
	padding: 1rem;
	border: 1.5px dashed var(--gray-700);
	border-radius: 0.6rem;
	color: var(--gray-300);
	font-size: var(--text-sm);
	text-align: center;
	text-wrap: balance;
}

.plot,
.table {
	position: relative;
	min-width: 0;
}

.table {
	overflow-x: auto;
}

.fig-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem 1rem;
	min-height: 1.5rem;
}

.act {
	margin-left: auto;
	font-size: var(--text-sm);
	color: var(--gray-0);
	text-decoration: underline;
	text-decoration-color: var(--gray-600);
	text-underline-offset: 0.2em;
}

.small {
	font-size: var(--text-sm);
}

.table :deep(table) {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--text-sm);
}

.table :deep(th),
.table :deep(td) {
	padding: 0.35rem 0.5rem;
	border-bottom: 1px solid var(--gray-800);
	text-align: left;
	white-space: nowrap;
}

.table :deep(td.num),
.table :deep(th.num) {
	text-align: right;
	font-family: var(--font-mono);
	font-size: 0.78rem;
}
</style>
