<script setup lang="ts">
/**
 * The binder: every roll you've logged. On top, the line (each roll's path
 * through your cameras, the lab and back, on one time axis); below, the
 * sheets: a sleeve page per roll with its best frames showing through. The
 * line, the stage tabs and the search all narrow the sheets.
 */
import { computed, nextTick, ref } from 'vue';

import { matchesFacet, type Facet } from '../../../lib/lab/almanac';
import { formatDay, STAGES, STATUS_LABEL, type RollStatus, type RollView, type StockView } from '../../../lib/lab/inventory';
import type { BinderData } from '../../../lib/lab/server/binder';
import { segments } from '../../../lib/lab/stats/pipeline';
import FilmCanister from '../../film/FilmCanister.vue';
import AddRollsForm from '../AddRollsForm.vue';
import ImportDesk from '../ImportDesk.vue';
import LabDialog from '../LabDialog.vue';
import SleeveCard from '../objects/SleeveCard.vue';
import RollLine from './RollLine.vue';

const props = defineProps<{ data: BinderData; initialStatus: string | null }>();

const rolls = ref<RollView[]>([...props.data.rolls]);
const stockList = ref<StockView[]>([...props.data.stocks]);
const status = ref<string>(props.initialStatus ?? 'all');
const query = ref('');
const adding = ref(false);
const view = ref<'sheets' | 'rows'>('sheets');
const window = ref<[string, string] | null>(null);
const facet = ref<Facet | null>(null);
const sheetsEl = ref<HTMLElement | null>(null);

const filters = computed(() => {
	const count = (s: RollStatus) => rolls.value.filter((r) => r.status === s).length;
	const list = [{ key: 'all', label: 'All', count: rolls.value.length }, ...STAGES.map((s) => ({ key: s as string, label: STATUS_LABEL[s], count: count(s) }))];
	const lost = count('lost');
	if (lost) list.push({ key: 'lost', label: STATUS_LABEL.lost, count: lost });
	return list;
});

/** Did this roll's path cross the picked stretch of time? */
const inWindow = (r: RollView) => {
	const w = window.value;
	if (!w) return true;
	return segments(r, props.data.milestones, props.data.today).some((s) => s.stage !== 'storage' && s.from <= w[1] && (s.stage === 'negatives' ? s.from : s.to) >= w[0]);
};

const shown = computed(() => {
	const q = query.value.trim().toLowerCase();
	return rolls.value
		.filter((r) => status.value === 'all' || r.status === status.value)
		.filter((r) => matchesFacet(r, facet.value, props.data.milestones))
		.filter(inWindow)
		.filter((r) => !q || [r.code, r.title, r.stock.name, r.camera?.name, r.lab?.name, r.storageSpot, r.notes].filter(Boolean).some((v) => v!.toLowerCase().includes(q)))
		.sort((a, b) => b.statusOn.localeCompare(a.statusOn) || b.code.localeCompare(a.code));
});

