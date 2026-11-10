<template>
	<div class="fridge">
		<div class="topline">
			<p class="lab-meta">
				{{ storage.length }} {{ storage.length === 1 ? 'roll' : 'rolls' }} across {{ stockCount }} {{ stockCount === 1 ? 'stock' : 'stocks' }}<template v-if="forecast?.perMonth && forecast.monthsOfFilm != null">
					· you load about {{ forecast.perMonth }} a month, so that’s {{ formatMonths(forecast.monthsOfFilm) }} of film</template>
			</p>
			<span v-if="!readOnly" class="lab-actions">
				<a class="lab-btn lab-btn--quiet" href="/photography/lab/labels/">Print canister labels</a>
				<button type="button" class="lab-btn" @click="openAdd()">Add rolls</button>
			</span>
		</div>

		<p v-if="!storage.length && wishlist.length" class="lab-empty">
			The fridge is empty. Add the film you have on hand, and each roll gets a code to write on its canister.
		</p>

		<div class="interior" :class="{ 'is-empty': !shelves.length && !wishlist.length }">
		<!-- Opening the fridge: the door swings away, the bulb flickers on and a
		     breath of cold air spills out. Decoration only, and only once. -->
		<div class="door" aria-hidden="true">
			<span class="door-badge">Cold storage · film only</span>
			<span class="door-handle"></span>
		</div>
		<span class="bulb" aria-hidden="true"></span>
		<span class="mist" aria-hidden="true"></span>
		<section v-for="shelf in shelves" :key="shelf.spot" class="shelf-wrap" :class="shelfKind(shelf.spot)" :aria-label="shelf.spot">
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
						<form v-if="!readOnly" class="move" @submit.prevent="moveGroup(g.rolls.map((r) => r.id))">
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
							<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet" @click="loadRoll = r">Load into a camera</button>
						</li>
					</ul>
				</div>
			</template>
		</section>

		<div v-if="!shelves.length && !wishlist.length" class="shelf-wrap empty-shelf">
			<p class="lab-meta">The fridge is empty. Add the film you have on hand, and each roll gets a code to write on its canister.</p>
			<div class="board" aria-hidden="true"></div>
		</div>

		<section v-if="wishlist.length" class="shelf-wrap" aria-label="Want to try">
			<h2 class="shelf-label">Want to try <span>{{ wishlist.length }}</span></h2>
			<div class="shelf">
				<button v-for="s in wishlist" :key="s.id" type="button" class="slot ghost" :disabled="readOnly" :title="readOnly ? s.name : `Add rolls of ${s.name}`" @click="openAdd(s.id)">
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
				<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet" @click="editing = 'new'">Add film stock</button>
			</header>
			<div v-if="deskNames.length && !readOnly" class="lab-notice desk-sync">
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
								<span class="dot" :style="{ backgroundColor: colorOf(s) }" aria-hidden="true"></span>
								{{ s.name }}
								<span v-if="s.wishlist" class="lab-chip">wishlist</span>
							</td>
							<td class="num">{{ s.iso ?? '—' }}</td>
							<td>{{ s.process }}</td>
							<td>{{ s.format }}</td>
							<td class="num">{{ s.inFridge || '' }}</td>
							<td class="num">{{ s.total || '' }}</td>
							<td><button v-if="!readOnly" type="button" class="lab-link" @click="editing = s.id">Edit</button></td>
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

/** Shelves named like a drawer, the door's bins or the freezer look the part. */
const shelfKind = (spot: string) => (/freez/i.test(spot) ? 'is-freezer' : /drawer|crisper/i.test(spot) ? 'is-drawer' : /door/i.test(spot) ? 'is-door' : null);

