<template>
	<div class="fridge">
		<div class="topline">
			<p class="lab-meta">
				{{ storage.length }} {{ storage.length === 1 ? 'roll' : 'rolls' }} across {{ stockCount }} {{ stockCount === 1 ? 'stock' : 'stocks' }}<template v-if="forecast?.perMonth && forecast.monthsOfFilm != null">
					· you load about {{ forecast.perMonth }} a month, so that’s {{ formatMonths(forecast.monthsOfFilm) }} of film</template>
			</p>
			<span class="lab-actions">
				<a class="lab-btn lab-btn--quiet" href="/photography/lab/labels/">Print canister labels</a>
				<button type="button" class="lab-btn" @click="openAdd()">Add rolls</button>
			</span>
		</div>

		<p v-if="!storage.length" class="lab-empty">
			The fridge is empty. Add the film you have on hand, and each roll gets a code to write on its canister.
		</p>

		<div v-if="shelves.length || wishlist.length" class="interior">
		<section v-for="shelf in shelves" :key="shelf.spot" class="shelf-wrap" :aria-label="shelf.spot">
			<h2 class="shelf-label">{{ shelf.spot }} <span>{{ shelf.count }}</span></h2>
			<div class="shelf">
				<button
					v-for="g in shelf.groups"
					:key="g.key"
					type="button"
					class="slot"
					:aria-expanded="open === g.key"
					:aria-controls="`grp-${g.key}`"
					@click="open = open === g.key ? null : g.key"
				>
					<span class="can" :style="{ '--can-h': '86px' }">
						<FilmCanister :stock="g.stock.token ?? g.stock.id" :stock-label="g.stock.name" :stock-brand="g.stock.brand" />
					</span>
					<span class="n">×{{ g.rolls.length }}</span>
					<span v-if="g.rolls.some((r) => r.rewoundAtFrame)" class="x warn">partly shot</span>
					<span class="x" :class="{ warn: g.note?.expired, soon: g.note?.soon }">{{ g.note?.text ?? 'no date' }}</span>
					<span v-if="lateIn(g.rolls).length && !g.note?.expired" class="x warn">{{ lateIn(g.rolls).length }} won’t keep</span>
				</button>
			</div>
			<div class="board" aria-hidden="true"></div>

			<template v-for="g in shelf.groups" :key="`d-${g.key}`">
				<div v-if="open === g.key" :id="`grp-${g.key}`" class="group-detail">
					<header class="gd-head">
						<div>
							<h3 class="lab-h2">{{ g.stock.name }}</h3>
							<p class="lab-meta">
								{{ [g.stock.iso ? `ISO ${g.stock.iso}` : null, g.stock.process, g.stock.format].filter(Boolean).join(' · ') }}
							</p>
							<p v-if="forecastText(g.stock.id)" class="lab-meta forecast">{{ forecastText(g.stock.id) }}</p>
						</div>
						<form class="move" @submit.prevent="moveGroup(g.rolls.map((r) => r.id))">
							<input :id="`move-${g.key}`" v-model="moveTo" class="lab-input" type="text" maxlength="60" list="fridge-spots" placeholder="Move all to…" aria-label="Move all of these to" />
							<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy || !moveTo.trim()">Move</button>
						</form>
					</header>
					<ul class="lab-rows">
						<li v-for="r in g.rolls" :key="r.id">
							<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
							<div class="lab-grow">
								<span class="lab-mono">
									{{ expiryNote(r.expires, today)?.text ?? 'no expiry date' }}
									<span v-if="r.rewoundAtFrame" class="lab-chip lab-chip--warn">partly shot · to frame {{ r.rewoundAtFrame }}</span>
									<span v-if="isLate(r) && !expiryNote(r.expires, today)?.expired" class="lab-chip lab-chip--warn" title="At the rate you load this film, you'd reach this roll after its date">expires before you’ll get to it</span>
								</span>
								<span class="lab-meta">{{ [r.priceCents != null ? formatMoney(r.priceCents) : null, r.purchasedFrom, r.purchasedOn ? formatDay(r.purchasedOn) : null].filter(Boolean).join(' · ') }}</span>
							</div>
							<button type="button" class="lab-btn lab-btn--quiet" @click="loadRoll = r">Load into a camera</button>
						</li>
					</ul>
				</div>
			</template>
		</section>

		<section v-if="wishlist.length" class="shelf-wrap" aria-label="Want to try">
			<h2 class="shelf-label">Want to try <span>{{ wishlist.length }}</span></h2>
			<div class="shelf">
				<button v-for="s in wishlist" :key="s.id" type="button" class="slot ghost" :title="`Add rolls of ${s.name}`" @click="openAdd(s.id)">
					<span class="can" :style="{ '--can-h': '86px' }">
						<FilmCanister :stock="s.token ?? s.id" :stock-label="s.name" :stock-brand="s.brand" />
					</span>
					<span class="x">bought some?</span>
				</button>
			</div>
			<div class="board" aria-hidden="true"></div>
		</section>

		</div>

		<datalist id="fridge-spots">
			<option v-for="s in spots" :key="s" :value="s" />
		</datalist>

		<!-- Stock catalogue -->
		<section class="lab-section catalogue" aria-labelledby="stocks-h">
			<header class="cat-head">
				<div>
					<h2 id="stocks-h" class="lab-h2">Film stocks</h2>
					<p class="lab-meta">The kinds of film you shoot. Speed and process feed the push/pull notes and lab slips.</p>
				</div>
				<button type="button" class="lab-btn lab-btn--quiet" @click="editing = 'new'">Add film stock</button>
			</header>
			<div v-if="deskNames.length" class="lab-notice desk-sync">
				<p>
					Named on the film desk but not in your logbook yet: <b>{{ deskNames.join(', ') }}</b>. Adding them keeps the logbook and
					the desk using the same names (any you already added by hand are matched, not duplicated).
				</p>
				<button type="button" class="lab-btn lab-btn--quiet" :disabled="busy" @click="syncNames">
					Add {{ deskNames.length === 1 ? deskNames[0] : `these ${deskNames.length}` }}
				</button>
			</div>
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Stock</th><th>ISO</th><th>Process</th><th>Format</th><th>In fridge</th><th>All rolls</th><th><span class="sr-only">Edit</span></th></tr>
					</thead>
					<tbody>
						<tr v-for="s in stockRows" :key="s.id">
							<td>
								<span class="dot" :style="{ background: colorOf(s) }" aria-hidden="true"></span>
								{{ s.name }}
								<span v-if="s.wishlist" class="lab-chip">wishlist</span>
							</td>
							<td class="num">{{ s.iso ?? '—' }}</td>
							<td>{{ s.process }}</td>
							<td>{{ s.format }}</td>
							<td class="num">{{ s.inFridge || '' }}</td>
							<td class="num">{{ s.total || '' }}</td>
							<td><button type="button" class="lab-link" @click="editing = s.id">Edit</button></td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>

		<LabDialog :open="adding" title="Add rolls" @close="adding = false">
			<AddRollsForm v-if="adding" :key="addStockId" :stocks="stockList" :spots="spots" :shops="shops" :today="today" :stock-id="addStockId" @done="added" @cancel="adding = false" />
		</LabDialog>
		<LabDialog :open="!!editing" :title="editing === 'new' ? 'Add film stock' : 'Edit film stock'" @close="editing = null">
			<StockForm v-if="editing" :key="editing" :stock="editingStock" :brands="brands" @saved="stockSaved" @deleted="stockDeleted" @cancel="editing = null" />
		</LabDialog>
		<LabDialog :open="!!loadRoll" title="Load into a camera" @close="loadRoll = null">
			<StepForm v-if="loadRoll" :key="loadRoll.id" :roll="loadRoll" to="camera" :choices="choices" :today="today" @done="loaded" @cancel="loadRoll = null" />
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, ref } from 'vue';