async function setWindow(w: [string, string] | null) {
	window.value = w;
	if (w) status.value = 'all';
}
async function setFacet(f: Facet | null) {
	facet.value = f;
	if (f) status.value = 'all';
	await nextTick();
	sheetsEl.value?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function added(newRolls: RollView[], stock: StockView | null) {
	rolls.value = [...newRolls, ...rolls.value];
	if (stock) stockList.value = [...stockList.value, stock];
	adding.value = false;
	status.value = 'storage';
}
const stageIndex = (r: RollView) => (r.status === 'lost' ? -1 : STAGES.indexOf(r.status));
const filterNote = computed(() => [facet.value?.label, window.value ? `${formatDay(window.value[0], false)} – ${formatDay(window.value[1], false)}` : null].filter(Boolean).join(' · '));
</script>

<template>
	<div class="binder">
		<RollLine v-if="rolls.some((r) => r.status !== 'storage')" :rolls="rolls" :milestones="data.milestones" :today="data.today" :legs="data.legs" :window="window" @window="setWindow" />

		<div ref="sheetsEl" class="toolbar">
			<!-- Index tabs down the binder's edge: one per stage. -->
			<div class="filters" role="group" aria-label="Show rolls">
				<button v-for="f in filters" :key="f.key" type="button" class="filter" :class="`f-${f.key}`" :aria-pressed="status === f.key" @click="status = f.key">
					{{ f.label }} <span class="n">{{ f.count }}</span>
				</button>
			</div>
			<div class="tools">
				<label class="search">
					<span class="sr-only">Search rolls</span>
					<input id="rolls-search" v-model="query" class="lab-input" type="search" placeholder="Search code, film, camera, title" />
				</label>
				<div class="views" role="group" aria-label="Show as">
					<button type="button" :aria-pressed="view === 'sheets'" @click="view = 'sheets'">Sheets</button>
					<button type="button" :aria-pressed="view === 'rows'" @click="view = 'rows'">List</button>
				</div>
				<a class="lab-btn lab-btn--quiet" href="/photography/lab/labels/">Print labels</a>
				<button type="button" class="lab-btn" @click="adding = true">Add rolls</button>
			</div>
		</div>

		<p v-if="filterNote" class="facet" role="status">
			<span>Showing <b>{{ filterNote }}</b> · {{ shown.length }} {{ shown.length === 1 ? 'roll' : 'rolls' }}</span>
			<button type="button" class="lab-link" @click="(facet = null), (window = null)">Show all</button>
		</p>

		<TransitionGroup v-if="shown.length" tag="ul" name="sheet" class="list" :class="view">
			<li v-for="r in shown" :key="r.id" :data-roll="r.id">
				<a class="sheet-link" :href="`/photography/lab/rolls/${r.code}/`">
					<SleeveCard v-if="view === 'sheets'" :roll="r" :strip="data.strips[r.id] ?? null" :count="r.publicRollId ? data.deskCounts[r.publicRollId] ?? null : null" />
					<span v-else class="row">
						<span class="can" :style="{ '--can-h': '40px' }">
							<FilmCanister :stock="r.stock.token ?? r.stock.id" :stock-label="r.stock.name" :stock-brand="r.stock.brand" />
						</span>
						<span class="main">
							<span class="line1"><span class="lab-code">{{ r.code }}</span> <span class="title">{{ r.title || r.stock.name }}</span></span>
							<span class="sub">{{ [r.title ? r.stock.name : null, r.camera?.name, r.lab?.name].filter(Boolean).join(' · ') }}</span>
						</span>
						<span class="meter" :aria-label="`${STATUS_LABEL[r.status]}, ${formatDay(r.statusOn)}`">
							<i v-for="(st, k) in STAGES" :key="st" :class="{ on: k <= stageIndex(r) }"></i>
						</span>
						<span class="state">{{ STATUS_LABEL[r.status] }}<small>{{ formatDay(r.statusOn) }}</small></span>
					</span>
				</a>
			</li>
		</TransitionGroup>
		<p v-else class="lab-empty">{{ rolls.length ? 'No rolls match.' : 'No rolls yet. Add the film in your fridge to get started.' }}</p>

		<aside v-if="data.importable > 0" class="lab-notice desk-note">
			<p>
				{{ data.importable }} {{ data.importable === 1 ? 'roll' : 'rolls' }} on the public film desk {{ data.importable === 1 ? 'isn’t' : 'aren’t' }} linked to anything here.
				Importing files each one in the binder. To tie scans to a roll you already logged, use its page instead.
			</p>
			<ImportDesk :count="data.importable" quiet />
		</aside>


		<LabDialog :open="adding" title="Add rolls" @close="adding = false">
			<AddRollsForm v-if="adding" :stocks="stockList" :spots="data.spots" :shops="data.shops" :today="data.today" @done="added" @cancel="adding = false" />
		</LabDialog>
	</div>
</template>

<style scoped>
.binder {
	display: grid;
	gap: clamp(1.25rem, 3vw, 2rem);
	min-width: 0;
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	justify-content: space-between;
	gap: 0.75rem 1.5rem;
	scroll-margin-top: 1.5rem;
}

/* Index tabs: card-stock tabs in the stage colours, the current one pulled forward. */
.filters {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem;
}

.filter {
	--c: var(--gray-400);
	display: inline-flex;
	align-items: baseline;
	gap: 0.4rem;
	min-height: 2.4rem;
	padding: 0.35rem 0.8rem 0.3rem;
	border: 0;
	border-top: 3px solid var(--c);
	border-radius: 0.45rem 0.45rem 0.15rem 0.15rem;
	background: color-mix(in oklch, var(--c) 10%, var(--lab-card));
	color: var(--gray-0);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
	box-shadow: var(--lab-lift-0);
	transition: translate 0.2s ease;
}

.filter .n {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--gray-300);
}

