<template>
	<div class="light-table">
		<!-- In the cameras -->
		<section class="lab-section" aria-labelledby="cams-h">
			<header class="row-head">
				<h2 id="cams-h" class="lab-h2">In the cameras</h2>
				<span class="lab-edge">{{ loaded.length ? `${loaded.length} loaded` : 'Nothing loaded' }}</span>
				<button v-if="storage.length" type="button" class="lab-btn lab-btn--quiet push" @click="openLoad()">Load a roll</button>
			</header>
			<div v-if="loaded.length" class="loaded">
				<article v-for="r in loaded" :key="r.id" class="lcard">
					<div class="lcard-top" :style="{ '--can-h': '68px' }">
						<FilmCanister :stock="r.stock.token ?? r.stock.id" :stock-label="r.stock.name" :stock-brand="r.stock.brand" />
						<div class="names">
							<span class="cam">{{ r.camera?.name ?? 'Unknown camera' }}</span>
							<span class="sub">{{ r.stock.name }}</span>
							<span class="sub">{{ isoLine(r) }}</span>
						</div>
						<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
					</div>
					<div class="frames" :title="`${r.frameCount} of ${r.exposures} frames logged`">
						<i v-for="n in Math.min(r.exposures, 40)" :key="n" :class="{ shot: n <= r.frameCount }"></i>
					</div>
					<div class="lcard-foot">
						<span class="lab-meta">
							<b class="count">{{ r.frameCount }}</b> / {{ r.exposures }} logged · loaded {{ formatDays(daysBetween(r.statusOn, today)) }}{{ daysBetween(r.statusOn, today) > 0 ? ' ago' : '' }}
						</span>
						<span class="lab-actions">
							<a class="lab-btn lab-btn--quiet" :href="`/photography/lab/shoot/?roll=${r.code}`">Log frames</a>
							<button type="button" class="lab-btn lab-btn--quiet" @click="openStep(r, 'shot')">Roll finished</button>
						</span>
					</div>
				</article>
			</div>
			<p v-else class="lab-empty">
				No film in any camera.
				<template v-if="storage.length"> <button type="button" class="lab-link" @click="openLoad()">Load a roll</button> from the fridge.</template>
				<template v-else> <a class="lab-link" href="/photography/lab/fridge/">Add film to the fridge</a> first.</template>
			</p>
		</section>

		<!-- The line -->
		<section class="lab-section" aria-labelledby="line-h">
			<header class="row-head">
				<h2 id="line-h" class="lab-h2">On the line</h2>
				<span class="lab-edge hide-touch">Drag a roll to its next stage</span>
			</header>
			<div class="line" role="list">
				<div
					v-for="(stage, i) in STAGES"
					:key="stage"
					class="col"
					:class="{ target: dropTarget === stage, droppable: dragRoll && nextStage(dragRoll.status) === stage }"
					role="listitem"
					:aria-label="STATUS_LABEL[stage]"
					@dragover="onDragOver($event, stage)"
					@dragleave="dropTarget = dropTarget === stage ? null : dropTarget"
					@drop="onDrop($event, stage)"
				>
					<div class="col-h">
						<span>{{ i + 1 }} · {{ STATUS_LABEL[stage] }}</span>
						<b>{{ counts[stage] }}</b>
					</div>

					<template v-if="stage === 'storage'">
						<div class="tile">
							<span class="big">{{ storage.length }}</span>
							<span class="lab-meta">{{ storage.length === 1 ? 'roll' : 'rolls' }} across {{ storageStocks }} {{ storageStocks === 1 ? 'stock' : 'stocks' }}</span>
						</div>
						<span v-if="expiredCount" class="lab-chip lab-chip--warn">{{ expiredCount }} expired</span>
						<span v-if="expiringCount" class="lab-chip">{{ expiringCount }} expire soon</span>
						<a class="lab-link small" href="/photography/lab/fridge/">Open the fridge</a>
					</template>

					<template v-else-if="stage === 'negatives'">
						<div class="tile">
							<span class="big">{{ negativesCount }}</span>
							<span class="lab-meta">{{ negativesCount === 1 ? 'roll' : 'rolls' }} filed</span>
						</div>
						<RollTicket v-for="r in recent" :key="r.id" :roll="r" :today="today" />
						<a class="lab-link small" href="/photography/lab/rolls/?status=negatives">All of them</a>
					</template>

					<template v-else>
						<RollTicket
							v-for="r in byStage[stage]"
							:key="r.id"
							:roll="r"
							:today="today"
							:usual-days="r.lab ? labStats[r.lab.id]?.medianDays ?? null : null"
							@next="openStep(r, nextStage(r.status)!)"
							@dragstart="dragRoll = r"
						/>
						<a v-if="stage === 'shot' && byStage.shot.length" class="lab-link small" href="/photography/lab/labs/">Send to a lab</a>
					</template>
				</div>
			</div>
		</section>

		<LabDialog :open="!!step" :title="step ? STEP_VERB[step.to] : ''" @close="step = null">
			<StepForm
				v-if="step"
				:key="`${step.roll.id}-${step.to}`"
				:roll="step.roll"
				:to="step.to"
				:choices="choices"
				:today="today"
				:binder-hints="binderHints"
				@done="stepped"
				@cancel="step = null"
			/>
		</LabDialog>

		<LabDialog :open="loading" title="Load a roll" @close="loading = false">
			<label class="lab-field">
				<span>Which roll</span>
				<select id="load-roll" v-model="loadId" class="lab-input lab-select">
					<option value="" disabled>Choose from the fridge</option>
					<optgroup v-for="[name, list] in storageByStock" :key="name" :label="name">
						<option v-for="r in list" :key="r.id" :value="r.id">{{ r.code }}{{ r.expires ? ` · exp ${formatExpiry(r.expires)}` : '' }}{{ r.storageSpot ? ` · ${r.storageSpot}` : '' }}</option>
					</optgroup>
				</select>
				<small class="lab-hint">Oldest dates first within each stock.</small>
			</label>
			<StepForm
				v-if="loadRoll"
				:key="loadRoll.id"
				:roll="loadRoll"
				to="camera"
				:choices="choices"
				:today="today"
				@done="stepped"
				@cancel="loading = false"
			/>
		</LabDialog>

		<div v-if="toast" class="toast" role="status">
			<span>{{ toast.text }}</span>
			<button v-if="toast.undo" type="button" class="lab-link" @click="undo(toast.undo)">Undo</button>
		</div>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, ref } from 'vue';