const props = defineProps<{
	storage: RollView[];
	stocks: StockView[];
	totals: Record<string, number>;
	choices: StepChoices;
	shops: string[];
	deskNames: string[];
	today: string;
	forecast?: { byStock: Record<string, StockForecast>; perMonth: number; monthsOfFilm: number | null };
	/** A guest looking round the owner's lab: nothing can be changed. */
	readOnly?: boolean;
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

/*
 * Inside the fridge: an enamel cabinet, the liner lit cool from the bulb at
 * the top, frosted glass shelves.
 */
.interior {
	position: relative;
	display: grid;
	gap: 1.75rem;
	padding: 2.4rem clamp(0.8rem, 2.5vw, 1.6rem) 1.1rem;
	border-radius: 1.1rem;
	background:
		radial-gradient(50% 34% at 50% 0%, oklch(100% 0.01 220 / 0.95), transparent 75%),
		linear-gradient(180deg, oklch(95.5% 0.016 230) 0%, oklch(98.6% 0.006 230) 45%, oklch(97% 0.008 230) 100%);
	box-shadow:
		inset 0 0 0 1px oklch(88% 0.018 230),
		inset 0 22px 36px -26px oklch(68% 0.06 230 / 0.55),
		inset 0 -18px 30px -24px oklch(60% 0.04 230 / 0.35),
		0 0 0 7px oklch(96% 0.006 90),
		0 0 0 8px oklch(84% 0.01 80),
		0 26px 50px -30px rgb(0 0 0 / 0.45);
	perspective: 2400px;
}

:root.theme-dark .interior {
	background:
		radial-gradient(50% 34% at 50% 0%, oklch(55% 0.05 225 / 0.75), transparent 75%),
		linear-gradient(180deg, oklch(22% 0.025 240), oklch(14% 0.01 240));
	box-shadow:
		inset 0 0 0 1px oklch(32% 0.03 235),
		inset 0 -18px 30px -24px rgb(0 0 0 / 0.6),
		0 0 0 7px oklch(23% 0.006 240),
		0 0 0 8px oklch(32% 0.008 240),
		0 0 60px -30px oklch(70% 0.08 230 / 0.45);
}

/* The bulb housing at the top of the liner. */
.bulb {
	position: absolute;
	top: 0.7rem;
	left: 50%;
	width: 4.5rem;
	height: 0.55rem;
	translate: -50% 0;
	border-radius: 999px;
	background: linear-gradient(180deg, oklch(100% 0 0), oklch(94% 0.02 220));
	box-shadow:
		0 0 0 1px oklch(85% 0.02 230),
		0 0 18px 6px oklch(100% 0.02 220 / 0.8);
	pointer-events: none;
}

:root.theme-dark .bulb {
	background: linear-gradient(180deg, oklch(96% 0.02 220), oklch(82% 0.04 225));
	box-shadow:
		0 0 0 1px oklch(45% 0.03 230),
		0 0 22px 8px oklch(85% 0.06 225 / 0.45);
}

/* The door: swings open the first time you look in, then it's gone. */
.door {
	position: absolute;
	inset: -8px;
	z-index: 3;
	display: none;
	border-radius: 1.15rem;
	background:
		radial-gradient(80% 50% at 30% 20%, oklch(100% 0 0 / 0.7), transparent 70%),
		linear-gradient(100deg, oklch(97% 0.006 90), oklch(92% 0.008 85) 60%, oklch(88% 0.01 80));
	box-shadow:
		inset 0 0 0 1px oklch(80% 0.01 80),
		inset 0 0 0 6px oklch(93% 0.006 85),
		inset 0 0 0 7px oklch(82% 0.01 80);
	transform-origin: 0 50%;
	pointer-events: none;
	backface-visibility: hidden;
}

:root.theme-dark .door {
	background:
		radial-gradient(80% 50% at 30% 20%, oklch(100% 0 0 / 0.08), transparent 70%),
		linear-gradient(100deg, oklch(30% 0.006 240), oklch(23% 0.006 240) 60%, oklch(19% 0.006 240));
	box-shadow:
		inset 0 0 0 1px oklch(40% 0.01 240),
		inset 0 0 0 6px oklch(25% 0.006 240),
		inset 0 0 0 7px oklch(36% 0.01 240);
}

.door-handle {
	position: absolute;
	top: 18%;
	bottom: 18%;
	right: 1.6rem;
	width: 0.7rem;
	border-radius: 999px;
	background: linear-gradient(90deg, oklch(70% 0.005 80), oklch(97% 0.003 80) 40%, oklch(78% 0.005 80));
	box-shadow: -4px 0 8px rgb(0 0 0 / 0.18);
}

.door-badge {
	position: absolute;
	top: 1.6rem;
	left: 50%;
	translate: -50% 0;
	padding: 0.3rem 0.8rem;
	border-radius: 3px;
	background: oklch(28% 0.01 60);
	color: oklch(92% 0.02 85);
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.22em;
	text-transform: uppercase;
	white-space: nowrap;
}

/* A breath of cold air spilling out along the bottom. */
.mist {
	position: absolute;
	inset: auto 0 -1rem;
	z-index: 2;
	height: 45%;
	display: none;
	background:
		radial-gradient(40% 50% at 25% 80%, oklch(100% 0 0 / 0.9), transparent 70%),
		radial-gradient(35% 45% at 60% 85%, oklch(100% 0 0 / 0.8), transparent 70%),
		radial-gradient(30% 40% at 85% 75%, oklch(100% 0 0 / 0.7), transparent 70%);
	filter: blur(16px);
	opacity: 0;
	pointer-events: none;
}

:root.theme-dark .mist {
	background:
		radial-gradient(40% 50% at 25% 80%, oklch(85% 0.03 225 / 0.45), transparent 70%),
		radial-gradient(35% 45% at 60% 85%, oklch(85% 0.03 225 / 0.4), transparent 70%),
		radial-gradient(30% 40% at 85% 75%, oklch(85% 0.03 225 / 0.35), transparent 70%);
}

@media (prefers-reduced-motion: no-preference) {
	.door {
		display: block;
		animation: door-open 1.25s 0.35s cubic-bezier(0.55, 0.02, 0.3, 1) forwards;
	}

	@keyframes door-open {
		0% {
			transform: rotateY(0deg);
		}
		12% {
			transform: rotateY(-4deg);
		}
		75% {
			opacity: 1;
		}
		100% {
			transform: rotateY(-112deg);
			opacity: 0;
			visibility: hidden;
		}
	}

	/* The bulb catches as the seal breaks. */
	.interior::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		border-radius: inherit;
		background: oklch(30% 0.03 240 / 0.55);
		pointer-events: none;
		animation: bulb-on 1.4s 0.55s forwards;
	}

	:root.theme-dark .interior::after {
		background: oklch(8% 0.01 240 / 0.8);
	}

	@keyframes bulb-on {
		0% {
			opacity: 1;
		}
		14% {
			opacity: 0;
		}
		22% {
			opacity: 0.7;
		}
		30% {
			opacity: 0;
		}
		38% {
			opacity: 0.35;
		}
		50%,
		100% {
			opacity: 0;
		}
	}

	.mist {
		display: block;
		animation: mist 3s 0.75s ease-out forwards;
	}

	@keyframes mist {
		0% {
			opacity: 0;
			translate: 0 0;
			scale: 0.9 0.8;
		}
		30% {
			opacity: 0.85;
		}
		100% {
			opacity: 0;
			translate: 0 1.5rem;
			scale: 1.25 1.1;
		}
	}
}

