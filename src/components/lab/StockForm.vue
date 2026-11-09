<template>
	<form class="lab-form" @submit.prevent="save">
		<div class="lab-row2">
			<label class="lab-field">
				<span>Brand</span>
				<input id="stock-brand" v-model="f.brand" class="lab-input" type="text" maxlength="60" required placeholder="Kodak" list="stock-brands" />
				<datalist id="stock-brands">
					<option v-for="b in brands" :key="b" :value="b" />
				</datalist>
			</label>
			<label class="lab-field">
				<span>ISO (box speed)</span>
				<input id="stock-iso" v-model="f.iso" class="lab-input" type="number" min="1" max="12800" inputmode="numeric" />
			</label>
		</div>
		<label class="lab-field">
			<span>Name</span>
			<input id="stock-name" v-model="f.name" class="lab-input" type="text" maxlength="120" required placeholder="Kodak Portra 400" />
			<small class="lab-hint">As it should read on the canister. Include the brand if it’s part of the name.</small>
		</label>
		<div class="lab-row2">
			<label class="lab-field">
				<span>Process</span>
				<select id="stock-process" v-model="f.process" class="lab-input lab-select">
					<option v-for="p in PROCESSES" :key="p" :value="p">{{ p }}</option>
				</select>
			</label>
			<label class="lab-field">
				<span>Format</span>
				<select id="stock-format" v-model="f.format" class="lab-input lab-select">
					<option v-for="p in FORMATS" :key="p" :value="p">{{ p }}</option>
				</select>
			</label>
			<label class="lab-field">
				<span>Exposures</span>
				<input id="stock-exposures" v-model="f.exposures" class="lab-input" type="number" min="1" max="100" required />
			</label>
		</div>
		<label class="check">
			<input id="stock-wishlist" v-model="f.wishlist" type="checkbox" />
			<span>On my wishlist (I don’t have any yet)</span>
		</label>
		<label class="lab-field">
			<span>Notes</span>
			<textarea id="stock-notes" v-model="f.notes" class="lab-input" rows="2" maxlength="1000"></textarea>
		</label>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy">{{ stock ? 'Save' : 'Add film stock' }}</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
			<button v-if="stock" type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove">
				{{ confirmDelete ? 'Really delete?' : 'Delete' }}
			</button>
		</div>
	</form>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { reactive, ref } from 'vue';

import { num, run } from '../../lib/lab/client';
import { FORMATS, PROCESSES, type StockView } from '../../lib/lab/inventory';

const props = defineProps<{ stock?: StockView | null; brands?: string[] }>();
const emit = defineEmits<{ saved: [stock: StockView]; deleted: [id: string]; cancel: [] }>();

const f = reactive({
	brand: props.stock?.brand ?? '',
	name: props.stock?.name ?? '',
	iso: (props.stock?.iso ?? '') as string | number,
	process: props.stock?.process ?? 'C-41',
	format: props.stock?.format ?? '35mm',
	exposures: (props.stock?.exposures ?? 36) as string | number,
	wishlist: props.stock?.wishlist ?? false,
	notes: props.stock?.notes ?? '',
});
const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);

async function save() {
	busy.value = true;
	error.value = '';
	try {
		const saved = await run(
			actions.lab.saveStock({
				...(props.stock ? { id: props.stock.id } : {}),
				brand: f.brand,
				name: f.name,
				iso: num(f.iso),
				process: f.process,
				format: f.format,
				exposures: num(f.exposures) ?? 36,
				wishlist: f.wishlist,
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
	if (!props.stock) return;
	if (!confirmDelete.value) {
		confirmDelete.value = true;
		return;
	}
	busy.value = true;
	try {
		await run(actions.lab.deleteStock({ id: props.stock.id }));
		emit('deleted', props.stock.id);
	} catch (e) {
		error.value = (e as Error).message;
		confirmDelete.value = false;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.check {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.check input {
	width: 1.1rem;
	height: 1.1rem;
	accent-color: var(--accent-regular);
}

textarea.lab-input {
	resize: vertical;
}

.push-right {
	margin-left: auto;
}
</style>