import { run, upsert } from '../../lib/lab/client';
import {
	daysBetween,
	expiryNote,
	formatDay,
	formatDays,
	formatExpiry,
	nextStage,
	pushPull,
	STAGES,
	STATUS_LABEL,
	STEP_VERB,
	type RollStatus,
	type RollView,
	type Stage,
	type StepChoices,
} from '../../lib/lab/inventory';
import type { LabStats } from '../../lib/lab/server/inventory';
import FilmCanister from '../film/FilmCanister.vue';
import LabDialog from './LabDialog.vue';
import RollTicket from './RollTicket.vue';
import StepForm from './StepForm.vue';

const props = defineProps<{
	rolls: RollView[];
	negativesCount: number;
	recentNegatives: RollView[];
	choices: StepChoices;
	labStats: Record<string, LabStats>;
	binderHints: string[];
	today: string;
}>();

const rolls = ref<RollView[]>([...props.rolls]);
const negativesCount = ref(props.negativesCount);
const recent = ref<RollView[]>([...props.recentNegatives]);
const step = ref<{ roll: RollView; to: RollStatus } | null>(null);
const loading = ref(false);
const loadId = ref('');
const dragRoll = ref<RollView | null>(null);
const dropTarget = ref<Stage | null>(null);
const toast = ref<{ text: string; undo?: string } | null>(null);
const error = ref('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const byStage = computed(() => {
	const map = Object.fromEntries(STAGES.map((s) => [s, [] as RollView[]])) as Record<Stage, RollView[]>;
	for (const r of rolls.value) if (r.status !== 'lost') map[r.status].push(r);
	// Longest-waiting first.
	for (const list of Object.values(map)) list.sort((a, b) => a.statusOn.localeCompare(b.statusOn) || a.code.localeCompare(b.code));
	return map;
});
const loaded = computed(() => byStage.value.camera);
const storage = computed(() => byStage.value.storage);
const counts = computed(() => ({ ...Object.fromEntries(STAGES.map((s) => [s, byStage.value[s].length])), negatives: negativesCount.value }) as Record<Stage, number>);
const storageStocks = computed(() => new Set(storage.value.map((r) => r.stock.id)).size);
const expiredCount = computed(() => storage.value.filter((r) => expiryNote(r.expires, props.today)?.expired).length);
const expiringCount = computed(() => storage.value.filter((r) => expiryNote(r.expires, props.today)?.soon).length);

const storageByStock = computed(() => {
	const map = new Map<string, RollView[]>();
	const sorted = [...storage.value].sort(
		(a, b) => a.stock.name.localeCompare(b.stock.name) || (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.code.localeCompare(b.code)
	);
	for (const r of sorted) {
		if (!map.has(r.stock.name)) map.set(r.stock.name, []);
		map.get(r.stock.name)!.push(r);
	}
	return [...map];
});
const loadRoll = computed(() => storage.value.find((r) => r.id === loadId.value) ?? null);

const isoLine = (r: RollView) => {
	const push = pushPull(r.stock.iso, r.shotAtIso);
	const iso = r.shotAtIso ?? r.stock.iso;
	return [iso ? `ISO ${iso}` : null, push].filter(Boolean).join(' · ');
};

function openStep(roll: RollView, to: RollStatus) {
	error.value = '';
	step.value = { roll, to };
}

function openLoad() {
	loadId.value = storageByStock.value[0]?.[1][0]?.id ?? '';
	loading.value = true;
}

function showToast(text: string, undoId?: string) {
	toast.value = { text, undo: undoId };
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toast.value = null), 7000);
}

