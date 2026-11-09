<template>
	<section id="frames" class="lab-section frames" aria-labelledby="frames-h">
		<header class="fr-head">
			<div>
				<h2 id="frames-h" class="lab-h2">Frames</h2>
				<p class="lab-meta">
					{{ list.length ? `${list.length} of ${exposures} logged` : 'None logged yet.' }}
					<template v-if="inCamera"> <a class="lab-link" :href="`/photography/lab/shoot/?roll=${code}`">Log frames in shooting mode</a></template>
					<template v-if="list.length"> · <a class="lab-link" :href="`/photography/lab/frames/?q=${code}`">On the contact sheet</a></template>
				</p>
			</div>
			<button v-if="!adding" type="button" class="lab-btn lab-btn--quiet" @click="startAdd">Add a frame</button>
		</header>

		<div v-if="list.length || adding" class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col">#</th>
						<th scope="col">Exposure</th>
						<th scope="col">Lens</th>
						<th scope="col">Taken</th>
						<th scope="col">Where</th>
						<th v-if="scanFiles.length" scope="col">Scan</th>
						<th scope="col">Note</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					<template v-for="f in list" :key="f.clientId">
						<tr v-if="editing !== f.clientId">
							<td class="num">{{ f.number }}</td>
							<td class="mono">{{ formatExposure(f) }}</td>
							<td>{{ lensName(f) }}</td>
							<td class="mono">{{ frameTime(f, true) }}</td>
							<td>
								<a v-if="f.lat != null && f.lng != null" class="lab-link" :href="mapUrl(f)" target="_blank" rel="noopener">map</a>
							</td>
							<td v-if="scanFiles.length" class="mono">
								{{ scanOf(f) ? `scan ${scanOf(f)}` : '—' }}<span v-if="f.scanFilename" class="pin"> · pinned</span>
							</td>
							<td class="note">{{ f.note }}</td>
							<td class="acts">
								<button type="button" class="lab-link" @click="startEdit(f)">Edit</button>
							</td>
						</tr>
						<tr v-else class="edit-row">
							<td :colspan="scanFiles.length ? 8 : 7">
								<FrameFields v-model="draft" :lenses="lenses" />
								<label v-if="scanFiles.length" class="lab-field pin-field">
									<span>Scan</span>
									<select :id="`pin-${f.clientId}`" v-model="draftPin" class="lab-input lab-select">
										<option :value="null">Line up automatically{{ autoScan(f) ? ` (scan ${autoScan(f)})` : '' }}</option>
										<option v-for="(file, i) in scanFiles" :key="file" :value="file">Pin to scan {{ i + 1 }} · {{ file }}</option>
									</select>
								</label>
								<div class="lab-actions">
									<button type="button" class="lab-btn lab-btn--quiet" :disabled="busy" @click="save(f)">Save</button>
									<button type="button" class="lab-btn lab-btn--quiet" @click="editing = null">Cancel</button>
									<button type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove(f)">Delete frame</button>
								</div>
							</td>
						</tr>
					</template>
					<tr v-if="adding" class="edit-row">
						<td :colspan="scanFiles.length ? 8 : 7">
							<FrameFields v-model="draft" :lenses="lenses" />
							<div class="lab-actions">
								<button type="button" class="lab-btn lab-btn--quiet" :disabled="busy" @click="add">Add frame {{ draft.number }}</button>
								<button type="button" class="lab-btn lab-btn--quiet" @click="adding = false">Cancel</button>
							</div>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
	</section>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { alignScans } from '../../lib/lab/alignment';

import { run } from '../../lib/lab/client';
import { formatExposure, frameTime, nextFrameNumber, type FrameInput, type FrameView, type LensView } from '../../lib/lab/inventory';
import FrameFields, { type FrameDraft } from './FrameFields.vue';

const props = defineProps<{
	rollId: string;
	code: string;
	exposures: number;
	inCamera: boolean;
	cameraId: string | null;
	rewoundAtFrame: number | null;
	frames: FrameView[];
	lenses: LensView[];
	scanFiles: string[];
	firstScanFrame: number;
}>();

const firstScan = ref(props.firstScanFrame);
const draftPin = ref<string | null>(null);

/** Scan number (1-based) each frame lines up with, under the roll's alignment and pins. */
const scanIndex = computed(() => {
	const out = new Map<string, number>();
	const aligned = alignScans(props.scanFiles, list.value, firstScan.value);
	props.scanFiles.forEach((file, i) => {
		const f = aligned.get(file);
		if (f) out.set(f.clientId, i + 1);
	});
	return out;
});
const scanOf = (f: FrameView) => scanIndex.value.get(f.clientId) ?? null;
/** Where it would land without a pin. */
const autoScan = (f: FrameView) => {
	const i = f.number - firstScan.value;
	return i >= 0 && i < props.scanFiles.length ? i + 1 : null;
};

