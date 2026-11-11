<template>
	<div class="gear">
		<p class="lab-meta">{{ inUse.length }} {{ inUse.length === 1 ? 'camera' : 'cameras' }} · {{ ownedLenses }} {{ ownedLenses === 1 ? 'lens' : 'lenses' }}</p>

		<!-- Cameras -->
		<section class="lab-section" aria-labelledby="cam-h">
			<header class="sec-head">
				<h2 id="cam-h" class="lab-h2">Cameras</h2>
				<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet" @click="editCamera = 'new'">Add camera</button>
			</header>
			<!-- The case: each camera pressed into its own cutout in the foam, named on a strip of embossed label tape. -->
			<div v-if="inUse.length" class="cards">
				<span class="latch latch--l" aria-hidden="true"></span>
				<span class="latch latch--r" aria-hidden="true"></span>
				<button v-for="(c, ci) in inUse" :key="c.id" type="button" class="card" :class="{ 'read-only': readOnly }" :data-kind="c.kind" :style="{ '--ci': ci }" :aria-disabled="readOnly || undefined" @click="readOnly || (editCamera = c.id)">
					<CameraGlyph :kind="c.kind" :mount="c.mount" :format="c.format" />
					<span class="card-top">
						<span class="card-name">{{ c.name }}</span>
						<span v-if="c.status !== 'active'" class="lab-chip" :class="{ 'lab-chip--warn': c.status === 'repair' }">{{ GEAR_STATUS[c.status] }}</span>
					</span>
					<span class="spec">{{ [CAMERA_KINDS[c.kind] ?? c.kind, c.format].join(' · ') }}</span>
					<span class="spec">{{ c.mount ? `${c.mount} mount` : c.fixedLens ? `Fixed ${c.fixedLens}` : 'Lens not recorded' }}</span>
					<span class="spec batt-row">
						<svg class="batt" :class="batteryLevel(c).tone" viewBox="0 0 22 10" aria-hidden="true">
							<rect x="0.5" y="0.5" width="18" height="9" rx="1.5" />
							<rect x="19" y="3" width="2.5" height="4" rx="0.5" class="nub" />
							<rect x="2" y="2" :width="14.5 * batteryLevel(c).fill" height="6" rx="0.6" class="charge" />
						</svg>
						<span>
							{{ c.battery ?? 'Battery not recorded' }}<template v-if="c.batteryChangedOn"> · changed {{ batteryLevel(c).age }}</template><template v-if="swaps(c.id)"> · {{ swaps(c.id) }} {{ swaps(c.id) === 1 ? 'swap' : 'swaps' }} logged</template>
						</span>
					</span>
					<span class="card-foot">
						<span class="lab-meta">{{ usage[c.id]?.total ?? 0 }} {{ (usage[c.id]?.total ?? 0) === 1 ? 'roll' : 'rolls' }}</span>
						<!-- Loaded: the film window on the back shows the canister inside. -->
						<span v-if="usage[c.id]?.loaded" class="loaded" :style="windowColors(usage[c.id]!.loaded!.stock)">
							<span class="led" aria-hidden="true"></span>
							<span class="window"><span class="lab-code">{{ usage[c.id]!.loaded!.code }}</span> {{ usage[c.id]!.loaded!.stock }}</span>
						</span>
					</span>
				</button>
			</div>
			<div v-else class="cards cards--empty">
				<span class="latch latch--l" aria-hidden="true"></span>
				<span class="latch latch--r" aria-hidden="true"></span>
				<p class="empty-cut">No cameras yet. Add one and it gets its own place in the case.</p>
			</div>

			<details v-for="grp in otherGroups" :key="grp.key" class="others">
				<summary>{{ grp.label }} <span>{{ grp.list.length }}</span></summary>
				<ul class="lab-rows">
					<li v-for="c in grp.list" :key="c.id">
						<span class="lab-grow"><strong>{{ c.name }}</strong><span class="lab-meta">{{ CAMERA_KINDS[c.kind] ?? c.kind }}</span></span>
						<button v-if="!readOnly" type="button" class="lab-link" @click="editCamera = c.id">Edit</button>
					</li>
				</ul>
			</details>
		</section>

		<!-- The battery box: spares by type, the cameras that take them, and which sets are getting old. -->
		<section id="batteries" class="lab-section" aria-labelledby="batt-h">
			<header class="sec-head">
				<h2 id="batt-h" class="lab-h2">Battery box</h2>
			</header>
			<p class="lab-meta">Sets older than {{ OLD_MONTHS }} months are worth swapping before anything important. A swap from here takes the cells out of the box.</p>
			<p v-if="!box.length" class="lab-empty">No batteries written down yet. Edit a camera and say what it takes.</p>
			<ul v-else class="box">
				<li v-for="row in box" :key="row.type" class="cell-row" :class="{ short: row.short, empty: row.onHand === 0 && row.cameras.length }">
					<div class="cell-type">
						<span class="cell-glyph" aria-hidden="true"><i v-for="n in Math.min(row.onHand, 8)" :key="n"></i></span>
						<strong>{{ row.label }}</strong>
					</div>
					<div class="cell-count" role="group" :aria-label="`${row.label} on hand`">
						<button v-if="!readOnly" type="button" class="step" :aria-label="`One fewer ${row.type}`" :disabled="busyBox || row.onHand === 0" @click="addCells(row.type, -1)">−</button>
						<b>{{ row.onHand }}</b>
						<button v-if="!readOnly" type="button" class="step" :aria-label="`One more ${row.type}`" :disabled="busyBox" @click="addCells(row.type, 1)">+</button>
						<span class="lab-meta">{{ row.cameras.length ? (row.sets ? `${row.sets} ${row.sets === 1 ? 'set' : 'sets'}` : 'not a full set') : 'spare' }}</span>
					</div>
					<ul class="takers">
						<li v-for="c in row.cameras" :key="c.cameraId" :class="{ old: c.old }">
							<span>{{ c.name }} <span class="lab-meta">· {{ c.cells }} each · {{ c.months == null ? 'age not known' : c.months < 1 ? 'fresh this month' : `${c.months} mo old` }}</span></span>
							<button v-if="!readOnly" type="button" class="lab-link" :disabled="busyBox || row.onHand < c.cells" :title="row.onHand < c.cells ? `The box has ${row.onHand}` : ''" @click="swap(c.cameraId)">
								Swap in fresh
							</button>
						</li>
					</ul>
				</li>
			</ul>
			<form v-if="!readOnly" class="box-add" @submit.prevent="buyCells">
				<input id="batt-type" v-model="buy.type" class="lab-input" type="text" maxlength="30" list="battery-types" placeholder="LR44" aria-label="Battery type" required />
				<input id="batt-n" v-model.number="buy.n" class="lab-input num" type="number" min="1" max="200" aria-label="How many" required />
				<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busyBox">Add to the box</button>
				<span v-if="shopping.length" class="lab-meta">To cover what’s due: {{ shopping.map((s) => `${s.need} ${s.type}`).join(', ') }}.</span>
			</form>
			<p v-if="boxError" class="lab-error" role="alert">{{ boxError }}</p>
		</section>

		<!-- Lenses -->
		<section class="lab-section" aria-labelledby="lens-h">
			<header class="sec-head">
				<h2 id="lens-h" class="lab-h2">Lenses</h2>
				<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet" @click="openLens('new')">Add lens</button>
			</header>
			<p v-if="!lenses.length" class="lab-empty">
				No lenses yet.<template v-if="mounts.length"> Your SLRs take {{ mounts.join(', ') }}.</template>
			</p>
			<div v-for="m in lensMounts" :key="m.mount" class="mount">
				<h3 class="mount-h">
					{{ m.mount }}
					<span class="lab-meta">{{ m.fits.length ? `fits ${m.fits.join(', ')}` : 'no camera on this mount' }}</span>
				</h3>
				<ul class="lab-rows">
					<li v-for="l in m.lenses" :key="l.id">
						<LensGlyph :min="l.focalMin" :max="l.focalMax" :aperture="l.maxAperture" />
						<div class="lab-grow">
							<strong>{{ l.name }}</strong>
							<span class="lab-meta">{{ lensSpec(l) }}<template v-if="l.status !== 'active'"> · {{ GEAR_STATUS[l.status] }}</template></span>
						</div>
						<button v-if="!readOnly" type="button" class="lab-link" @click="openLens(l.id)">Edit</button>
					</li>
				</ul>
			</div>
		</section>

		<datalist id="battery-types">
			<option v-for="t in Object.keys(BATTERY_FAMILIES)" :key="t" :value="t" />
		</datalist>
		<datalist id="gear-mounts">
			<option v-for="m in allMounts" :key="m" :value="m" />
		</datalist>

		<LabDialog :open="!!editCamera" :title="editCamera === 'new' ? 'Add camera' : 'Edit camera'" wide @close="editCamera = null">
			<CameraForm
				v-if="editCamera"
				:key="editCamera"
				:camera="editingCamera"
				:service="service"
				:today="today"
				:batteries="stock"
				@saved="cameraSaved"
				@stock="stock = $event"
				@deleted="cameraDeleted"
				@service="serviceChanged"
				@cancel="editCamera = null"
			/>
		</LabDialog>
		<LabDialog :open="!!editLens" :title="editLens === 'new' ? 'Add lens' : 'Edit lens'" @close="editLens = null">
			<LensForm v-if="editLens" :key="editLens" :lens="editingLens" :mount="mounts[0]" @saved="lensSaved" @deleted="lensDeleted" @cancel="editLens = null" />
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, reactive, ref } from 'vue';

