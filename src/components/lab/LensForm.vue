<template>
	<form class="lab-form" @submit.prevent="save">
		<div class="lab-row2">
			<label class="lab-field">
				<span>Brand</span>
				<input id="lens-brand" v-model="f.brand" class="lab-input" type="text" maxlength="60" required placeholder="Minolta" />
			</label>
			<label class="lab-field">
				<span>Mount</span>
				<input id="lens-mount" v-model="f.mount" class="lab-input" type="text" maxlength="60" required list="gear-mounts" placeholder="Minolta SR (MD)" />
			</label>
		</div>
		<label class="lab-field">
			<span>Name</span>
			<input id="lens-name" v-model="f.name" class="lab-input" type="text" maxlength="120" required placeholder="MD Rokkor-X 50mm f/1.7" />
		</label>
		<div class="lab-row2">
			<label class="lab-field"><span>Focal length (mm)</span><input id="lens-fmin" v-model="f.focalMin" class="lab-input" type="number" min="1" max="2000" /></label>
			<label class="lab-field"><span>Zooms to (mm)</span><input id="lens-fmax" v-model="f.focalMax" class="lab-input" type="number" min="1" max="2000" placeholder="Primes: blank" /></label>
			<label class="lab-field"><span>Widest f/</span><input id="lens-ap" v-model="f.maxAperture" class="lab-input" type="number" min="0.7" max="64" step="0.1" /></label>
		</div>
		<div class="lab-row2">
			<label class="lab-field">
				<span>Status</span>
				<select id="lens-status" v-model="f.status" class="lab-input lab-select">
					<option v-for="(label, key) in GEAR_STATUS" :key="key" :value="key">{{ label }}</option>
				</select>
			</label>
			<label class="lab-field"><span>Serial</span><input id="lens-serial" v-model="f.serial" class="lab-input" type="text" maxlength="60" /></label>
		</div>
		<div class="lab-row2">
			<label class="lab-field"><span>Got it on</span><input id="lens-acq" v-model="f.acquiredOn" class="lab-input" type="date" /></label>
			<label class="lab-field"><span>Paid ($)</span><input id="lens-price" v-model="f.price" class="lab-input" type="number" min="0" step="0.01" /></label>
		</div>
		<label class="lab-field"><span>From</span><input id="lens-from" v-model="f.acquiredFrom" class="lab-input" type="text" maxlength="120" /></label>
		<label class="lab-field">
			<span>Notes</span>
			<textarea id="lens-notes" v-model="f.notes" class="lab-input" rows="2" maxlength="2000" placeholder="Haze in the rear element; stiff focus ring"></textarea>
		</label>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy">{{ lens ? 'Save' : 'Add lens' }}</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
			<button v-if="lens" type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove">
				{{ confirmDelete ? 'Really delete?' : 'Delete' }}
			</button>
		</div>
	</form>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { reactive, ref } from 'vue';

import { dollars, num, run } from '../../lib/lab/client';
import { GEAR_STATUS, toCents, type LensView } from '../../lib/lab/inventory';

const props = defineProps<{ lens: LensView | null; mount?: string }>();
const emit = defineEmits<{ saved: [lens: LensView]; deleted: [id: string]; cancel: [] }>();

const l = props.lens;
const f = reactive({
	brand: l?.brand ?? '',
	name: l?.name ?? '',
	mount: l?.mount ?? props.mount ?? '',
	focalMin: (l?.focalMin ?? '') as string | number,
	focalMax: (l?.focalMax ?? '') as string | number,
	maxAperture: (l?.maxAperture ?? '') as string | number,
	serial: l?.serial ?? '',
	acquiredOn: l?.acquiredOn ?? '',
	price: dollars(l?.priceCents) as string | number,
	acquiredFrom: l?.acquiredFrom ?? '',
	status: l?.status ?? 'active',
	notes: l?.notes ?? '',
});
const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);

async function save() {
	busy.value = true;
	error.value = '';
	try {
		const saved = await run(
			actions.lab.saveLens({
				...(l ? { id: l.id } : {}),
				brand: f.brand,
				name: f.name,
				mount: f.mount,
				focalMin: num(f.focalMin),
				focalMax: num(f.focalMax),
				maxAperture: num(f.maxAperture),
				serial: f.serial,
				acquiredOn: f.acquiredOn || null,
				priceCents: toCents(f.price),
				acquiredFrom: f.acquiredFrom,
				status: f.status,
				notes: f.notes,
			})
		);
		emit('saved', saved);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

async function remove() {
	if (!l) return;
	if (!confirmDelete.value) {
		confirmDelete.value = true;
		return;
	}
	busy.value = true;
	try {
		await run(actions.lab.deleteLens({ id: l.id }));
		emit('deleted', l.id);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
textarea.lab-input {
	resize: vertical;
}

.push-right {
	margin-left: auto;
}
</style>
