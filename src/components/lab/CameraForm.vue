<template>
	<div class="camera-form">
		<form class="lab-form" @submit.prevent="save">
			<div class="lab-row2">
				<label class="lab-field">
					<span>Brand</span>
					<input id="cam-brand" v-model="f.brand" class="lab-input" type="text" maxlength="60" required placeholder="Minolta" />
				</label>
				<label class="lab-field">
					<span>Status</span>
					<select id="cam-status" v-model="f.status" class="lab-input lab-select">
						<option v-for="(label, key) in GEAR_STATUS" :key="key" :value="key">{{ label }}</option>
					</select>
				</label>
			</div>
			<label class="lab-field">
				<span>Name</span>
				<input id="cam-name" v-model="f.name" class="lab-input" type="text" maxlength="120" required placeholder="Minolta X-700" />
			</label>
			<div class="lab-row2">
				<label class="lab-field">
					<span>Kind</span>
					<select id="cam-kind" v-model="f.kind" class="lab-input lab-select">
						<option v-for="(label, key) in CAMERA_KINDS" :key="key" :value="key">{{ label }}</option>
					</select>
				</label>
				<label class="lab-field">
					<span>Format</span>
					<select id="cam-format" v-model="f.format" class="lab-input lab-select">
						<option v-for="x in FORMATS" :key="x" :value="x">{{ x }}</option>
					</select>
				</label>
			</div>
			<div class="lab-row2">
				<label class="lab-field">
					<span>Lens mount</span>
					<input id="cam-mount" v-model="f.mount" class="lab-input" type="text" maxlength="60" list="gear-mounts" placeholder="Fixed lens? Leave blank" />
				</label>
				<label class="lab-field">
					<span>Fixed lens</span>
					<input id="cam-fixed" v-model="f.fixedLens" class="lab-input" type="text" maxlength="80" placeholder="35mm f/2.8" :disabled="!!f.mount" />
				</label>
			</div>
			<div class="batt-grid">
				<label class="lab-field">
					<span>Cells</span>
					<input id="cam-battery-n" v-model.number="f.cells" class="lab-input" type="number" min="1" max="12" inputmode="numeric" />
				</label>
				<label class="lab-field">
					<span>Battery</span>
					<input id="cam-battery" v-model="f.cellType" class="lab-input" type="text" maxlength="40" list="battery-types" placeholder="LR44, CR123A, AA…" />
				</label>
				<label class="lab-field">
					<span>Fresh set went in</span>
					<input id="cam-battery-on" v-model="f.batteryChangedOn" class="lab-input" type="date" />
				</label>
			</div>
			<!-- The meter and the shutter dial in shooting mode only offer what the camera has. -->
			<div v-if="f.kind !== 'point-and-shoot'" class="lab-row2">
				<label class="lab-field">
					<span>Fastest shutter</span>
					<select id="cam-fastest" v-model="f.shutterFastest" class="lab-input lab-select">
						<option value="">{{ known ? `${known.fastest} (the ${f.name || 'model'}’s spec)` : 'Not known' }}</option>
						<option v-for="s in TIMED" :key="s" :value="s">{{ s }}</option>
					</select>
				</label>
				<label class="lab-field">
					<span>Slowest timed speed</span>
					<select id="cam-slowest" v-model="f.shutterSlowest" class="lab-input lab-select">
						<option value="">{{ known ? `${known.slowest} (spec)` : 'Not known' }}</option>
						<option v-for="s in TIMED" :key="s" :value="s">{{ s }}</option>
					</select>
				</label>
			</div>
			<details class="more" :open="!!(camera?.serial || camera?.acquiredOn || camera?.priceCents)">
				<summary>Serial and purchase</summary>
				<div class="lab-form">
					<label class="lab-field"><span>Serial</span><input id="cam-serial" v-model="f.serial" class="lab-input" type="text" maxlength="60" /></label>
					<div class="lab-row2">
						<label class="lab-field"><span>Got it on</span><input id="cam-acq" v-model="f.acquiredOn" class="lab-input" type="date" /></label>
						<label class="lab-field"><span>Paid ($)</span><input id="cam-price" v-model="f.price" class="lab-input" type="number" min="0" step="0.01" /></label>
					</div>
					<label class="lab-field"><span>From</span><input id="cam-from" v-model="f.acquiredFrom" class="lab-input" type="text" maxlength="120" /></label>
				</div>
			</details>
			<label class="lab-field">
				<span>Notes and quirks</span>
				<textarea id="cam-notes" v-model="f.notes" class="lab-input" rows="3" maxlength="2000" placeholder="Light leak on frame 1; meter reads a stop hot"></textarea>
			</label>
			<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
			<div class="lab-actions">
				<button type="submit" class="lab-btn" :disabled="busy">{{ camera ? 'Save' : 'Add camera' }}</button>
				<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
				<button v-if="camera" type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove">
					{{ confirmDelete ? 'Really delete?' : 'Delete' }}
				</button>
			</div>
		</form>

		<section v-if="camera" class="service" aria-labelledby="svc-h">
			<h3 id="svc-h" class="lab-h2">Service log</h3>
			<ul v-if="log.length" class="lab-rows">
				<li v-for="e in log" :key="e.id">
					<div class="lab-grow">
						<strong>{{ SERVICE_KINDS[e.kind] ?? e.kind }}</strong>
						<span class="lab-meta">{{ [formatDay(e.on), formatMoney(e.costCents), e.note].filter(Boolean).join(' · ') }}</span>
					</div>
					<button type="button" class="lab-link" @click="removeEntry(e.id)">Remove</button>
				</li>
			</ul>
			<form class="svc-form" @submit.prevent="addEntry">
				<select id="svc-kind" v-model="svc.kind" class="lab-input lab-select" aria-label="What was done">
					<option v-for="(label, key) in SERVICE_KINDS" :key="key" :value="key">{{ label }}</option>
				</select>
				<input id="svc-on" v-model="svc.on" class="lab-input" type="date" required aria-label="Date" />
				<input id="svc-cost" v-model="svc.cost" class="lab-input" type="number" min="0" step="0.01" placeholder="$" aria-label="Cost in dollars" />
				<input id="svc-note" v-model="svc.note" class="lab-input wide" type="text" maxlength="300" placeholder="Note" aria-label="Note" />
				<label v-if="svc.kind === 'battery' && cell" class="wide from-box">
					<input id="svc-from-box" v-model="svc.fromStock" type="checkbox" :disabled="boxHas < cell.count" />
					<span>Take {{ cell.count }} {{ cell.key }} from the battery box ({{ boxHas }} in it)</span>
				</label>
				<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy">Add to log</button>
			</form>
		</section>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, reactive, ref } from 'vue';