import { run, upsert } from '../../lib/lab/client';
import { expiryNote, formatDay, formatMoney, type RollView, type StepChoices, type StockView } from '../../lib/lab/inventory';
import { formatMonths, type StockForecast } from '../../lib/lab/pace';
import { canisterColors } from '../film/canister';
import FilmCanister from '../film/FilmCanister.vue';
import AddRollsForm from './AddRollsForm.vue';
import LabDialog from './LabDialog.vue';
import StepForm from './StepForm.vue';
import StockForm from './StockForm.vue';

const props = defineProps<{
	storage: RollView[];
	stocks: StockView[];
	totals: Record<string, number>;
	choices: StepChoices;
	shops: string[];
	deskNames: string[];
	today: string;
	forecast?: { byStock: Record<string, StockForecast>; perMonth: number; monthsOfFilm: number | null };
}>();

const late = computed(() => new Set(Object.values(props.forecast?.byStock ?? {}).flatMap((f) => f.late)));
const isLate = (r: RollView) => late.value.has(r.id);
const lateIn = (rolls: RollView[]) => rolls.filter(isLate);
function forecastText(stockId: string): string {
	const f = props.forecast?.byStock[stockId];
	if (!f) return '';
	if (!f.perMonth) return 'Not loaded in the last six months.';
	const rate = f.perMonth >= 0.95 ? `about ${Math.round(f.perMonth)} a month` : `about one every ${Math.round(1 / f.perMonth)} months`;
	return `You load ${rate}: ${f.monthsLeft != null ? `these last about ${formatMonths(f.monthsLeft)}` : ''}${f.late.length ? `, but ${f.late.length} will pass ${f.late.length === 1 ? 'its' : 'their'} date first` : ''}.`;
}