.empty-shelf {
	gap: 0.6rem;
	padding: 2.5rem 0.5rem 0;
	text-align: center;
}

.empty-shelf .lab-meta {
	max-width: 30rem;
	justify-self: center;
}

/* ---- The crisper drawer: a frosted bin with a lip to pull it by ---- */
.shelf-wrap.is-drawer {
	position: relative;
	padding: 0.7rem 0.8rem 0.6rem;
	border-radius: 0.6rem 0.6rem 1rem 1rem;
	background: linear-gradient(180deg, oklch(100% 0 0 / 0.35), oklch(92% 0.02 220 / 0.55));
	box-shadow:
		inset 0 0 0 1px oklch(100% 0 0 / 0.8),
		inset 0 -0.6rem 0 oklch(100% 0 0 / 0.35),
		0 6px 14px -10px oklch(40% 0.04 230 / 0.5);
}

:root.theme-dark .shelf-wrap.is-drawer {
	background: linear-gradient(180deg, oklch(60% 0.03 225 / 0.12), oklch(45% 0.03 230 / 0.22));
	box-shadow:
		inset 0 0 0 1px oklch(70% 0.03 225 / 0.3),
		inset 0 -0.6rem 0 oklch(70% 0.03 225 / 0.1);
}

.shelf-wrap.is-drawer .can {
	filter: saturate(0.85) contrast(0.95);
}