import { batteryBox, OLD_MONTHS, shoppingList, type BatteryStockRow } from '../../lib/lab/batteries';
import { run, upsert } from '../../lib/lab/client';
import { BATTERY_FAMILIES, CAMERA_KINDS, formatDay, GEAR_STATUS, type CameraView, type LensView } from '../../lib/lab/inventory';
import type { ServiceEntry } from '../../lib/lab/server/inventory';
import CameraForm from './CameraForm.vue';
import CameraGlyph from './CameraGlyph.vue';
import LensGlyph from './LensGlyph.vue';
import LabDialog from './LabDialog.vue';
import LensForm from './LensForm.vue';
import { canisterColors } from '../film/canister';

const props = defineProps<{
	cameras: CameraView[];
	lenses: LensView[];
	service: ServiceEntry[];
	usage: Record<string, { total: number; loaded: { code: string; stock: string } | null }>;
	batteries?: BatteryStockRow[];
	today: string;
	/** A guest looking round the owner's lab: nothing can be changed. */
	readOnly?: boolean;
}>();

const cameras = ref<CameraView[]>([...props.cameras]);
const lenses = ref<LensView[]>([...props.lenses]);
const service = ref<ServiceEntry[]>([...props.service]);
const editCamera = ref<string | null>(null);
const editLens = ref<string | null>(null);