import { dollars, run } from '../../lib/lab/client';
import {
	CAMERA_KINDS,
	FORMATS,
	formatDay,
	formatMoney,
	batteryKey,
	batteryOf,
	batteryText,
	GEAR_STATUS,
	KNOWN_SHUTTERS,
	SERVICE_KINDS,
	SHUTTERS,
	toCents,
	type CameraView,
} from '../../lib/lab/inventory';
import type { ServiceEntry } from '../../lib/lab/server/inventory';

const props = defineProps<{ camera: CameraView | null; service: ServiceEntry[]; today: string; batteries?: { type: string; onHand: number }[] }>();
const emit = defineEmits<{ saved: [camera: CameraView]; deleted: [id: string]; service: [entries: ServiceEntry[]]; stock: [rows: { type: string; onHand: number }[]]; cancel: [] }>();

const c = props.camera;
const TIMED = SHUTTERS.filter((s) => s !== 'B');
const known = c?.token ? KNOWN_SHUTTERS[c.token] : undefined;
const parsed = batteryOf(c?.battery);
const f = reactive({
	brand: c?.brand ?? '',
	name: c?.name ?? '',
	kind: c?.kind ?? 'slr',
	format: c?.format ?? '35mm',
	mount: c?.mount ?? '',
	fixedLens: c?.fixedLens ?? '',
	cells: parsed?.count ?? 1,
	cellType: parsed?.name ?? '',
	batteryChangedOn: c?.batteryChangedOn ?? '',
	shutterFastest: c?.shutterFastest ?? '',
	shutterSlowest: c?.shutterSlowest ?? '',
	serial: c?.serial ?? '',
	acquiredOn: c?.acquiredOn ?? '',
	price: dollars(c?.priceCents) as string | number,
	acquiredFrom: c?.acquiredFrom ?? '',
	status: c?.status ?? 'active',
	notes: c?.notes ?? '',
});
const log = ref<ServiceEntry[]>(props.service.filter((e) => e.cameraId === c?.id));
const svc = reactive({ kind: 'battery', on: props.today, cost: '' as string | number, note: '', fromStock: false });
/** The saved camera's battery, for taking a set from the box. */
const cell = computed(() => batteryOf(c?.battery));
const boxHas = computed(() => (cell.value ? props.batteries?.find((b) => b.type === batteryKey(cell.value!.name))?.onHand ?? 0 : 0));
svc.fromStock = boxHas.value >= (cell.value?.count ?? 99);
const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);

