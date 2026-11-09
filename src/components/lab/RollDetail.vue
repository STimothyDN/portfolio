<template>
	<div class="roll-page">
		<header class="roll-head">
			<div class="can" :style="{ '--can-h': '128px' }">
				<FilmCanister :stock="roll.stock.token ?? roll.stock.id" :stock-label="roll.stock.name" :stock-brand="roll.stock.brand" />
			</div>
			<div class="head-text">
				<a class="lab-edge crumbs" href="/photography/lab/rolls/">← Rolls</a>
				<span class="lab-code big-code">{{ roll.code }}</span>
				<h1 class="lab-title">{{ roll.title || roll.stock.name }}</h1>
				<p class="lab-meta lab-mono summary">
					<span v-for="(part, i) in summary" :key="i">{{ part }}</span>
				</p>
				<span class="lab-chip" :class="{ 'lab-chip--warn': roll.status === 'lost' }">{{ STATUS_LABEL[roll.status] }}</span>
			</div>
		</header>

		<RollStrip
			:code="roll.code"
			:stock-name="roll.stock.name"
			:profile="strip?.profile ?? null"
			:scans="strip?.scans ?? null"
			:frames="frames"
			:exposures="roll.exposures"
		/>

		<div class="grid">
			<div class="col-main">
				<!-- Timeline -->
				<section class="lab-section" aria-labelledby="tl-h">
					<header><h2 id="tl-h" class="lab-h2">Where it’s been</h2></header>
					<ol class="steps">
						<li v-for="stage in STAGES" :key="stage" class="step" :class="stepState(stage)">
							<span class="pip" aria-hidden="true">{{ stepState(stage) === 'done' ? '✓' : STAGES.indexOf(stage) + 1 }}</span>
							<div class="step-body">
								<span class="step-t">{{ STATUS_LABEL[stage] }}</span>
								<template v-for="ev in eventsFor(stage)" :key="ev.id">
									<form v-if="editing === ev.id" class="ev-edit" @submit.prevent="saveEvent(ev.id)">
										<input :id="`ev-on-${ev.id}`" v-model="evOn" class="lab-input" type="date" required aria-label="Date" />
										<input :id="`ev-note-${ev.id}`" v-model="evNote" class="lab-input" type="text" maxlength="300" placeholder="Note" aria-label="Note" />
										<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy">Save</button>
										<button type="button" class="lab-btn lab-btn--quiet" @click="editing = null">Cancel</button>
									</form>
									<span v-else class="step-d">
										{{ formatDay(ev.on) }}<template v-if="ev.note"> · {{ ev.note }}</template>
										<button type="button" class="lab-link edit" @click="startEdit(ev)">edit</button>
									</span>
								</template>
								<span v-if="stage === roll.status && stageDetail" class="step-d">{{ stageDetail }}</span>
								<div v-if="stage === roll.status" class="lab-actions step-actions">
									<button v-if="next" type="button" class="lab-btn" @click="openStep(next)">{{ STEP_VERB[next] }}</button>
									<button type="button" class="lab-btn lab-btn--quiet" @click="openStep('lost')">Mark lost or ruined</button>
									<button v-if="events.length > 1" type="button" class="lab-link small" :disabled="busy" @click="undo">Undo last step</button>
								</div>
							</div>
						</li>
						<li v-if="roll.status === 'lost'" class="step now lost">
							<span class="pip" aria-hidden="true">!</span>
							<div class="step-body">
								<span class="step-t">{{ STATUS_LABEL.lost }}</span>
								<span v-for="ev in eventsFor('lost')" :key="ev.id" class="step-d">{{ formatDay(ev.on) }}<template v-if="ev.note"> · {{ ev.note }}</template></span>
								<div class="lab-actions step-actions">
									<button type="button" class="lab-link small" :disabled="busy" @click="undo">Undo</button>
								</div>
							</div>
						</li>
					</ol>
				</section>

				<!-- Scans -->
				<section class="lab-section" aria-labelledby="scans-h">
					<header>
						<h2 id="scans-h" class="lab-h2">Scans</h2>
					</header>
					<template v-if="desk">
						<p>
							On the film desk as <b>{{ desk.title }}</b>: {{ desk.count }} scans, developed {{ formatDay(desk.developed) }}.
						</p>
						<div class="lab-actions">
							<a class="lab-btn lab-btn--quiet" href="/photography/">Open the film desk</a>
							<button type="button" class="lab-btn lab-btn--quiet lab-btn--danger" :disabled="busy" @click="link(null)">Unlink</button>
						</div>
					</template>
					<form v-else class="link-form" @submit.prevent="link(linkId)">
						<p class="lab-meta">
							Not linked to the public film desk.
							{{ choices.deskRolls.length ? 'Pick its scans once they’re uploaded:' : 'Every roll on the desk is already linked.' }}
						</p>
						<template v-if="choices.deskRolls.length">
							<select id="link-desk" v-model="linkId" class="lab-input lab-select" required>
								<option value="" disabled>Choose a roll on the desk</option>
								<option v-for="r in deskOptions" :key="r.id" :value="r.id">{{ r.title }} · {{ r.stock }} · {{ formatDay(r.developed) }}</option>
							</select>
							<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy || !linkId">Link scans</button>
						</template>
					</form>
				</section>
			</div>

			<!-- Details -->
			<aside class="col-side">
				<form class="lab-form details" @submit.prevent="saveDetails">
					<h2 class="lab-h2">Details</h2>
					<label class="lab-field">
						<span>Title</span>
						<input id="d-title" v-model="f.title" class="lab-input" type="text" maxlength="120" placeholder="What you shot" />
					</label>
					<fieldset>
						<legend>Film</legend>
						<label class="lab-field">
							<span>Stock</span>
							<select id="d-stock" v-model="f.stockId" class="lab-input lab-select">
								<option v-for="s in stocks" :key="s.id" :value="s.id">{{ s.name }}</option>
							</select>
						</label>
						<div class="lab-row2">
							<label class="lab-field"><span>Exposures</span><input id="d-exp" v-model="f.exposures" class="lab-input" type="number" min="1" max="100" /></label>
							<label class="lab-field"><span>Expires</span><input id="d-expires" v-model="f.expires" class="lab-input" type="month" /></label>
						</div>
						<label class="lab-field"><span>Kept in</span><input id="d-spot" v-model="f.storageSpot" class="lab-input" type="text" maxlength="60" /></label>
					</fieldset>
					<fieldset>
						<legend>Bought</legend>
						<div class="lab-row2">
							<label class="lab-field"><span>On</span><input id="d-bought" v-model="f.purchasedOn" class="lab-input" type="date" /></label>
							<label class="lab-field"><span>Price ($)</span><input id="d-price" v-model="f.price" class="lab-input" type="number" min="0" step="0.01" /></label>
						</div>
						<label class="lab-field"><span>From</span><input id="d-shop" v-model="f.purchasedFrom" class="lab-input" type="text" maxlength="120" /></label>
					</fieldset>
					<fieldset>
						<legend>Shooting</legend>
						<label class="lab-field">
							<span>Camera</span>
							<select id="d-camera" v-model="f.cameraId" class="lab-input lab-select">
								<option value="">Not recorded</option>
								<option v-for="c in allCameras" :key="c.id" :value="c.id">{{ c.name }}</option>
							</select>
						</label>
						<label class="lab-field">
							<span>Rated at ISO</span>
							<input id="d-iso" v-model="f.shotAtIso" class="lab-input" type="number" min="1" max="12800" />
							<small v-if="push" class="lab-hint">{{ push }}</small>
						</label>
					</fieldset>
					<fieldset>
						<legend>Lab</legend>
						<label class="lab-field">
							<span>Lab</span>
							<select id="d-lab" v-model="f.labId" class="lab-input lab-select">
								<option value="">Not recorded</option>
								<option v-for="l in choices.labs" :key="l.id" :value="l.id">{{ l.name }}</option>
							</select>
						</label>
						<div class="lab-row2">
							<label class="lab-field"><span>Order</span><input id="d-order" v-model="f.labOrder" class="lab-input" type="text" maxlength="60" /></label>
							<label class="lab-field"><span>Cost ($)</span><input id="d-cost" v-model="f.devCost" class="lab-input" type="number" min="0" step="0.01" /></label>
						</div>
						<label class="lab-field"><span>Notes for the lab</span><input id="d-devnotes" v-model="f.devNotes" class="lab-input" type="text" maxlength="300" /></label>
						<label class="lab-field"><span>Negatives filed in</span><input id="d-neg" v-model="f.negativesAt" class="lab-input" type="text" maxlength="80" placeholder="Binder 1, page 23" /></label>
					</fieldset>
					<label class="lab-field">
						<span>Notes</span>
						<textarea id="d-notes" v-model="f.notes" class="lab-input" rows="4" maxlength="2000"></textarea>
					</label>
					<p v-if="saved" class="lab-hint" role="status">Saved.</p>
					<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
					<div class="lab-actions">
						<button type="submit" class="lab-btn" :disabled="busy">Save details</button>
						<button type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove">
							{{ confirmDelete ? 'Delete it for good?' : 'Delete roll' }}
						</button>
					</div>
				</form>
			</aside>
		</div>

		<LabDialog :open="!!stepTo" :title="stepTo ? STEP_VERB[stepTo] : ''" @close="stepTo = null">
			<StepForm v-if="stepTo" :key="stepTo" :roll="roll" :to="stepTo" :choices="choices" :today="today" :binder-hints="binderHints" @done="stepped" @cancel="stepTo = null" />
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, reactive, ref } from 'vue';