function place(view: RollView) {
	if (view.status === 'negatives' || view.status === 'lost') {
		rolls.value = rolls.value.filter((r) => r.id !== view.id);
		if (view.status === 'negatives') {
			negativesCount.value++;
			recent.value = [view, ...recent.value].slice(0, 3);
		}
	} else {
		if (!rolls.value.some((r) => r.id === view.id)) {
			// Coming back from "negatives" after an undo.
			if (recent.value.some((r) => r.id === view.id)) negativesCount.value--;
			recent.value = recent.value.filter((r) => r.id !== view.id);
		}
		rolls.value = upsert(rolls.value, view);
	}
}

function stepped(view: RollView) {
	place(view);
	step.value = null;
	loading.value = false;
	showToast(`${view.code} is now ${STATUS_LABEL[view.status].toLowerCase()}.`, view.id);
}

async function undo(rollId: string) {
	toast.value = null;
	try {
		place(await run(actions.lab.undoRollStep({ rollId })));
	} catch (e) {
		error.value = (e as Error).message;
	}
}

/* drag and drop: a roll can be dropped on its next stage only */
function onDragOver(e: DragEvent, stage: Stage) {
	if (dragRoll.value && nextStage(dragRoll.value.status) === stage) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropTarget.value = stage;
	}
}

function onDrop(e: DragEvent, stage: Stage) {
	e.preventDefault();
	const roll = dragRoll.value;
	dropTarget.value = null;
	dragRoll.value = null;
	if (roll && nextStage(roll.status) === stage) openStep(roll, stage);
}
</script>

<style scoped>
.light-table {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

.row-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.5rem 1rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

.push {
	margin-left: auto;
}

.loaded {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	gap: 1rem;
}

.lcard {
	display: grid;
	gap: 0.9rem;
	padding: 1rem 1.1rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.6rem;
}

.lcard-top {
	display: flex;
	align-items: center;
	gap: 0.9rem;
}

.names {
	display: grid;
	gap: 0.1rem;
	min-width: 0;
}

.cam {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	line-height: 1.15;
	color: var(--gray-0);
}

.sub {
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--gray-300);
}

.lcard-top .lab-code {
	margin-left: auto;
	align-self: start;
}

/* The roll as a strip of frames; logged ones show as exposed negative. */
.frames {
	position: relative;
	display: flex;
	gap: 2px;
	padding: 8px 4px;
	border-radius: 2px;
	background: var(--lab-film);
}

.frames::before,
.frames::after {
	content: '';
	position: absolute;
	inset-inline: 4px;
	height: 3px;
	background: repeating-linear-gradient(90deg, var(--lab-sprocket) 0 4px, transparent 4px 8px);
	opacity: 0.8;
}

.frames::before {
	top: 2.5px;
}

.frames::after {
	bottom: 2.5px;
}

.frames i {
	flex: 1;
	height: 14px;
	border-radius: 1px;
	background: var(--lab-film-frame);
}

.frames i.shot {
	background: oklch(63% 0.12 58);
}

.count {
	color: var(--gray-0);
	font-weight: 600;
}

.lcard-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}

/* The line: six columns; a sideways-scrolling row of them on small screens. */
.line {
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	gap: 0.6rem;
}

@media (max-width: 72em) {
	.line {
		grid-template-columns: repeat(6, minmax(13.5rem, 1fr));
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		padding-bottom: 0.5rem;
	}

	.col {
		scroll-snap-align: start;
	}
}

.col {
	display: grid;
	align-content: start;
	gap: 0.55rem;
	min-height: 12rem;
	padding: 0.65rem;
	border-radius: 0.6rem;
	background: var(--gray-900);
	outline: 2px dashed transparent;
	outline-offset: -2px;
	transition: outline-color 0.15s ease;
}

.col.droppable {
	outline-color: var(--gray-600);
}

.col.target {
	outline-color: var(--accent-regular);
}

.col-h {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	padding: 0.1rem 0.15rem 0.25rem;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.col-h b {
	color: var(--gray-0);
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.tile {
	display: grid;
	gap: 0.25rem;
	padding: 0.25rem 0.2rem;
}

.big {
	font-family: var(--font-brand);
	font-size: var(--text-4xl);
	font-weight: 400;
	font-variation-settings: 'opsz' 72;
	line-height: 1;
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

.small {
	justify-self: start;
	font-size: var(--text-sm);
}

.lab-chip {
	justify-self: start;
}

@media (hover: none) {
	.hide-touch {
		display: none;
	}
}

.toast {
	position: fixed;
	z-index: 50;
	left: 50%;
	bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
	translate: -50% 0;
	display: flex;
	align-items: center;
	gap: 1rem;
	max-width: calc(100vw - 2rem);
	padding: 0.7rem 1.1rem;
	border-radius: 999px;
	background: var(--accent-regular);
	color: var(--accent-text-over);
	box-shadow: var(--shadow-md);
}

.toast .lab-link {
	color: inherit;
	text-decoration-color: currentColor;
}
</style>