/* ---------- the battery box ---------- */
const stock = ref<BatteryStockRow[]>([...(props.batteries ?? [])]);
const box = computed(() => batteryBox(cameras.value, stock.value, props.today));
const shopping = computed(() => shoppingList(box.value));
const swaps = (id: string) => service.value.filter((e) => e.cameraId === id && e.kind === 'battery').length;
const busyBox = ref(false);
const boxError = ref('');
const buy = reactive({ type: '', n: 2 as number });
async function boxAct(fn: () => Promise<void>) {
	busyBox.value = true;
	boxError.value = '';
	try {
		await fn();
	} catch (e) {
		boxError.value = (e as Error).message;
	} finally {
		busyBox.value = false;
	}
}
const addCells = (type: string, add: number) => boxAct(async () => void (stock.value = await run(actions.lab.setBatteryStock({ type, add }))));
const buyCells = () =>
	boxAct(async () => {
		stock.value = await run(actions.lab.setBatteryStock({ type: buy.type, add: buy.n }));
		buy.type = '';
	});
/** A fresh set from the box, logged today. */
const swap = (cameraId: string) =>
	boxAct(async () => {
		const { stock: left, ...entry } = await run(
			actions.lab.addService({ cameraId, lensId: null, on: props.today, kind: 'battery', costCents: null, note: 'From the battery box', fromStock: true })
		);
		stock.value = left;
		service.value = [entry, ...service.value];
		cameras.value = cameras.value.map((c) => (c.id === cameraId ? { ...c, batteryChangedOn: props.today } : c));
	});