import { dollars, num, run } from '../../lib/lab/client';
import {
	daysBetween,
	formatDay,
	formatDays,
	nextStage,
	pushPull,
	STAGES,
	STATUS_LABEL,
	STEP_VERB,
	toCents,
	type RollEventView,
	type RollStatus,
	type RollView,
	type StepChoices,
	type StockView,
} from '../../lib/lab/inventory';
import FilmCanister from '../film/FilmCanister.vue';
import LabDialog from './LabDialog.vue';
import RollStrip from './RollStrip.vue';
import StepForm from './StepForm.vue';
import type { NegativeProfileKey } from '../film/negative';

interface DeskPreview {
	id: string;
	title: string;
	developed: string;
	count: number;
	scans: { src: string; frame: number; w?: number; h?: number }[];
}

const props = defineProps<{
	roll: RollView;
	events: RollEventView[];
	choices: StepChoices;
	stocks: StockView[];
	allCameras: { id: string; name: string }[];
	desk: DeskPreview | null;
	binderHints: string[];
	today: string;
	strip: {
		profile: NegativeProfileKey;
		scans: { src: string; full: string; frame: number; w?: number; h?: number; exposure: number }[];
	} | null;
	frames: { number: number; aperture: number | null; shutter: string | null; flash: boolean }[];
}>();

