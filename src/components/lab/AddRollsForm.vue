<template>
	<StockForm
		v-if="addingStock"
		:brands="brands"
		@saved="stockAdded"
		@cancel="addingStock = false"
	/>
	<form v-else class="lab-form" @submit.prevent="save">
		<label class="lab-field">
			<span>Film stock</span>
			<select id="add-stock" v-model="stockId" class="lab-input lab-select" required>
				<option value="" disabled>Choose a stock</option>
				<optgroup v-for="[brand, list] in grouped" :key="brand" :label="brand">
					<option v-for="s in list" :key="s.id" :value="s.id">{{ s.name }}{{ s.format !== '35mm' ? ` (${s.format})` : '' }}</option>
				</optgroup>
			</select>
			<button type="button" class="lab-link small" @click="addingStock = true">A stock that isn’t listed</button>
		</label>
		<div class="lab-row2">
			<label class="lab-field">
				<span>How many rolls</span>
				<input id="add-qty" v-model="quantity" class="lab-input" type="number" min="1" max="100" required inputmode="numeric" />
			</label>
			<label class="lab-field">
				<span>Expires</span>
				<input id="add-expires" v-model="expires" class="lab-input" type="month" />
			</label>
		</div>
		<div class="lab-row2">
			<label class="lab-field">
				<span>Price per roll ($)</span>
				<input id="add-price" v-model="price" class="lab-input" type="number" min="0" step="0.01" inputmode="decimal" />
			</label>
			<label class="lab-field">
				<span>Bought on</span>
				<input id="add-bought" v-model="purchasedOn" class="lab-input" type="date" :max="today" />
			</label>
		</div>
		<label class="lab-field">
			<span>Bought from</span>
			<input id="add-shop" v-model="purchasedFrom" class="lab-input" type="text" maxlength="120" list="add-shops" />
			<datalist id="add-shops">
				<option v-for="s in shops" :key="s" :value="s" />
			</datalist>
		</label>
		<label class="lab-field">
			<span>Kept in</span>
			<input id="add-spot" v-model="storageSpot" class="lab-input" type="text" maxlength="60" list="add-spots" placeholder="Fridge door" />
			<datalist id="add-spots">
				<option v-for="s in spots" :key="s" :value="s" />
			</datalist>
		</label>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy">Add {{ Number(quantity) || '' }} {{ Number(quantity) === 1 ? 'roll' : 'rolls' }}</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
		</div>
	</form>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, ref } from 'vue';

import { num, run } from '../../lib/lab/client';
import { toCents, type RollView, type StockView } from '../../lib/lab/inventory';
import StockForm from './StockForm.vue';

const props = defineProps<{ stocks: StockView[]; spots: string[]; shops: string[]; today: string; stockId?: string }>();
const emit = defineEmits<{ done: [rolls: RollView[], stock: StockView | null]; cancel: [] }>();

const addingStock = ref(false);
const newStock = ref<StockView | null>(null);
const stockId = ref(props.stockId ?? '');
const quantity = ref<string | number>(1);
const expires = ref('');
const price = ref<string | number>('');
const purchasedOn = ref(props.today);
const purchasedFrom = ref('');
const storageSpot = ref(props.spots[0] ?? '');
const busy = ref(false);
const error = ref('');

const allStocks = computed(() => (newStock.value ? [...props.stocks, newStock.value] : props.stocks));
const brands = computed(() => [...new Set(allStocks.value.map((s) => s.brand))].sort());
const grouped = computed(() => {
	const map = new Map<string, StockView[]>();
	for (const s of [...allStocks.value].sort((a, b) => a.name.localeCompare(b.name))) {
		if (!map.has(s.brand)) map.set(s.brand, []);
		map.get(s.brand)!.push(s);
	}
	return [...map].sort(([a], [b]) => a.localeCompare(b));
});

function stockAdded(s: StockView) {
	newStock.value = s;
	stockId.value = s.id;
	addingStock.value = false;
}

async function save() {
	busy.value = true;
	error.value = '';
	try {
		const rolls = await run(
			actions.lab.addRolls({
				stockId: stockId.value,
				quantity: num(quantity.value) ?? 1,
				expires: expires.value || null,
				purchasedOn: purchasedOn.value || null,
				priceCents: toCents(price.value),
				purchasedFrom: purchasedFrom.value,
				storageSpot: storageSpot.value,
				today: props.today,
			})
		);
		emit('done', rolls, newStock.value);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.small {
	justify-self: start;
	font-size: var(--text-sm);
}
</style>
