<template>
	<div class="light-table">
		<!-- A status line in edge print: where everything is, at a glance -->
		<p class="ticker lab-edge-print" aria-label="Where your film is">
			<span v-for="t in ticker" :key="t.label" class="tick" :class="{ zero: !t.n }">▸ {{ t.n }} {{ t.label }}</span>
		</p>

		<!-- In the cameras -->
		<section class="lab-section" aria-labelledby="cams-h">
			<header class="row-head">
				<h2 id="cams-h" class="lab-h2">In the cameras</h2>
				<span class="lab-edge">{{ loaded.length ? `${loaded.length} loaded` : 'Nothing loaded' }}</span>
				<button v-if="storage.length" type="button" class="lab-btn lab-btn--quiet push" @click="openLoad()">Load a roll</button>
			</header>
			<!-- The owner can show what's loaded on the public film desk (from the next publish). -->
			<div v-if="share !== null" class="desk-share">
				<button id="share-loaded" type="button" class="switch" role="switch" :aria-checked="share" :disabled="sharing" aria-labelledby="share-loaded-l" @click="toggleShare"></button>
				<span id="share-loaded-l" class="lab-meta">Show what’s loaded on the film desk<template v-if="share && newestLoaded?.camera">: “In the {{ newestLoaded.camera.name }}: {{ newestLoaded.stock.name }}, {{ newestLoaded.frameCount }} of {{ newestLoaded.exposures }}”</template></span>
				<PublishButton v-if="shareChanged" quiet />
			</div>
			<div v-if="loaded.length" class="loaded">
				<article v-for="(r, ci) in loaded" :key="r.id" class="lcard" :style="{ '--ci': ci }">
					<header class="lcard-head">
						<div class="names">
							<span class="cam">{{ r.camera?.name ?? 'Unknown camera' }}</span>
							<span class="sub">{{ [r.stock.name, isoLine(r)].filter(Boolean).join(' · ') }}</span>
						</div>
						<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
					</header>
					<!-- The roll spooling out of its canister: exposed frames, and the next one under the index mark -->
					<div class="spool" :style="{ '--can-h': '64px' }" :title="`${r.frameCount} of ${r.exposures} frames logged`">
						<FilmCanister :stock="r.stock.token ?? r.stock.id" :stock-label="r.stock.name" :stock-brand="r.stock.brand" />
						<div class="leader">
							<i
								v-for="n in Math.min(r.exposures, 40)"
								:key="n"
								:class="{ shot: n <= r.frameCount, next: n === r.frameCount + 1 }"
							></i>
						</div>
					</div>
					<div class="lcard-foot">
						<span class="lab-meta">
							<b class="count">{{ r.frameCount }}</b> / {{ r.exposures }} logged · loaded {{ formatDays(daysBetween(r.statusOn, today)) }}{{ daysBetween(r.statusOn, today) > 0 ? ' ago' : '' }}
							<template v-if="paceOf(r)"><br /><span class="pace">{{ paceOf(r)!.rate }} · {{ paceOf(r)!.finish }}</span></template>
							<template v-if="paceOf(r)?.nudge"><br /><span class="nudge">{{ paceOf(r)!.nudge }}</span></template>
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
			<div ref="lineEl" class="line lab-lightbox" role="list">
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
import { computed, nextTick, ref } from 'vue';

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
import { rollPace } from '../../lib/lab/pace';
import PublishButton from './PublishButton.vue';
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
	/** Whether the film desk shows what's loaded; null for anyone but the owner. */
	shareLoaded?: boolean | null;
}>();

const paceOf = (r: RollView) => rollPace(r, props.today);

const share = ref<boolean | null>(props.shareLoaded ?? null);
const shareChanged = ref(false);
const sharing = ref(false);
async function toggleShare() {
	if (share.value === null) return;
	sharing.value = true;
	try {
		const r = await run(actions.lab.updateSettings({ shareLoaded: !share.value }));
		share.value = r.shareLoaded;
		shareChanged.value = true;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		sharing.value = false;
	}
}

const rolls = ref<RollView[]>([...props.rolls]);
const lineEl = ref<HTMLElement | null>(null);
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
/** The film desk lists the most recently loaded camera first. */
const newestLoaded = computed(() => [...loaded.value].sort((a, b) => b.statusOn.localeCompare(a.statusOn))[0] ?? null);
const storage = computed(() => byStage.value.storage);
const counts = computed(() => ({ ...Object.fromEntries(STAGES.map((s) => [s, byStage.value[s].length])), negatives: negativesCount.value }) as Record<Stage, number>);
const ticker = computed(() => [
	{ n: byStage.value.camera.length, label: 'in cameras' },
	{ n: byStage.value.shot.length, label: 'shot' },
	{ n: byStage.value.lab.length, label: 'at the lab' },
	{ n: byStage.value.scanned.length, label: 'scans in' },
	{ n: byStage.value.storage.length, label: 'in the fridge' },
	{ n: negativesCount.value, label: 'filed' },
]);
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

/**
 * Move tickets the way film moves on a table: measure every ticket, apply the
 * change, then slide each one from where it was to where it lands (FLIP).
 */