const ORDER = ['active', 'repair', 'shelf'];
/** The canister seen through a camera's film window, from the stock's name. */
const windowColors = (stock: string) => {
	const { can, ink } = canisterColors({ stock, stockLabel: stock });
	return { '--can': can, '--can-ink': ink };
};
const inUse = computed(() =>
	cameras.value
		.filter((c) => ORDER.includes(c.status))
		.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name))
);
const otherGroups = computed(() =>
	(['wishlist', 'gone'] as const)
		.map((key) => ({ key, label: GEAR_STATUS[key], list: cameras.value.filter((c) => c.status === key) }))
		.filter((g) => g.list.length)
);
const ownedLenses = computed(() => lenses.value.filter((l) => l.status !== 'gone' && l.status !== 'wishlist').length);
const mounts = computed(() => [...new Set(cameras.value.map((c) => c.mount).filter((m): m is string => !!m))].sort());
const allMounts = computed(() => [...new Set([...mounts.value, ...lenses.value.map((l) => l.mount)])].sort());

const norm = (m: string) => m.trim().toLowerCase();
const lensMounts = computed(() => {
	const groups = new Map<string, LensView[]>();
	for (const l of lenses.value) {
		if (!groups.has(l.mount)) groups.set(l.mount, []);
		groups.get(l.mount)!.push(l);
	}
	return [...groups]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([mount, list]) => ({
			mount,
			lenses: list.sort((a, b) => (a.focalMin ?? 0) - (b.focalMin ?? 0)),
			fits: cameras.value.filter((c) => c.mount && norm(c.mount) === norm(mount) && c.status !== 'gone').map((c) => c.name),
		}));
});

const hfov = (f: number) => Math.round((2 * Math.atan(36 / (2 * f)) * 180) / Math.PI);
const lensSpec = (l: LensView) =>
	[
		l.focalMin ? (l.focalMax && l.focalMax !== l.focalMin ? `${l.focalMin}–${l.focalMax}mm` : `${l.focalMin}mm`) : null,
		l.focalMin ? (l.focalMax && l.focalMax !== l.focalMin ? `${hfov(l.focalMin)}°–${hfov(l.focalMax)}°` : `${hfov(l.focalMin)}° across`) : null,
		l.maxAperture ? `f/${l.maxAperture}` : null,
	]
		.filter(Boolean)
		.join(' · ');

/** How fresh the battery is: full under a year, then draining; unknown shows empty. */
function batteryLevel(c: CameraView): { fill: number; tone: string; age: string } {
	if (!c.batteryChangedOn) return { fill: 0, tone: 'unknown', age: '' };
	const months = Math.max(0, Math.round((Date.parse(props.today) - Date.parse(c.batteryChangedOn)) / (864e5 * 30.4)));
	const age = months < 1 ? 'this month' : months < 12 ? `${months} mo ago` : `${Math.round(months / 12)} yr ago`;
	if (months < 12) return { fill: 1, tone: 'ok', age };
	if (months < 24) return { fill: 0.6, tone: 'ok', age };
	if (months < 36) return { fill: 0.3, tone: 'low', age };
	return { fill: 0.1, tone: 'low', age };
}