const roll = ref<RollView>(props.roll);
const events = ref<RollEventView[]>([...props.events]);
const desk = ref<DeskPreview | null>(props.desk);
const stepTo = ref<RollStatus | null>(null);
const busy = ref(false);
const error = ref('');
const saved = ref(false);
const confirmDelete = ref(false);
const editing = ref<string | null>(null);
const evOn = ref('');
const evNote = ref('');
const linkId = ref('');

const next = computed(() => nextStage(roll.value.status));
const push = computed(() => pushPull(roll.value.stock.iso, num(f.shotAtIso)));
const summary = computed(() =>
	[
		roll.value.title ? roll.value.stock.name : null,
		`${roll.value.exposures} exp`,
		roll.value.stock.process,
		roll.value.camera?.name,
		roll.value.lab?.name,
	].filter(Boolean)
);

const stageDetail = computed(() => {
	const r = roll.value;
	const n = daysBetween(r.statusOn, props.today);
	const days = n > 0 ? `for ${formatDays(n)}` : 'since today';
	if (r.status === 'storage') return [r.storageSpot, r.expires ? `expires ${r.expires.slice(5)}/${r.expires.slice(2, 4)}` : null].filter(Boolean).join(' · ');
	if (r.status === 'camera') return `In the ${r.camera?.name ?? 'camera'} ${days}`;
	if (r.status === 'lab') return `At ${r.lab?.name ?? 'the lab'} ${days}${r.labOrder ? ` · order ${r.labOrder}` : ''}`;
	if (r.status === 'negatives' && r.negativesAt) return `Filed in ${r.negativesAt}`;
	return '';
});

