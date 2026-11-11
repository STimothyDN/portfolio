<script setup lang="ts">
/**
 * Scans in for a whole envelope at once: the day they arrived (and, for
 * mailed film, the tracking number of the negatives coming back). Linking
 * each roll to its scans on the film desk happens on the roll's page.
 */
import { ref } from 'vue';

import { advanceOrQueue, deviceToday } from '../../../lib/lab/offline';
import type { RollView } from '../../../lib/lab/inventory';

const props = defineProps<{ rolls: RollView[]; today: string }>();
const emit = defineEmits<{ done: [views: RollView[]]; cancel: [] }>();

const picked = ref<string[]>(props.rolls.map((r) => r.id));
const on = ref(typeof window === 'undefined' ? props.today : deviceToday());
const trackingBack = ref('');
const mailed = props.rolls.some((r) => r.labDelivery === 'mail');
const busy = ref(false);
const error = ref('');

async function save() {
	busy.value = true;
	error.value = '';
	try {
		const views: RollView[] = [];
		for (const r of props.rolls.filter((x) => picked.value.includes(x.id))) {
			views.push(
				await advanceOrQueue(
					r,
					{ rollId: r.id, to: 'scanned', on: on.value, ...(r.labDelivery === 'mail' && trackingBack.value ? { trackingBack: trackingBack.value } : {}) },
					{ cameras: {} }
				)
			);
		}
		emit('done', views);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<form class="lab-form" @submit.prevent="save">
		<fieldset v-if="rolls.length > 1" class="rolls">
			<legend class="lab-hint">Which rolls’ scans came in</legend>
			<label v-for="r in rolls" :key="r.id" class="row">
				<input :id="`arrive-${r.id}`" v-model="picked" type="checkbox" :value="r.id" />
				<span class="lab-code">{{ r.code }}</span>
				<span>{{ r.stock.name }}</span>
			</label>
		</fieldset>
		<label class="lab-field">
			<span>Scans arrived on</span>
			<input id="arrive-on" v-model="on" class="lab-input" type="date" required :max="today" />
		</label>
		<label v-if="mailed" class="lab-field">
			<span>Tracking for the negatives coming back (optional)</span>
			<input id="arrive-track" v-model="trackingBack" class="lab-input lab-mono" type="text" maxlength="40" autocomplete="off" />
		</label>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy || !picked.length">Scans arrived</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
		</div>
	</form>
</template>

<style scoped>
fieldset {
	display: grid;
	gap: 0.3rem;
	margin: 0;
	padding: 0;
	border: 0;
}

.row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-height: 2.5rem;
}

.row input {
	width: 1.1rem;
	height: 1.1rem;
}
</style>
