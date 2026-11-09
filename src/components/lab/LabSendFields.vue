<template>
	<fieldset class="send">
		<legend class="sr-only">How it’s going to the lab</legend>
		<div class="seg" role="radiogroup" aria-label="How it’s going to the lab">
			<button
				v-for="(label, key) in DELIVERY"
				:key="key"
				type="button"
				role="radio"
				class="seg-btn"
				:data-delivery="key"
				:aria-checked="model.delivery === key"
				@click="model.delivery = key"
			>
				{{ label }}
			</button>
		</div>
		<label v-if="model.delivery === 'mail'" class="lab-field">
			<span>Tracking number <small>(optional)</small></span>
			<input :id="`${uid}-track`" v-model="model.tracking" class="lab-input mono" type="text" maxlength="60" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="9400 1000 0000 0000 0000 00" />
			<small v-if="carrier" class="lab-hint">Looks like {{ carrier }}.</small>
		</label>
		<div class="prints">
			<label class="check">
				<input :id="`${uid}-prints`" v-model="model.printsIncluded" type="checkbox" />
				<span>Price includes prints</span>
			</label>
			<label v-if="!model.printsIncluded" class="lab-field prints-cost">
				<span>Prints ($) <small>(if you ordered them)</small></span>
				<input :id="`${uid}-prints-cost`" v-model="model.printsCost" class="lab-input" type="number" min="0" step="0.01" inputmode="decimal" />
			</label>
		</div>
	</fieldset>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

import { DELIVERY, type Delivery } from '../../lib/lab/inventory';
import { carrierOf } from '../../lib/lab/tracking';

export interface SendDraft {
	delivery: Delivery;
	tracking: string;
	printsIncluded: boolean;
	printsCost: string | number;
}

const model = defineModel<SendDraft>({ required: true });
const uid = useId();
const carrier = computed(() => {
	const n = model.value.tracking.replace(/[\s-]+/g, '');
	if (n.length < 8) return '';
	const c = carrierOf(n).name;
	return c === 'Tracking' ? '' : c;
});
</script>

<style scoped>
.send {
	display: grid;
	gap: 0.85rem;
	margin: 0;
	padding: 0;
	border: 0;
	min-width: 0;
}

.seg {
	display: inline-flex;
	justify-self: start;
	padding: 0.2rem;
	border: 1px solid var(--gray-800);
	border-radius: 999px;
	background: color-mix(in oklch, var(--gray-999) 70%, transparent);
}

.seg-btn {
	min-height: 2.4rem;
	padding: 0.3rem 1rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.seg-btn[aria-checked='true'] {
	background: var(--gray-0);
	color: var(--gray-999);
}

.seg-btn:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.mono {
	font-family: var(--font-mono);
	letter-spacing: 0.04em;
}

.prints {
	display: grid;
	gap: 0.6rem;
}

.check {
	display: inline-flex;
	align-items: center;
	gap: 0.55rem;
	font-size: var(--text-sm);
	cursor: pointer;
}

.check input {
	width: 1.1rem;
	height: 1.1rem;
	accent-color: var(--accent-regular);
}

.prints-cost {
	max-width: 14rem;
}

small {
	color: var(--gray-300);
	font-weight: 400;
}
</style>
