<template>
	<div class="rolls">
		<RollsAlmanac
			v-if="rolls.length"
			:rolls="rolls"
			:milestones="milestones"
			:frames="frames"
			:desk-counts="deskCounts"
			:today="today"
			:active="facet"
			@filter="setFacet"
		/>

		<div ref="toolbarEl" class="toolbar">
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

		<p v-if="facet" class="facet" role="status">
			<span>Showing <b>{{ facet.label }}</b> · {{ shown.length }} {{ shown.length === 1 ? 'roll' : 'rolls' }}</span>
			<button type="button" class="lab-link" @click="facet = null">Show all</button>
		</p>

		<TransitionGroup v-if="shown.length" tag="ul" name="row" class="list">
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
						<span class="meter" :class="{ lost: r.status === 'lost' }" :aria-label="`${STATUS_LABEL[r.status]}, ${formatDay(r.statusOn)}`">
							<i v-for="(st, k) in STAGES" :key="st" :class="{ on: k <= stageIndex(r) }" :title="STATUS_LABEL[st]"></i>
						</span>
						<span class="state-text">
							<span class="st">{{ STATUS_LABEL[r.status] }}</span>
							<span class="sub">{{ formatDay(r.statusOn) }}</span>
						</span>
						<span v-if="r.publicRollId || r.frameCount" class="badge">
							{{ r.publicRollId && deskCounts[r.publicRollId] ? `${deskCounts[r.publicRollId]} scans` : `${r.frameCount} frames` }}
						</span>
					</span>
				</a>
			</li>
		</TransitionGroup>
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
import { computed, nextTick, ref } from 'vue';

import { matchesFacet, type Facet, type FrameDigest, type Milestones } from '../../lib/lab/almanac';
import { formatDay, STAGES, STATUS_LABEL, type RollStatus, type RollView, type StockView } from '../../lib/lab/inventory';
import FilmCanister from '../film/FilmCanister.vue';
import AddRollsForm from './AddRollsForm.vue';
import ImportDesk from './ImportDesk.vue';
import LabDialog from './LabDialog.vue';
import RollsAlmanac from './RollsAlmanac.vue';

const props = defineProps<{
	rolls: RollView[];
	stocks: StockView[];
	spots: string[];
	shops: string[];
	today: string;
	importable: number;
	initialStatus: string | null;
	milestones: Milestones;
	frames: FrameDigest[];
	deskCounts: Record<string, number>;
}>();

const facet = ref<Facet | null>(null);
const toolbarEl = ref<HTMLElement | null>(null);
const stageIndex = (r: RollView) => (r.status === 'lost' ? -1 : STAGES.indexOf(r.status));

/** A chart picked something: filter the list and bring it into view if it's off screen. */
async function setFacet(f: Facet | null) {
	facet.value = f;
	if (f) status.value = 'all';
	await nextTick();
	const el = toolbarEl.value;
	if (f && el && el.getBoundingClientRect().top > innerHeight * 0.85) {
		el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
	}
}

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
		.filter((r) => matchesFacet(r, facet.value, props.milestones))
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
	display: flex;
	align-items: center;
	gap: 0.9rem;
}

/* Six segments: how far along the line this roll is. */
.meter {
	display: flex;
	gap: 2px;
}

.meter i {
	width: 0.7rem;
	height: 0.32rem;
	border-radius: 1px;
	background: var(--gray-800);
}

.meter i.on {
	background: var(--lab-edge-ink);
}

.meter.lost i {
	background: repeating-linear-gradient(45deg, var(--lab-warn) 0 2px, transparent 2px 4px);
	opacity: 0.6;
}

.state-text {
	display: grid;
	justify-items: end;
	gap: 0.1rem;
	min-width: 7.5rem;
}

.st {
	font-size: var(--text-sm);
	color: var(--gray-0);
}

.badge {
	min-width: 4.8rem;
	padding: 0.15rem 0.5rem;
	border-radius: 999px;
	background: var(--gray-900);
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--gray-200);
	text-align: center;
}

.facet {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem 1rem;
	padding: 0.65rem 1rem;
	border-radius: 0.6rem;
	background: var(--lab-lit);
	color: oklch(24% 0.01 60);
	box-shadow: 0 0 22px -8px var(--lab-lit-glow);
}

.facet .lab-link {
	color: inherit;
}

/* The list re-files itself: rows slide to their new places. */
.row-move,
.row-enter-active,
.row-leave-active {
	transition:
		transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
		opacity 0.3s ease;
}

.row-enter-from,
.row-leave-to {
	opacity: 0;
	transform: translateX(-12px);
}

.row-leave-active {
	position: absolute;
	width: 100%;
}

.list {
	position: relative;
}

@media (prefers-reduced-motion: reduce) {
	.row-move,
	.row-enter-active,
	.row-leave-active {
		transition: none;
	}
}

@media (max-width: 48em) {
	.row {
		grid-template-columns: auto minmax(0, 1fr);
	}

	.state {
		grid-column: 2;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
	}

	.state-text {
		justify-items: start;
		min-width: 0;
		grid-auto-flow: column;
		gap: 0.6rem;
		align-items: baseline;
	}

	.badge {
		min-width: 0;
	}
}

.desk-note {
	display: grid;
	gap: 0.85rem;
}
</style>