const editingCamera = computed(() => (editCamera.value && editCamera.value !== 'new' ? cameras.value.find((c) => c.id === editCamera.value) ?? null : null));
const editingLens = computed(() => (editLens.value && editLens.value !== 'new' ? lenses.value.find((l) => l.id === editLens.value) ?? null : null));
const openLens = (id: string) => (editLens.value = id);

function cameraSaved(c: CameraView) {
	cameras.value = upsert(cameras.value, c);
	editCamera.value = null;
}
function cameraDeleted(id: string) {
	cameras.value = cameras.value.filter((c) => c.id !== id);
	editCamera.value = null;
}
function serviceChanged(entries: ServiceEntry[]) {
	const id = editCamera.value;
	service.value = [...service.value.filter((e) => e.cameraId !== id), ...entries];
	// Keep the card's "battery changed" date in step with a new battery entry.
	const battery = entries.find((e) => e.kind === 'battery');
	if (battery && id) cameras.value = cameras.value.map((c) => (c.id === id && (c.batteryChangedOn ?? '') < battery.on ? { ...c, batteryChangedOn: battery.on } : c));
}
function lensSaved(l: LensView) {
	lenses.value = upsert(lenses.value, l);
	editLens.value = null;
}
function lensDeleted(id: string) {
	lenses.value = lenses.value.filter((l) => l.id !== id);
	editLens.value = null;
}
</script>