const storage = ref<RollView[]>([...props.storage]);
const deskNames = ref<string[]>([...props.deskNames]);
const stockList = ref<StockView[]>([...props.stocks]);
const totals = ref<Record<string, number>>({ ...props.totals });
const open = ref<string | null>(null);
const adding = ref(false);
const addStockId = ref<string | undefined>();
const editing = ref<string | null>(null);
const loadRoll = ref<RollView | null>(null);
const moveTo = ref('');
const busy = ref(false);
const error = ref('');

const UNSORTED = 'Not sorted yet';
const spots = computed(() => [...new Set(storage.value.map((r) => r.storageSpot).filter((s): s is string => !!s))].sort());
const stockCount = computed(() => new Set(storage.value.map((r) => r.stock.id)).size);
const brands = computed(() => [...new Set(stockList.value.map((s) => s.brand))].sort());

/** Shelves by storage spot; on each, one canister per stock, oldest date first. */
const shelves = computed(() => {
	const bySpot = new Map<string, RollView[]>();
	for (const r of storage.value) {
		const spot = r.storageSpot ?? UNSORTED;
		if (!bySpot.has(spot)) bySpot.set(spot, []);
		bySpot.get(spot)!.push(r);
	}
	return [...bySpot]
		.sort(([a], [b]) => (a === UNSORTED ? 1 : b === UNSORTED ? -1 : a.localeCompare(b)))
		.map(([spot, rolls]) => {
			const byStock = new Map<string, RollView[]>();
			for (const r of rolls) {
				if (!byStock.has(r.stock.id)) byStock.set(r.stock.id, []);
				byStock.get(r.stock.id)!.push(r);
			}
			const groups = [...byStock].map(([stockId, list]) => {
				const sorted = list.sort((a, b) => (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.code.localeCompare(b.code));
				return { key: `${spot}-${stockId}`, stock: sorted[0].stock, rolls: sorted, note: expiryNote(sorted[0].expires, props.today) };
			});
			groups.sort((a, b) => a.stock.brand.localeCompare(b.stock.brand) || a.stock.name.localeCompare(b.stock.name));
			return { spot, count: rolls.length, groups };
		});
});

const wishlist = computed(() => stockList.value.filter((s) => s.wishlist && !storage.value.some((r) => r.stock.id === s.id)));
const stockRows = computed(() =>
	stockList.value.map((s) => ({
		...s,
		inFridge: storage.value.filter((r) => r.stock.id === s.id).length,
		total: totals.value[s.id] ?? 0,
	}))
);
const editingStock = computed(() => (editing.value && editing.value !== 'new' ? stockList.value.find((s) => s.id === editing.value) ?? null : null));
const colorOf = (s: StockView) => canisterColors({ stock: s.token ?? s.id, stockLabel: s.name, stockBrand: s.brand }).can;

function openAdd(stockId?: string) {
	addStockId.value = stockId;
	adding.value = true;
}

function added(rolls: RollView[], stock: StockView | null) {
	storage.value = [...storage.value, ...rolls];
	if (stock) stockList.value = [...stockList.value, stock];
	for (const r of rolls) totals.value[r.stock.id] = (totals.value[r.stock.id] ?? 0) + 1;
	stockList.value = stockList.value.map((s) => (rolls.some((r) => r.stock.id === s.id) ? { ...s, wishlist: false } : s));
	adding.value = false;
}

function stockSaved(s: StockView) {
	stockList.value = upsert(stockList.value, s).sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
	editing.value = null;
}

function stockDeleted(id: string) {
	stockList.value = stockList.value.filter((s) => s.id !== id);
	editing.value = null;
}

function loaded(view: RollView) {
	storage.value = storage.value.filter((r) => r.id !== view.id);
	loadRoll.value = null;
}

async function syncNames() {
	busy.value = true;
	error.value = '';
	try {
		const r = await run(actions.lab.syncCatalogue());
		stockList.value = r.stocksList;
		deskNames.value = [];
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

async function moveGroup(ids: string[]) {
	busy.value = true;
	error.value = '';
	try {
		const moved = await run(actions.lab.moveRolls({ rollIds: ids, storageSpot: moveTo.value }));
		for (const m of moved) storage.value = upsert(storage.value, m);
		moveTo.value = '';
		open.value = null;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.fridge {
	display: grid;
	gap: 2rem;
}

.topline {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem 1.5rem;
}

/* Inside the fridge: cool light from the top, frosted glass shelves. */
.interior {
	display: grid;
	gap: 1.75rem;
	padding: 1.4rem clamp(0.8rem, 2.5vw, 1.6rem) 0.9rem;
	border-radius: 1rem;
	background: linear-gradient(180deg, oklch(96.5% 0.014 230) 0%, oklch(98.8% 0.005 230) 45%, var(--gray-999) 100%);
	box-shadow:
		inset 0 0 0 1px oklch(90% 0.016 230),
		inset 0 22px 36px -26px oklch(68% 0.06 230 / 0.55);
}

:root.theme-dark .interior {
	background:
		radial-gradient(70% 45% at 50% 0%, oklch(36% 0.04 235 / 0.9), transparent 70%),
		linear-gradient(180deg, oklch(20% 0.02 240), oklch(13% 0.008 240));
	box-shadow:
		inset 0 0 0 1px oklch(30% 0.03 235),
		0 0 50px -30px oklch(70% 0.08 230 / 0.5);
}

.shelf-wrap {
	display: grid;
}

.shelf-label {
	display: flex;
	gap: 0.6rem;
	align-items: baseline;
	font-family: var(--font-body);
	font-size: var(--text-sm);
	font-weight: 400;
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.shelf-label span {
	font-family: var(--font-mono);
	font-variant-caps: normal;
	letter-spacing: 0;
}

.shelf {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 0.5rem 1.25rem;
	padding: 1rem 0.5rem 0;
}

/* The shelf the canisters stand on: frosted glass with a lit front edge. */
.board {
	height: 0.55rem;
	margin-top: 0.15rem;
	border-radius: 2px;
	background: linear-gradient(180deg, oklch(100% 0 0 / 0.7), oklch(86% 0.02 230 / 0.7));
	box-shadow:
		inset 0 -1px 0 oklch(70% 0.03 230 / 0.6),
		0 8px 14px -10px oklch(40% 0.04 230 / 0.5);
}

:root.theme-dark .board {
	background: linear-gradient(180deg, oklch(60% 0.03 230 / 0.55), oklch(32% 0.03 235 / 0.6));
	box-shadow:
		inset 0 1px 0 oklch(80% 0.04 230 / 0.5),
		0 8px 14px -10px rgb(0 0 0 / 0.7);
}

.slot {
	display: grid;
	justify-items: center;
	gap: 0.2rem;
	padding: 0.4rem 0.35rem 0.5rem;
	border: 0;
	border-radius: 0.5rem;
	background: none;
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.slot .can {
	transition:
		translate 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
		filter 0.3s ease;
}

/* Picked up off the shelf. */
.slot:hover .can,
.slot:focus-visible .can,
.slot[aria-expanded='true'] .can {
	translate: 0 -0.45rem;
	filter: drop-shadow(0 10px 8px rgb(0 0 0 / 0.25));
}

.slot[aria-expanded='true'] {
	background: color-mix(in oklch, var(--gray-999) 60%, transparent);
	box-shadow: inset 0 0 0 1px var(--gray-700);
}

.slot:focus-visible {
	outline: 2px solid var(--accent-regular);
}

.slot.ghost .can {
	opacity: 0.45;
	filter: grayscale(0.4);
}

.n {
	font-family: var(--font-mono);
	font-size: 0.85rem;
	color: var(--gray-0);
}

.x {
	font-family: var(--font-mono);
	font-size: 0.68rem;
	color: var(--gray-300);
	max-width: 7.5rem;
	text-align: center;
	line-height: 1.3;
}

.x.warn {
	color: var(--lab-warn);
}

.group-detail {
	display: grid;
	gap: 0.5rem;
	margin-top: 1rem;
	padding: 1rem 1.25rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
}

.gd-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: flex-end;
	gap: 0.75rem 1.5rem;
}

.move {
	display: flex;
	gap: 0.5rem;
	flex: 0 1 22rem;
}

.move .lab-input {
	min-height: 2.4rem;
}

.cat-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: flex-end;
	gap: 0.75rem 1.5rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

.cat-head > div {
	display: grid;
	gap: 0.3rem;
}

.table-wrap {
	overflow-x: auto;
}

.desk-sync {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem 1.25rem;
}

.desk-sync p {
	flex: 1 1 22rem;
}

table {
	width: 100%;
	min-width: 36rem;
	border-collapse: collapse;
	font-size: var(--text-base);
}

th,
td {
	padding: 0.6rem 0.6rem;
	text-align: left;
	border-bottom: 1px solid var(--gray-800);
	vertical-align: middle;
}

th {
	font-weight: 400;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

td.num {
	font-family: var(--font-mono);
	font-size: 0.85rem;
	font-variant-numeric: tabular-nums;
}

.dot {
	display: inline-block;
	width: 0.6rem;
	height: 0.6rem;
	margin-right: 0.45rem;
	border-radius: 50%;
	box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
}
</style>