async function act(fn: () => Promise<void>) {
	busy.value = true;
	error.value = '';
	try {
		await fn();
	} catch (e) {
		error.value = (e as Error).message;
		confirmDelete.value = false;
	} finally {
		busy.value = false;
	}
}

/** "2 × LR44" from the two fields (or as typed, when the count was written into the name). */
function batteryField() {
	const typed = /\d\s*[×x*]|[×x*]\s*\d/i.test(f.cellType) ? batteryOf(f.cellType) : null;
	return typed ? batteryText(typed.count, typed.name) : batteryText(Number(f.cells) || 1, f.cellType);
}

const save = () =>
	act(async () => {
		const saved = await run(
			actions.lab.saveCamera({
				...(c ? { id: c.id } : {}),
				brand: f.brand,
				name: f.name,
				kind: f.kind,
				format: f.format,
				mount: f.mount,
				fixedLens: f.mount ? '' : f.fixedLens,
				battery: batteryField(),
				batteryChangedOn: f.batteryChangedOn || null,
				shutterFastest: f.shutterFastest || null,
				shutterSlowest: f.shutterSlowest || null,
				serial: f.serial,
				acquiredOn: f.acquiredOn || null,
				priceCents: toCents(f.price),
				acquiredFrom: f.acquiredFrom,
				status: f.status,
				notes: f.notes,
			})
		);
		emit('saved', saved);
	});

const remove = () =>
	act(async () => {
		if (!c) return;
		if (!confirmDelete.value) {
			confirmDelete.value = true;
			return;
		}
		await run(actions.lab.deleteCamera({ id: c.id }));
		emit('deleted', c.id);
	});

const addEntry = () =>
	act(async () => {
		if (!c) return;
		const { stock, ...entry } = await run(
			actions.lab.addService({
				cameraId: c.id,
				lensId: null,
				on: svc.on,
				kind: svc.kind,
				costCents: toCents(svc.cost),
				note: svc.note,
				fromStock: svc.kind === 'battery' && svc.fromStock,
			})
		);
		emit('stock', stock);
		log.value = [entry, ...log.value].sort((a, b) => b.on.localeCompare(a.on));
		if (svc.kind === 'battery') f.batteryChangedOn = svc.on;
		svc.cost = '';
		svc.note = '';
		emit('service', log.value);
	});

const removeEntry = (id: string) =>
	act(async () => {
		const { stock } = await run(actions.lab.deleteService({ id }));
		emit('stock', stock);
		log.value = log.value.filter((e) => e.id !== id);
		emit('service', log.value);
	});
</script>

<style scoped>
.camera-form {
	display: grid;
	gap: 1.75rem;
}

.more summary {
	cursor: pointer;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.more[open] summary {
	margin-bottom: 0.75rem;
}

textarea.lab-input {
	resize: vertical;
}

.push-right {
	margin-left: auto;
}

.service {
	display: grid;
	gap: 0.75rem;
	padding-top: 1.25rem;
	border-top: 1px solid var(--gray-800);
}

.svc-form {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
	gap: 0.5rem;
}

.svc-form .wide {
	grid-column: 1 / -1;
}

.batt-grid {
	display: grid;
	grid-template-columns: 5rem minmax(0, 1fr) minmax(0, 1fr);
	gap: 0.75rem;
}

@media (max-width: 30em) {
	.batt-grid {
		grid-template-columns: 5rem minmax(0, 1fr);
	}

	.batt-grid > :last-child {
		grid-column: 1 / -1;
	}
}

.from-box {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: var(--text-sm);
}

.svc-form .lab-input {
	min-height: 2.5rem;
}
</style>