.shelf-wrap.is-drawer > .board {
	display: none;
}

/* ---- The door bins: a clear rail across the front ---- */
.shelf-wrap.is-door .slot {
	position: relative;
}

.shelf-wrap.is-door .slot::after {
	content: '';
	position: absolute;
	top: calc(0.4rem + 86px * 0.7);
	left: -0.7rem;
	right: -0.7rem;
	height: calc(86px * 0.3);
	border-radius: 0 0 3px 3px;
	background: linear-gradient(180deg, oklch(100% 0 0 / 0.7), oklch(93% 0.02 220 / 0.45) 30%, oklch(90% 0.025 220 / 0.55));
	box-shadow:
		inset 0 1px 0 oklch(100% 0 0 / 0.9),
		inset 0 -1px 0 oklch(75% 0.03 225 / 0.6);
	pointer-events: none;
}

:root.theme-dark .shelf-wrap.is-door .slot::after {
	background: linear-gradient(180deg, oklch(80% 0.03 225 / 0.32), oklch(55% 0.03 230 / 0.25));
	box-shadow: inset 0 1px 0 oklch(90% 0.03 225 / 0.45);
}

/* ---- The freezer: frost creeping in at the edges ---- */
.shelf-wrap.is-freezer {
	padding: 0.6rem 0.8rem 0;
	border-radius: 0.6rem;
	background:
		radial-gradient(circle at 10% 20%, oklch(100% 0 0 / 0.7) 0.6px, transparent 1.2px) 0 0 / 9px 11px,
		radial-gradient(circle at 60% 70%, oklch(100% 0 0 / 0.6) 0.5px, transparent 1px) 3px 5px / 13px 7px,
		linear-gradient(180deg, oklch(92% 0.03 225 / 0.7), oklch(96% 0.02 220 / 0.4));
	box-shadow:
		inset 0 0 22px 4px oklch(100% 0 0 / 0.85),
		inset 0 0 0 1px oklch(85% 0.03 225);
}

:root.theme-dark .shelf-wrap.is-freezer {
	background:
		radial-gradient(circle at 10% 20%, oklch(90% 0.03 225 / 0.35) 0.6px, transparent 1.2px) 0 0 / 9px 11px,
		radial-gradient(circle at 60% 70%, oklch(90% 0.03 225 / 0.3) 0.5px, transparent 1px) 0 0 / 13px 7px,
		linear-gradient(180deg, oklch(40% 0.04 225 / 0.45), oklch(30% 0.03 230 / 0.3));
	box-shadow:
		inset 0 0 22px 4px oklch(80% 0.04 225 / 0.18),
		inset 0 0 0 1px oklch(50% 0.04 225 / 0.5);
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

/* A tiny canister in the stock's colours. */
.dot {
	display: inline-block;
	width: 0.6rem;
	height: 1rem;
	margin-right: 0.55rem;
	vertical-align: -0.15rem;
	border-radius: 1.5px;
	background-image:
		linear-gradient(90deg, rgb(0 0 0 / 0.3), rgb(255 255 255 / 0.3) 30%, rgb(0 0 0 / 0.3)),
		linear-gradient(180deg, oklch(76% 0.006 80) 0 0.14rem, transparent 0.14rem calc(100% - 0.14rem), oklch(76% 0.006 80) calc(100% - 0.14rem));
	box-shadow: 0 1px 1px rgb(0 0 0 / 0.2);
}
</style>
