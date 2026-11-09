<template>
	<div class="rolls">
		<div class="toolbar">
			<div class="filters" role="group" aria-label="Show rolls">
				<button
					v-for="f in filters"
					:key="f.key"
					type="button"
					class="filter"
					:aria-pressed="status === f.key"
					@click="status = f.key"
				>
					{{ f.label }} <span class="n">{{ f.count }}</span>
				</button>
			</div>
			<div class="tools">
				<label class="search">
					<span class="sr-only">Search rolls</span>
					<input id="rolls-search" v-model="query" class="lab-input" type="search" placeholder="Search code, stock, camera, title" />
				</label>
				<a class="lab-btn lab-btn--quiet" href="/photography/lab/labels/">Print labels</a>
				<button type="button" class="lab-btn" @click="adding = true">Add rolls</button>
			</div>
		</div>

		<ul v-if="shown.length" class="list">
			<li v-for="r in shown" :key="r.id">
				<a class="row" :href="`/photography/lab/rolls/${r.code}/`">
					<span class="can" :style="{ '--can-h': '46px' }">
						<FilmCanister :stock="r.stock.token ?? r.stock.id" :stock-label="r.stock.name" :stock-brand="r.stock.brand" />
					</span>
					<span class="main">
						<span class="line1">
							<span class="lab-code">{{ r.code }}</span>
							<span class="title">{{ r.title || r.stock.name }}</span>
						</span>
						<span class="sub">{{ [r.title ? r.stock.name : null, r.camera?.name, r.lab?.name].filter(Boolean).join(' · ') }}</span>
					</span>
					<span class="state">
						<span class="lab-chip" :class="{ 'lab-chip--warn': r.status === 'lost' }">{{ STATUS_LABEL[r.status] }}</span>
						<span class="sub">{{ formatDay(r.statusOn) }}</span>
					</span>
				</a>
			</li>
		</ul>
		<p v-else class="lab-empty">
			{{ rolls.length ? 'No rolls match.' : 'No rolls yet. Add the film in your fridge to get started.' }}
		</p>

		<aside v-if="importable > 0" class="lab-notice desk-note">
			<p>
				{{ importable }} {{ importable === 1 ? 'roll' : 'rolls' }} on the public film desk {{ importable === 1 ? 'isn’t' : 'aren’t' }} linked to
				anything here. Importing makes a “Negatives home” roll for each. To tie scans to a roll you already logged, use its page instead.
			</p>
			<ImportDesk :count="importable" quiet />
		</aside>

		<LabDialog :open="adding" title="Add rolls" @close="adding = false">
			<AddRollsForm v-if="adding" :stocks="stockList" :spots="spots" :shops="shops" :today="today" @done="added" @cancel="adding = false" />
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatDay, STAGES, STATUS_LABEL, type RollStatus, type RollView, type StockView } from '../../lib/lab/inventory';
import FilmCanister from '../film/FilmCanister.vue';
import AddRollsForm from './AddRollsForm.vue';
import ImportDesk from './ImportDesk.vue';
import LabDialog from './LabDialog.vue';

const props = defineProps<{
	rolls: RollView[];
	stocks: StockView[];
	spots: string[];
	shops: string[];
	today: string;
	importable: number;
	initialStatus: string | null;
}>();

const rolls = ref<RollView[]>([...props.rolls]);
const stockList = ref<StockView[]>([...props.stocks]);
const status = ref<string>(props.initialStatus ?? 'all');
const query = ref('');
const adding = ref(false);

const filters = computed(() => {
	const count = (s: RollStatus) => rolls.value.filter((r) => r.status === s).length;
	const list = [
		{ key: 'all', label: 'All', count: rolls.value.length },
		...STAGES.map((s) => ({ key: s as string, label: STATUS_LABEL[s], count: count(s) })),
	];
	const lost = count('lost');
	if (lost) list.push({ key: 'lost', label: STATUS_LABEL.lost, count: lost });
	return list;
});

const shown = computed(() => {
	const q = query.value.trim().toLowerCase();
	return rolls.value
		.filter((r) => status.value === 'all' || r.status === status.value)
		.filter(
			(r) =>
				!q ||
				[r.code, r.title, r.stock.name, r.camera?.name, r.lab?.name, r.storageSpot, r.notes]
					.filter(Boolean)
					.some((v) => v!.toLowerCase().includes(q))
		);
});

function added(newRolls: RollView[], stock: StockView | null) {
	rolls.value = [...newRolls, ...rolls.value].sort((a, b) => b.code.localeCompare(a.code));
	if (stock) stockList.value = [...stockList.value, stock];
	adding.value = false;
	status.value = 'storage';
}
</script>

<style scoped>
.rolls {
	display: grid;
	gap: 1.5rem;
}

.toolbar {
	display: grid;
	gap: 1rem;
}

.filters {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.filter {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-height: 2.25rem;
	padding: 0.3rem 0.85rem;
	border: 1px solid var(--gray-700);
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.filter[aria-pressed='true'] {
	background: var(--accent-regular);
	border-color: var(--accent-regular);
	color: var(--accent-text-over);
}

.filter:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.n {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	opacity: 0.75;
}

.tools {
	display: flex;
	flex-wrap: wrap;
	gap: 0.75rem;
}

.search {
	flex: 1 1 16rem;
}

.list {
	list-style: none;
	padding: 0;
	display: grid;
}

.row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: 1rem;
	padding: 0.7rem 0.5rem;
	border-bottom: 1px solid var(--gray-800);
	color: inherit;
	text-decoration: none;
	border-radius: 0.4rem;
}

.row:hover {
	background: var(--gray-900);
}

.row:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: -2px;
}

.can {
	display: grid;
	place-items: center;
	width: 2.25rem;
}

.main {
	display: grid;
	gap: 0.2rem;
	min-width: 0;
}

.line1 {
	display: flex;
	align-items: baseline;
	gap: 0.75rem;
	min-width: 0;
}

.title {
	color: var(--gray-0);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sub {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--gray-300);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.state {
	display: grid;
	justify-items: end;
	gap: 0.25rem;
}

@media (max-width: 36em) {
	.row {
		grid-template-columns: auto minmax(0, 1fr);
	}

	.state {
		grid-column: 2;
		justify-items: start;
		grid-auto-flow: column;
		justify-content: start;
		align-items: center;
		gap: 0.6rem;
	}
}

.desk-note {
	display: grid;
	gap: 0.85rem;
}
</style>