.filter[aria-pressed='true'] {
	translate: 0 -3px;
	background: color-mix(in oklch, var(--c) 24%, var(--lab-card));
	box-shadow: var(--lab-lift-1);
}

.filter:focus-visible,
.views button:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.f-storage {
	--c: var(--lab-stage-storage);
}
.f-camera {
	--c: var(--lab-stage-camera);
}
.f-shot {
	--c: var(--lab-stage-shot);
}
.f-lab {
	--c: var(--lab-stage-lab);
}
.f-scanned {
	--c: var(--lab-stage-scanned);
}
.f-negatives {
	--c: var(--lab-stage-negatives);
}
.f-lost {
	--c: var(--lab-warn);
}

.tools {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.search {
	flex: 1 1 14rem;
}

.views {
	display: inline-flex;
	padding: 0.18rem;
	border: 1px solid var(--gray-800);
	border-radius: 999px;
}

.views button {
	min-height: 2.2rem;
	padding: 0.2rem 0.85rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.views button[aria-pressed='true'] {
	background: var(--gray-0);
	color: var(--gray-999);
}

.facet {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	font-size: var(--text-sm);
}

.list {
	display: grid;
	margin: 0;
	padding: 0;
	list-style: none;
}

.list.sheets {
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	gap: 1.1rem;
}

.list.rows {
	gap: 0;
}

.sheet-link {
	display: block;
	color: inherit;
	text-decoration: none;
	border-radius: 4px;
	transition:
		translate 0.25s cubic-bezier(0.22, 1, 0.36, 1),
		filter 0.25s ease;
}

@media (hover: hover) {
	.list.sheets .sheet-link:hover {
		translate: 1px -3px;
		filter: drop-shadow(-4px 8px 8px oklch(20% 0.02 60 / 0.16));
	}
}

.sheet-link:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 3px;
}

.row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto auto;
	align-items: center;
	gap: 0.9rem;
	padding: 0.6rem 0.25rem;
	border-bottom: 1px solid var(--gray-800);
}

.row .main {
	display: grid;
	min-width: 0;
}

.row .line1 {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
	min-width: 0;
}

.row .title {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.row .sub,
.row small {
	font-family: var(--font-mono);
	font-size: 0.68rem;
	color: var(--gray-300);
}

.row .state {
	display: grid;
	text-align: right;
	font-size: var(--text-sm);
}

.meter {
	display: inline-flex;
	gap: 2px;
}

.meter i {
	width: 0.7rem;
	height: 0.35rem;
	border-radius: 1px;
	background: var(--gray-800);
}

.meter i.on {
	background: var(--gray-200);
}

@media (max-width: 40em) {
	.row {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}

	.row .meter {
		display: none;
	}
}

.charts summary {
	cursor: pointer;
	font-family: var(--font-brand);
	font-size: var(--text-xl);
	padding-block: 0.5rem;
}

.desk-note {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem 1.5rem;
}

.desk-note p {
	flex: 1 1 22rem;
}

@media (prefers-reduced-motion: no-preference) {
	.sheet-enter-active,
	.sheet-leave-active {
		transition:
			opacity 0.3s ease,
			translate 0.3s ease;
	}

	.sheet-enter-from,
	.sheet-leave-to {
		opacity: 0;
		translate: 0 8px;
	}

	.sheet-leave-active {
		position: absolute;
	}
}
</style>
