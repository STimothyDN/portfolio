<template>
	<div class="gear">
		<p class="lab-meta">{{ inUse.length }} {{ inUse.length === 1 ? 'camera' : 'cameras' }} · {{ ownedLenses }} {{ ownedLenses === 1 ? 'lens' : 'lenses' }}</p>

		<!-- Cameras -->
		<section class="lab-section" aria-labelledby="cam-h">
			<header class="sec-head">
				<h2 id="cam-h" class="lab-h2">Cameras</h2>
				<button type="button" class="lab-btn lab-btn--quiet" @click="editCamera = 'new'">Add camera</button>
			</header>
			<div v-if="inUse.length" class="cards">
				<button v-for="c in inUse" :key="c.id" type="button" class="card" @click="editCamera = c.id">
					<span class="card-top">
						<span class="card-name">{{ c.name }}</span>
						<span v-if="c.status !== 'active'" class="lab-chip" :class="{ 'lab-chip--warn': c.status === 'repair' }">{{ GEAR_STATUS[c.status] }}</span>
					</span>
					<span class="spec">{{ [CAMERA_KINDS[c.kind] ?? c.kind, c.format].join(' · ') }}</span>
					<span class="spec">{{ c.mount ? `${c.mount} mount` : c.fixedLens ? `Fixed ${c.fixedLens}` : 'Lens not recorded' }}</span>
					<span class="spec">
						{{ c.battery ? `${c.battery}` : 'Battery not recorded' }}<template v-if="c.batteryChangedOn"> · changed {{ formatDay(c.batteryChangedOn) }}</template>
					</span>
					<span class="card-foot">
						<span class="lab-meta">{{ usage[c.id]?.total ?? 0 }} {{ (usage[c.id]?.total ?? 0) === 1 ? 'roll' : 'rolls' }}</span>
						<span v-if="usage[c.id]?.loaded" class="loaded">
							<span class="lab-code">{{ usage[c.id]!.loaded!.code }}</span> {{ usage[c.id]!.loaded!.stock }}
						</span>
					</span>
				</button>
			</div>
			<p v-else class="lab-empty">No cameras yet.</p>

			<details v-for="grp in otherGroups" :key="grp.key" class="others">
				<summary>{{ grp.label }} <span>{{ grp.list.length }}</span></summary>
				<ul class="lab-rows">
					<li v-for="c in grp.list" :key="c.id">
						<span class="lab-grow"><strong>{{ c.name }}</strong><span class="lab-meta">{{ CAMERA_KINDS[c.kind] ?? c.kind }}</span></span>
						<button type="button" class="lab-link" @click="editCamera = c.id">Edit</button>
					</li>
				</ul>
			</details>
		</section>

		<!-- Lenses -->
		<section class="lab-section" aria-labelledby="lens-h">
			<header class="sec-head">
				<h2 id="lens-h" class="lab-h2">Lenses</h2>
				<button type="button" class="lab-btn lab-btn--quiet" @click="openLens('new')">Add lens</button>
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
						<div class="lab-grow">
							<strong>{{ l.name }}</strong>
							<span class="lab-meta">{{ lensSpec(l) }}<template v-if="l.status !== 'active'"> · {{ GEAR_STATUS[l.status] }}</template></span>
						</div>
						<button type="button" class="lab-link" @click="openLens(l.id)">Edit</button>
					</li>
				</ul>
			</div>
		</section>

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
				@saved="cameraSaved"
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
import { computed, ref } from 'vue';

import { upsert } from '../../lib/lab/client';
import { CAMERA_KINDS, formatDay, GEAR_STATUS, type CameraView, type LensView } from '../../lib/lab/inventory';
import type { ServiceEntry } from '../../lib/lab/server/inventory';
import CameraForm from './CameraForm.vue';
import LabDialog from './LabDialog.vue';
import LensForm from './LensForm.vue';

const props = defineProps<{
	cameras: CameraView[];
	lenses: LensView[];
	service: ServiceEntry[];
	usage: Record<string, { total: number; loaded: { code: string; stock: string } | null }>;
	today: string;
}>();

const cameras = ref<CameraView[]>([...props.cameras]);
const lenses = ref<LensView[]>([...props.lenses]);
const service = ref<ServiceEntry[]>([...props.service]);
const editCamera = ref<string | null>(null);
const editLens = ref<string | null>(null);

const ORDER = ['active', 'repair', 'shelf'];
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

const lensSpec = (l: LensView) =>
	[
		l.focalMin ? (l.focalMax && l.focalMax !== l.focalMin ? `${l.focalMin}–${l.focalMax}mm` : `${l.focalMin}mm`) : null,
		l.maxAperture ? `f/${l.maxAperture}` : null,
	]
		.filter(Boolean)
		.join(' ');

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

.sec-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: center;
	gap: 0.75rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
	gap: 0.85rem;
}

.card {
	display: grid;
	align-content: start;
	gap: 0.3rem;
	padding: 1rem 1.1rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.6rem;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.card:hover {
	border-color: var(--gray-600);
}

.card:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.card-top {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem;
	margin-bottom: 0.25rem;
}

.card-name {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	line-height: 1.15;
	color: var(--gray-0);
}

.spec {
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--gray-300);
}

.card-foot {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: center;
	gap: 0.4rem;
	margin-top: 0.6rem;
	padding-top: 0.6rem;
	border-top: 1px solid var(--gray-800);
}

.loaded {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font-size: var(--text-sm);
	color: var(--gray-0);
}

.loaded .lab-code {
	font-size: 0.85rem;
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

.mount {
	display: grid;
	gap: 0.25rem;
}

.mount-h {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.4rem 1rem;
	font-family: var(--font-brand);
	font-size: var(--text-md);
	font-weight: 560;
}
</style>