const stageRank = (s: RollStatus) => STAGES.indexOf(s as (typeof STAGES)[number]);
function stepState(stage: (typeof STAGES)[number]) {
	if (roll.value.status === 'lost') return events.value.some((e) => e.status === stage) ? 'done' : 'later';
	const cur = stageRank(roll.value.status);
	const i = stageRank(stage);
	return i < cur ? 'done' : i === cur ? 'now' : 'later';
}
const eventsFor = (stage: RollStatus) => events.value.filter((e) => e.status === stage);

const deskOptions = computed(() => {
	const r = roll.value;
	const score = (d: StepChoices['deskRolls'][number]) =>
		(d.stock === r.stock.name ? 4 : 0) + (r.camera && d.camera === r.camera.name ? 2 : 0) + (r.lab && d.lab === r.lab.name ? 1 : 0);
	return [...props.choices.deskRolls].sort((a, b) => score(b) - score(a));
});

const f = reactive(formFrom(props.roll));
function formFrom(r: RollView) {
	return {
		title: r.title ?? '',
		stockId: r.stock.id,
		exposures: r.exposures as string | number,
		expires: r.expires ?? '',
		storageSpot: r.storageSpot ?? '',
		purchasedOn: r.purchasedOn ?? '',
		price: dollars(r.priceCents) as string | number,
		purchasedFrom: r.purchasedFrom ?? '',
		cameraId: r.camera?.id ?? '',
		shotAtIso: (r.shotAtIso ?? '') as string | number,
		labId: r.lab?.id ?? '',
		labOrder: r.labOrder ?? '',
		devCost: dollars(r.devCostCents) as string | number,
		devNotes: r.devNotes ?? '',
		negativesAt: r.negativesAt ?? '',
		notes: r.notes ?? '',
	};
}

async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
	busy.value = true;
	error.value = '';
	saved.value = false;
	try {
		return await fn();
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

function openStep(to: RollStatus) {
	stepTo.value = to;
}

/** After a move: take the new roll and add its step to the timeline. */
function stepped(view: RollView) {
	events.value = [...events.value, { id: `new-${Date.now()}`, status: view.status, on: view.statusOn, note: null }];
	roll.value = view;
	Object.assign(f, formFrom(view));
	stepTo.value = null;
	if (view.publicRollId && !desk.value) location.reload();
}

async function undo() {
	await act(async () => {
		const view = await run(actions.lab.undoRollStep({ rollId: roll.value.id }));
		// Drop the newest step from the list (the server just removed it).
		const idx = events.value.map((e) => e.status).lastIndexOf(roll.value.status);
		if (idx !== -1) events.value = events.value.filter((_, i) => i !== idx);
		roll.value = view;
	});
}

function startEdit(ev: RollEventView) {
	if (ev.id.startsWith('new-')) return location.reload();
	editing.value = ev.id;
	evOn.value = ev.on;
	evNote.value = ev.note ?? '';
}

async function saveEvent(id: string) {
	await act(async () => {
		const updated = await run(actions.lab.editEvent({ eventId: id, on: evOn.value, note: evNote.value }));
		events.value = events.value.map((e) => (e.id === id ? updated : e)).sort((a, b) => a.on.localeCompare(b.on));
		editing.value = null;
	});
}

async function link(publicRollId: string | null) {
	await act(async () => {
		await run(actions.lab.linkDeskRoll({ rollId: roll.value.id, publicRollId }));
		location.reload();
	});
}

async function saveDetails() {
	const view = await act(() =>
		run(
			actions.lab.updateRoll({
				rollId: roll.value.id,
				title: f.title,
				stockId: f.stockId,
				exposures: num(f.exposures) ?? roll.value.exposures,
				expires: f.expires || null,
				storageSpot: f.storageSpot,
				purchasedOn: f.purchasedOn || null,
				priceCents: toCents(f.price),
				purchasedFrom: f.purchasedFrom,
				cameraId: f.cameraId || null,
				shotAtIso: num(f.shotAtIso),
				labId: f.labId || null,
				labOrder: f.labOrder,
				devCostCents: toCents(f.devCost),
				devNotes: f.devNotes,
				negativesAt: f.negativesAt,
				notes: f.notes,
			})
		)
	);
	if (view) {
		roll.value = view;
		saved.value = true;
	}
}

async function remove() {
	if (!confirmDelete.value) {
		confirmDelete.value = true;
		return;
	}
	await act(async () => {
		await run(actions.lab.deleteRoll({ rollId: roll.value.id }));
		location.assign('/photography/lab/rolls/');
	});
}
</script>

<style scoped>
.roll-page {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

.roll-head {
	display: flex;
	align-items: center;
	gap: clamp(1.25rem, 4vw, 2.5rem);
}

.can {
	display: grid;
	place-items: center;
	flex: none;
	padding-inline: 0.5rem;
}

.head-text {
	display: grid;
	gap: 0.55rem;
	justify-items: start;
	min-width: 0;
}

.crumbs {
	text-decoration: none;
}

.summary {
	display: flex;
	flex-wrap: wrap;
	gap: 0 0.5rem;
}

.summary span {
	white-space: nowrap;
}

.summary span + span::before {
	content: '·';
	margin-right: 0.5rem;
}

.big-code {
	font-size: 1.6rem;
}

.grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
	gap: clamp(2rem, 5vw, 4rem);
	align-items: start;
}

@media (max-width: 60em) {
	.grid {
		grid-template-columns: minmax(0, 1fr);
	}
}

.col-main {
	display: grid;
	gap: 2.5rem;
}

.steps {
	list-style: none;
	padding: 0;
	display: grid;
}

.step {
	position: relative;
	display: grid;
	grid-template-columns: 1.6rem minmax(0, 1fr);
	gap: 0.9rem;
	padding-bottom: 1.15rem;
}

.step::before {
	content: '';
	position: absolute;
	left: calc(0.8rem - 1px);
	top: 1.7rem;
	bottom: 0.15rem;
	width: 2px;
	background: var(--gray-800);
}

.step:last-child::before {
	display: none;
}

.pip {
	display: grid;
	place-items: center;
	width: 1.6rem;
	height: 1.6rem;
	border-radius: 50%;
	border: 1.5px solid var(--gray-700);
	background: var(--gray-999);
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--gray-300);
	z-index: 1;
}