async function flip(mutate: () => void, arrivedId?: string) {
	const root = lineEl.value;
	if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) {
		mutate();
		return;
	}
	const before = new Map<string, DOMRect>();
	for (const el of root.querySelectorAll<HTMLElement>('[data-roll]')) before.set(el.dataset.roll!, el.getBoundingClientRect());
	mutate();
	await nextTick();
	for (const el of root.querySelectorAll<HTMLElement>('[data-roll]')) {
		const was = before.get(el.dataset.roll!);
		const now = el.getBoundingClientRect();
		if (was) {
			const dx = was.left - now.left;
			const dy = was.top - now.top;
			if (Math.abs(dx) + Math.abs(dy) > 1) {
				el.animate([{ translate: `${dx}px ${dy}px`, scale: 1.04 }, { translate: '0 0', scale: 1 }], {
					duration: 560,
					easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
				});
			}
		} else {
			el.animate([{ opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1 }], { duration: 360, easing: 'ease-out' });
		}
		if (el.dataset.roll === arrivedId) {
			el.classList.remove('arrived');
			void el.offsetWidth;
			el.classList.add('arrived');
		}
	}
}

function stepped(view: RollView) {
	void flip(() => place(view), view.id);
	step.value = null;
	loading.value = false;
	showToast(`${view.code} is now ${STATUS_LABEL[view.status].toLowerCase()}.`, view.id);
}

async function undo(rollId: string) {
	toast.value = null;
	try {
		const view = await run(actions.lab.undoRollStep({ rollId }));
		void flip(() => place(view), view.id);
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

.desk-share {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 0.75rem;
	margin-top: -0.25rem;
}

.desk-share .switch {
	position: relative;
	flex: none;
	width: 2.4rem;
	height: 1.4rem;
	border: 0;
	border-radius: 999px;
	background: var(--gray-700);
	cursor: pointer;
}

.desk-share .switch::after {
	content: '';
	position: absolute;
	top: 0.2rem;
	left: 0.2rem;
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	background: var(--gray-999);
	transition: translate 0.15s ease;
}

.desk-share .switch[aria-checked='true'] {
	background: var(--accent-regular);
}

.desk-share .switch[aria-checked='true']::after {
	translate: 1rem 0;
	background: var(--accent-text-over);
}

.desk-share .switch:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.pace {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--lab-edge-text);
}

.nudge {
	font-size: var(--text-sm);
	color: var(--lab-warn);
}

.loaded {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	gap: 1rem;
}

.lcard {
	display: grid;
	gap: 0.85rem;
	padding: 1rem 1.1rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
	background: color-mix(in oklch, var(--gray-999) 92%, var(--gray-900));
}

.lcard-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
}

.lcard-head .lab-code {
	flex: none;
	white-space: nowrap;
}

.names {
	display: grid;
	gap: 0.15rem;
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

/* Canister + the film drawn out of it. */
.spool {
	display: flex;
	align-items: center;
}

.spool :deep(.canister) {
	z-index: 1;
}

.leader {
	position: relative;
	flex: 1;
	display: flex;
	gap: 2px;
	margin-left: -4px;
	padding: 9px 5px 9px 8px;
	border-radius: 0 2px 2px 0;
	background: var(--lab-film);
	/* The film's tongue, cut at an angle. */
	clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 30%, 100% 100%, 0 100%);
}

.leader::before,
.leader::after {
	content: '';
	position: absolute;
	inset-inline: 8px 12px;
	height: 3px;
	background: repeating-linear-gradient(90deg, var(--lab-sprocket) 0 4px, transparent 4px 8px);
	opacity: 0.8;
}

.leader::before {
	top: 3px;
}

.leader::after {
	bottom: 3px;
}

.leader i {
	position: relative;
	flex: 1;
	height: 18px;
	border-radius: 1px;
	background: var(--lab-film-frame);
}

/* Exposed: the warm orange of a C-41 negative. */
.leader i.shot {
	background: linear-gradient(180deg, oklch(66% 0.13 58), oklch(56% 0.12 50));
}

/* The next frame, under the counter's index mark. */
.leader i.next {
	box-shadow: inset 0 0 0 1px oklch(95% 0.02 85);
}

.leader i.next::before {
	content: '';
	position: absolute;
	top: -8px;
	left: 50%;
	translate: -50% 0;
	border-left: 3px solid transparent;
	border-right: 3px solid transparent;
	border-top: 4px solid oklch(62% 0.2 28);
}

.count {
	color: var(--gray-0);
	font-weight: 600;
}

@media (prefers-reduced-motion: no-preference) {
	/* The film draws out of the canister as the page opens. */
	.leader {
		animation: draw-out 1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.25s + var(--ci, 0) * 0.12s);
	}

	@keyframes draw-out {
		from {
			clip-path: polygon(0 0, 0 0, 0 30%, 0 100%, 0 100%);
		}
	}
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
	padding: 0.7rem;
}

.ticker {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 1.2rem;
	margin-top: -1.25rem;
}

.tick.zero {
	opacity: 0.45;
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
	min-width: 0;
	gap: 0.55rem;
	min-height: 12rem;
	padding: 0.6rem;
	border-radius: 0.5rem;
	/* A sleeve lane on the light table: translucent, so the table glows through. */
	background: color-mix(in oklch, var(--lab-table) 55%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--lab-table-edge) 80%, transparent);
	transition:
		box-shadow 0.25s ease,
		background-color 0.25s ease;
}

/* While dragging, the lane it can go to lights up; hovering it, brighter. */
.col.droppable {
	box-shadow:
		inset 0 0 0 1px var(--lab-edge-ink),
		0 0 24px -10px var(--lab-lit-glow);
}

.col.target {
	background: color-mix(in oklch, var(--lab-lit) 55%, transparent);
	box-shadow:
		inset 0 0 0 2px var(--lab-edge-ink),
		0 0 36px -8px var(--lab-lit-glow);
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