<style scoped>
.gear {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

/* ---- The battery box: a drawer of cells, one compartment per type ---- */
.box {
	list-style: none;
	padding: 0;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
	gap: 0.75rem;
}

.cell-row {
	display: grid;
	gap: 0.6rem;
	align-content: start;
	padding: 0.9rem 1rem 1rem;
	border-radius: 0.6rem;
	background: var(--lab-card, var(--gray-999));
	box-shadow: 0 0 0 1px var(--gray-800), inset 0 2px 6px rgb(0 0 0 / 0.06);
}

.cell-row.short {
	box-shadow: 0 0 0 1.5px var(--lab-stage-camera, oklch(58% 0.19 28)), inset 0 2px 6px rgb(0 0 0 / 0.06);
}

.cell-type {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.cell-type strong {
	font-family: var(--font-mono);
	font-size: 0.86rem;
	letter-spacing: 0.04em;
}

/* Button cells, seen from above. */
.cell-glyph {
	display: inline-flex;
	gap: 2px;
	min-width: 1rem;
}

.cell-glyph i {
	width: 0.7rem;
	height: 0.7rem;
	border-radius: 50%;
	background: radial-gradient(circle at 35% 30%, oklch(96% 0.004 80), oklch(70% 0.006 80) 70%);
	box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
}

.cell-row.empty .cell-glyph::after {
	content: '';
	width: 0.7rem;
	height: 0.7rem;
	border-radius: 50%;
	border: 1px dashed var(--gray-500);
}

.cell-count {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.cell-count b {
	min-width: 2ch;
	text-align: center;
	font-family: var(--font-mono);
	font-size: 1.4rem;
	font-weight: 500;
}

.cell-count .step {
	display: grid;
	place-items: center;
	width: 2rem;
	height: 2rem;
	border: 1px solid var(--gray-700);
	border-radius: 50%;
	background: none;
	color: var(--gray-100);
	font: inherit;
	cursor: pointer;
}

.cell-count .step:disabled {
	opacity: 0.4;
	cursor: default;
}

.takers {
	list-style: none;
	padding: 0;
	display: grid;
	gap: 0.35rem;
	font-size: var(--text-sm);
}

.takers li {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 0.25rem 0.75rem;
	padding-top: 0.35rem;
	border-top: 1px dashed var(--gray-800);
}

.takers li.old > span:first-child::before {
	content: '';
	display: inline-block;
	width: 0.45rem;
	height: 0.45rem;
	margin-right: 0.4rem;
	border-radius: 50%;
	background: var(--lab-stage-camera, oklch(58% 0.19 28));
	vertical-align: 0.1em;
}

.box-add {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.box-add .lab-input {
	width: 8rem;
	min-height: 2.5rem;
}

.box-add .num {
	width: 5rem;
}

.sec-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: center;
	gap: 0.75rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

/*
 * The case: a black shell with latches, pick-and-pluck foam inside, and a
 * cutout per camera (darker, deeper foam where it was pulled away).
 */
.cards {
	--foam: oklch(25% 0.004 60);
	--foam-cut: oklch(16% 0.004 60);
	--ink: oklch(93% 0.008 80);
	--dim: oklch(76% 0.01 75);
	position: relative;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
	gap: 1rem;
	margin: 0.75rem 0.6rem 0.6rem;
	padding: clamp(1rem, 2.5vw, 1.5rem);
	border-radius: 1rem;
	background:
		linear-gradient(90deg, oklch(0% 0 0 / 0.5) 1px, transparent 1px) 0 0 / 10px 10px,
		linear-gradient(oklch(0% 0 0 / 0.5) 1px, transparent 1px) 0 0 / 10px 10px,
		radial-gradient(circle at 45% 40%, oklch(31% 0.004 60), var(--foam) 70%) 0 0 / 10px 10px,
		var(--foam);
	box-shadow:
		inset 0 8px 18px rgb(0 0 0 / 0.55),
		inset 0 0 0 1px oklch(0% 0 0 / 0.6),
		0 0 0 10px oklch(19% 0.004 60),
		0 0 0 11px oklch(33% 0.004 60),
		0 0 0 12px oklch(14% 0.004 60),
		0 26px 44px -22px rgb(0 0 0 / 0.65);
}

/* Latches on the shell's top edge. */
.latch {
	position: absolute;
	top: -1.05rem;
	width: 3.2rem;
	height: 1.05rem;
	border-radius: 0.3rem 0.3rem 0.15rem 0.15rem;
	background: linear-gradient(180deg, oklch(42% 0.004 60), oklch(24% 0.004 60));
	box-shadow:
		inset 0 1px 0 oklch(60% 0.004 60),
		0 2px 3px rgb(0 0 0 / 0.5);
}

.latch::after {
	content: '';
	position: absolute;
	left: 50%;
	top: 0.35rem;
	width: 1.4rem;
	height: 0.2rem;
	translate: -50% 0;
	border-radius: 999px;
	background: oklch(15% 0.004 60);
}

.latch--l {
	left: 18%;
}

.latch--r {
	right: 18%;
}

.card {
	position: relative;
	display: grid;
	align-content: start;
	gap: 0.3rem;
	padding: 1rem 1.1rem;
	border: 0;
	border-radius: 0.9rem;
	background:
		radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.035) 0.6px, transparent 1px) 0 0 / 3px 3px,
		var(--foam-cut);
	box-shadow:
		inset 0 10px 18px rgb(0 0 0 / 0.75),
		inset 0 -1px 0 oklch(100% 0 0 / 0.05),
		0 1px 0 oklch(100% 0 0 / 0.07),
		0 -1px 0 oklch(0% 0 0 / 0.6);
	color: var(--ink);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.empty-cut {
	grid-column: 1 / -1;
	display: grid;
	place-items: center;
	min-height: 9rem;
	padding: 1.5rem;
	border-radius: 0.9rem;
	border: 1.5px dashed oklch(100% 0 0 / 0.18);
	background: oklch(16% 0.004 60 / 0.6);
	color: var(--dim);
	text-align: center;
	box-shadow: inset 0 10px 18px rgb(0 0 0 / 0.6);
}

.card:focus-visible {
	outline: 2px solid var(--lab-lit);
	outline-offset: 3px;
}

.card-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	margin-bottom: 0.35rem;
}

/* Embossed label tape: raised white letters on coloured plastic. */
.card-name {
	--tape: oklch(20% 0.005 260);
	min-width: 0;
	padding: 0.28rem 0.7rem 0.24rem;
	border-radius: 2px;
	background:
		linear-gradient(180deg, oklch(100% 0 0 / 0.16), transparent 45%, oklch(0% 0 0 / 0.18)),
		var(--tape);
	color: oklch(97% 0.004 80);
	font-family: var(--font-mono);
	font-size: 0.86rem;
	font-weight: 700;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.14em;
	line-height: 1.25;
	text-shadow:
		0 1px 0 oklch(0% 0 0 / 0.55),
		0 -1px 0 oklch(100% 0 0 / 0.25);
	box-shadow:
		0 2px 3px rgb(0 0 0 / 0.6),
		inset 0 0 0 1px oklch(100% 0 0 / 0.08);
	rotate: -1.2deg;
	clip-path: polygon(0.3rem 0, calc(100% - 0.3rem) 0, 100% 50%, calc(100% - 0.3rem) 100%, 0.3rem 100%, 0 50%);
}

.card[data-kind='point-and-shoot'] .card-name {
	--tape: oklch(48% 0.17 25);
}

.card[data-kind='rangefinder'] .card-name {
	--tape: oklch(42% 0.13 255);
}

.card[data-kind='medium-format'] .card-name,
.card[data-kind='tlr'] .card-name {
	--tape: oklch(42% 0.1 155);
}

.spec {
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--dim);
}

.card-foot {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: center;
	gap: 0.5rem;
	margin-top: 0.7rem;
	padding-top: 0.7rem;
	border-top: 1px dashed oklch(100% 0 0 / 0.12);
}

.card-foot .lab-meta {
	color: var(--dim);
}

.card .lab-chip {
	color: var(--dim);
	border-color: oklch(100% 0 0 / 0.25);
}

.card .lab-chip--warn {
	color: oklch(80% 0.13 70);
	border-color: oklch(80% 0.13 70 / 0.5);
}

/* The camera, nested in the foam; lifted out a little when you reach for it. */
.card :deep(.glyph) {
	margin: 0.15rem 0 0.6rem;
	transition:
		translate 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
		filter 0.35s ease;
}

.card :deep(.glyph .body > *) {
	stroke: oklch(90% 0.01 80);
}

.card :deep(.glyph .body .thin) {
	stroke: oklch(66% 0.01 75);
}

.card :deep(.glyph .body .glass) {
	stroke: oklch(70% 0.01 75);
	fill: color-mix(in oklch, var(--lab-edge-ink) 30%, transparent);
}

.card :deep(.glyph .dim path) {
	stroke: oklch(52% 0.008 70);
}

.card :deep(.glyph .dim text) {
	fill: oklch(72% 0.01 75);
	stroke: var(--foam-cut);
}

.card :deep(.glyph .mount) {
	fill: var(--lab-edge-ink);
}

@media (hover: hover) {
	.card:hover :deep(.glyph) {
		translate: 0 -4px;
		filter: drop-shadow(0 8px 6px rgb(0 0 0 / 0.7));
	}
}

@media (prefers-reduced-motion: no-preference) {
	.card :deep(.glyph .body > *) {
		animation-delay: calc(var(--ci) * 70ms);
	}
}

.batt-row {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.batt {
	width: 1.4rem;
	height: auto;
	flex: none;
}

.batt rect:first-child {
	fill: none;
	stroke: oklch(70% 0.01 75);
}

.batt .nub {
	fill: oklch(70% 0.01 75);
}

.batt .charge {
	fill: oklch(72% 0.14 150);
}

.batt.low .charge {
	fill: oklch(76% 0.14 65);
}

/* Loaded: a lit LED, and the film window showing the canister's colours. */
.loaded {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	min-width: 0;
}

.window {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-width: 0;
	padding: 0.22rem 0.55rem 0.22rem 0.45rem;
	border-radius: 3px;
	background:
		linear-gradient(180deg, oklch(100% 0 0 / 0.28), transparent 40%),
		var(--can, oklch(60% 0.1 60));
	color: var(--can-ink, white);
	font-size: var(--text-sm);
	line-height: 1.2;
	box-shadow:
		0 0 0 2px oklch(8% 0.004 60),
		0 0 0 3px oklch(40% 0.004 60);
}

.window .lab-code {
	font-size: 0.82rem;
	color: inherit;
	rotate: 0deg;
}

.led {
	flex: none;
	width: 0.45rem;
	height: 0.45rem;
	border-radius: 50%;
	background: oklch(64% 0.23 28);
	box-shadow: 0 0 6px 1px oklch(64% 0.23 28 / 0.8);
}

@media (prefers-reduced-motion: no-preference) {
	.led {
		animation: led 2.4s ease-in-out infinite;
	}

	@keyframes led {
		50% {
			opacity: 0.45;
			box-shadow: 0 0 2px oklch(64% 0.23 28 / 0.4);
		}
	}
}

.others summary {
	cursor: pointer;
	padding-block: 0.5rem;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.others summary span {
	font-family: var(--font-mono);
	font-variant-caps: normal;
}

/* The lens compartment: the same foam, a row of round cutouts. */
.mount {
	display: grid;
	gap: 0.5rem;
	padding: 1rem 1.2rem 0.6rem;
	border-radius: 0.9rem;
	background:
		linear-gradient(90deg, oklch(0% 0 0 / 0.5) 1px, transparent 1px) 0 0 / 10px 10px,
		linear-gradient(oklch(0% 0 0 / 0.5) 1px, transparent 1px) 0 0 / 10px 10px,
		radial-gradient(circle at 45% 40%, oklch(31% 0.004 60), oklch(25% 0.004 60) 70%) 0 0 / 10px 10px,
		oklch(25% 0.004 60);
	color: oklch(93% 0.008 80);
	box-shadow:
		inset 0 8px 18px rgb(0 0 0 / 0.55),
		0 0 0 6px oklch(19% 0.004 60),
		0 0 0 7px oklch(33% 0.004 60),
		0 18px 34px -22px rgb(0 0 0 / 0.6);
	margin-inline: 0.45rem;
}

.mount .lab-rows > li {
	flex-wrap: nowrap;
	border-bottom-color: oklch(100% 0 0 / 0.1);
}

.mount .lab-rows > li:last-child {
	border-bottom: 0;
}

.mount .lab-meta {
	color: oklch(76% 0.01 75);
}

.mount .lab-link {
	color: oklch(93% 0.008 80);
	text-decoration-color: oklch(100% 0 0 / 0.35);
}

.mount :deep(.lens-glyph) {
	padding: 0.3rem;
	border-radius: 0.6rem;
	background: oklch(16% 0.004 60);
	box-shadow: inset 0 6px 12px rgb(0 0 0 / 0.75);
}

.mount :deep(.lens-glyph .barrel) {
	fill: oklch(22% 0.004 60);
	stroke: oklch(55% 0.008 70);
}

.mount :deep(.lens-glyph .eye) {
	fill: oklch(90% 0.01 80);
}

.mount :deep(.lens-glyph .blades) {
	fill: oklch(32% 0.004 60);
	stroke: oklch(55% 0.008 70);
}

.mount-h {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem 1rem;
	font-family: var(--font-mono);
	font-size: 0.86rem;
	font-weight: 700;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.14em;
}

.mount-h .lab-meta {
	font-family: var(--font-body);
	font-weight: 400;
	font-variant-caps: normal;
	letter-spacing: 0;
}

/* A guest looks at the case; the cameras don't open for editing. */
.card.read-only {
	cursor: default;
}
</style>