.step.done .pip {
	background: var(--accent-regular);
	border-color: var(--accent-regular);
	color: var(--accent-text-over);
}

.step.now .pip {
	border-color: var(--gray-0);
	color: var(--gray-0);
	box-shadow: 0 0 0 4px var(--gray-900);
}

.step.lost .pip {
	border-color: var(--lab-warn);
	color: var(--lab-warn);
}

.step-body {
	display: grid;
	gap: 0.3rem;
	padding-top: 0.15rem;
}

.step-t {
	color: var(--gray-0);
	font-size: var(--text-md);
	line-height: 1.2;
}

.step.later .step-t {
	color: var(--gray-300);
}

.step-d {
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--gray-300);
}

.edit {
	margin-left: 0.5rem;
	font-family: var(--font-body);
	font-size: var(--text-sm);
}

.ev-edit {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.ev-edit .lab-input {
	flex: 1 1 9rem;
	min-height: 2.4rem;
}

.step-actions {
	margin-top: 0.4rem;
}

.small {
	font-size: var(--text-sm);
}

.thumbs {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
	gap: 0.5rem;
}

.thumbs img {
	width: 100%;
	height: auto;
	aspect-ratio: 3 / 2;
	object-fit: cover;
	border-radius: 2px;
	background: var(--gray-900);
}

.link-form {
	display: grid;
	gap: 0.75rem;
	justify-items: start;
}

.link-form select {
	max-width: 100%;
}

.details {
	padding: 1.25rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
}

fieldset {
	display: grid;
	gap: 0.75rem;
	padding: 0;
	border: 0;
}

legend {
	padding: 0 0 0.35rem;
	font-family: var(--font-brand);
	font-size: var(--text-md);
	font-weight: 560;
	color: var(--gray-0);
}

textarea.lab-input {
	resize: vertical;
}

.push-right {
	margin-left: auto;
}

@media (max-width: 30em) {
	.roll-head {
		align-items: flex-start;
	}

	.can {
		--can-h: 92px !important;
	}
}
</style>