// The strip above (another island) moves the alignment; frames saved here move the strip.
function onAlign(e: Event) {
	const d = (e as CustomEvent<{ rollId: string; firstScanFrame: number }>).detail;
	if (d.rollId === props.rollId) firstScan.value = d.firstScanFrame;
}
onMounted(() => window.addEventListener('lab:align', onAlign));
onBeforeUnmount(() => window.removeEventListener('lab:align', onAlign));
const announce = () =>
	window.dispatchEvent(new CustomEvent('lab:frames', { detail: { rollId: props.rollId, frames: list.value } }));

const list = ref<FrameView[]>([...props.frames]);
const editing = ref<string | null>(null);
const adding = ref(false);
const busy = ref(false);
const error = ref('');
const draft = ref<FrameDraft>({ number: 1, aperture: null, shutter: null, lensId: null, flash: false, note: '' });

const lensById = computed(() => new Map(props.lenses.map((l) => [l.id, l.name])));
const lensName = (f: FrameView) => (f.lensId ? lensById.value.get(f.lensId) ?? '' : f.focalLength ? `${f.focalLength}mm` : '');
const mapUrl = (f: FrameView) => `https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lng}#map=15/${f.lat}/${f.lng}`;

function startEdit(f: FrameView) {
	adding.value = false;
	editing.value = f.clientId;
	draft.value = { number: f.number, aperture: f.aperture, shutter: f.shutter, lensId: f.lensId, flash: f.flash, note: f.note ?? '' };
	draftPin.value = f.scanFilename;
}

function startAdd() {
	editing.value = null;
	const last = list.value.at(-1);
	draft.value = {
		number: nextFrameNumber(list.value, props.rewoundAtFrame),
		aperture: last?.aperture ?? null,
		shutter: last?.shutter ?? null,
		lensId: last?.lensId ?? null,
		flash: false,
		note: '',
	};
	adding.value = true;
}

async function send(frames: FrameInput[]) {
	busy.value = true;
	error.value = '';
	try {
		list.value = await run(actions.lab.syncFrames({ frames }));
		announce();
		return true;
	} catch (e) {
		error.value = (e as Error).message;
		return false;
	} finally {
		busy.value = false;
	}
}

const fromView = ({ id: _id, ...f }: FrameView): FrameInput => f;
const applyDraft = (f: FrameInput): FrameInput => ({
	...f,
	number: Number(draft.value.number) || f.number,
	aperture: draft.value.aperture,
	shutter: draft.value.shutter,
	lensId: draft.value.lensId,
	flash: draft.value.flash,
	note: draft.value.note.trim() || null,
});

async function save(f: FrameView) {
	if (!(await send([applyDraft(fromView(f))]))) return;
	if (draftPin.value !== f.scanFilename) {
		busy.value = true;
		try {
			list.value = await run(actions.lab.pinFrameScan({ frameId: f.id, scanFilename: draftPin.value }));
			announce();
		} catch (e) {
			error.value = (e as Error).message;
			return;
		} finally {
			busy.value = false;
		}
	}
	editing.value = null;
}

async function remove(f: FrameView) {
	if (await send([{ ...fromView(f), deleted: true }])) editing.value = null;
}

async function add() {
	const f = applyDraft({
		clientId: crypto.randomUUID(),
		rollId: props.rollId,
		number: 0,
		// Added afterwards: no time or place.
		shotAt: 0,
		tzOffset: 0,
		cameraId: props.cameraId,
		lensId: null,
		focalLength: null,
		aperture: null,
		shutter: null,
		flash: false,
		lat: null,
		lng: null,
		accuracy: null,
		note: null,
	});
	if (await send([f])) adding.value = false;
}
</script>

<style scoped>
.fr-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: flex-end;
	gap: 0.75rem 1.5rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

.fr-head > div {
	display: grid;
	gap: 0.3rem;
}

.table-wrap {
	overflow-x: auto;
}

table {
	width: 100%;
	min-width: 40rem;
	border-collapse: collapse;
	font-size: var(--text-base);
}

th,
td {
	padding: 0.55rem 0.6rem;
	text-align: left;
	vertical-align: top;
	border-bottom: 1px solid var(--gray-800);
}

th {
	font-weight: 400;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.num {
	font-family: var(--font-mono);
	color: var(--lab-edge-ink);
	font-variant-numeric: tabular-nums;
}

:root:not(.theme-dark) .num {
	color: oklch(48% 0.12 58);
}

.mono {
	font-family: var(--font-mono);
	font-size: 0.82rem;
	white-space: nowrap;
}

.pin {
	color: var(--lab-edge-text);
}

.pin-field {
	margin-top: 0.75rem;
	max-width: 32rem;
}

.note {
	font-style: italic;
	color: var(--gray-200);
}

.acts {
	text-align: right;
}

.edit-row td {
	padding-block: 0.9rem;
	background: var(--gray-900);
}

.edit-row .lab-actions {
	margin-top: 0.75rem;
}

.push-right {
	margin-left: auto;
}
</style>
