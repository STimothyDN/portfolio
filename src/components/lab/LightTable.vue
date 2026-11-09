<template>
	<div class="light-table">
		<!-- A status line in edge print: where everything is, at a glance -->
		<p v-if="ticker.some((t) => t.n)" class="ticker lab-edge-print" aria-label="Where your film is">
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
			<div v-if="share !== null && (loaded.length || share)" class="desk-share">
				<button id="share-loaded" type="button" class="switch" role="switch" :aria-checked="share" :disabled="sharing" aria-labelledby="share-loaded-l" @click="toggleShare"></button>
				<span id="share-loaded-l" class="lab-meta">Show what’s loaded on the film desk<template v-if="share && newestLoaded?.camera">: “In the {{ newestLoaded.camera.name }}: {{ newestLoaded.stock.name }}, {{ newestLoaded.frameCount }} of {{ newestLoaded.exposures }}”</template></span>
				<PublishButton v-if="shareChanged" quiet />
			</div>
			<div v-if="loaded.length" class="loaded">
				<!-- Each loaded camera, seen from above and behind: the top plate with its
				     frame counter, the box end tucked in the memo holder, and the film
				     drawn across the gate. -->
				<article v-for="(r, ci) in loaded" :key="r.id" class="lcard" :style="{ '--ci': ci, '--can': canOf(r).can, '--can-ink': canOf(r).ink }">
					<header class="lcard-head">
						<div class="names">
							<span class="cam">{{ r.camera?.name ?? 'Unknown camera' }}</span>
							<span class="sub">{{ [r.stock.name, isoLine(r)].filter(Boolean).join(' · ') }}</span>
						</div>
						<FrameCounter :count="r.frameCount" :exposures="r.exposures" :delay="0.35 + ci * 0.12" />
					</header>
					<div class="back">
						<div class="memo">
							<span class="box-end" aria-hidden="true">
								<b>{{ r.stock.name }}</b>
								<i>{{ r.stock.iso ? `ISO ${r.stock.iso}` : r.stock.process }} · {{ r.exposures }} exp</i>
							</span>
							<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
						</div>
						<!-- The roll spooling out of its canister: exposed frames, and the next one under the index mark -->
						<div class="spool" :style="{ '--can-h': '58px' }" :title="`${r.frameCount} of ${r.exposures} frames logged`">
							<FilmCanister :stock="r.stock.token ?? r.stock.id" :stock-label="r.stock.name" :stock-brand="r.stock.brand" />
							<div class="leader">
								<i
									v-for="n in Math.min(r.exposures, 40)"
									:key="n"
									:class="{ shot: n <= r.frameCount, next: n === r.frameCount + 1 }"
								></i>
							</div>
							<span class="takeup" aria-hidden="true"></span>
						</div>
					</div>
					<div class="lcard-foot">
						<span class="lab-meta">
							<b class="count">{{ r.frameCount }}</b> / {{ r.exposures }} logged · loaded {{ formatDays(daysBetween(r.statusOn, today)) }}{{ daysBetween(r.statusOn, today) > 0 ? ' ago' : '' }}
							<template v-if="paces.get(r.id)"><br /><span class="pace">{{ paces.get(r.id)!.rate }} · {{ paces.get(r.id)!.finish }}</span></template>
							<template v-if="paces.get(r.id)?.nudge"><br /><span class="nudge">{{ paces.get(r.id)!.nudge }}</span></template>
						</span>
						<span class="lab-actions">
							<a class="lab-btn lab-btn--quiet" :href="`/photography/lab/shoot/?roll=${r.code}`">Log frames</a>
							<button type="button" class="lab-btn lab-btn--quiet" @click="openStep(r, 'shot')">Roll finished</button>
						</span>
					</div>
				</article>
			</div>
			<!-- Nothing loaded: a camera with its back open and the counter on S. -->
			<div v-else class="loaded">
				<article class="lcard lcard--empty">
					<header class="lcard-head">
						<div class="names">
							<span class="cam">No film loaded</span>
							<span class="sub">Back open · counter on S</span>
						</div>
						<FrameCounter :count="-2" :exposures="36" />
					</header>
					<div class="back">
						<div class="spool empty-gate" aria-hidden="true"><span class="takeup"></span></div>
					</div>
					<p class="lcard-foot lab-meta">
						<span>
							No film in any camera.
							<template v-if="storage.length"> <button type="button" class="lab-link" @click="openLoad()">Load a roll</button> from the fridge.</template>
							<template v-else> <a class="lab-link" href="/photography/lab/fridge/">Add film to the fridge</a> first.</template>
						</span>
					</p>
				</article>
			</div>
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
						<svg viewBox="0 0 24 24" aria-hidden="true"><path :d="STAGE_ICON[stage]" /></svg>
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
							:track="r.status === 'lab' && r.trackingOut ? tracks[r.trackingOut] : null"
							@next="openStep(r, nextStage(r.status)!)"
							@dragstart="dragRoll = r"
						/>
						<a v-if="stage === 'shot' && byStage.shot.length" class="lab-link small" href="/photography/lab/labs/">Send to a lab</a>
					</template>
				</div>
			</div>
		</section>

		<LabDialog :open="!!step" :title="step ? stepVerb(step.to, step.roll.labDelivery) : ''" @close="step = null">
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
	ratingLine,
	STAGES,
	STATUS_LABEL,
	STEP_VERB,
	stepVerb,
	type RollStatus,
	type RollView,
	type Stage,
	type StepChoices,
} from '../../lib/lab/inventory';
import type { LabStats } from '../../lib/lab/server/inventory';
import { rollPace } from '../../lib/lab/pace';
import { useTracks } from '../../lib/lab/use-tracks';
import PublishButton from './PublishButton.vue';
import FilmCanister from '../film/FilmCanister.vue';
import { canisterColors } from '../film/canister';
import FrameCounter from './FrameCounter.vue';
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
/** Each loaded roll's pace, worked out once per change rather than per mention. */
const paces = computed(() => new Map(loaded.value.map((r) => [r.id, rollPace(r, props.today)])));
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

const isoLine = (r: RollView) => ratingLine(r);
const canOf = (r: RollView) => canisterColors({ stock: r.stock.token ?? r.stock.id, stockLabel: r.stock.name, stockBrand: r.stock.brand });
/** What the roll is, physically, at each stage: fridge, camera, canister, envelope, print, sleeve. */
const STAGE_ICON: Record<Stage, string> = {
	storage: 'M6 3h12v18H6zM6 10h12M9 5.5v2.5M9 12.5v3.5',
	camera: 'M3.5 8h3.5l2-2.5h6L17 8h3.5v11h-17zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
	shot: 'M9.5 3.5h4v2h-4zM7.5 5.5h8v15h-8zM15.5 9h3.5v7.5h-3.5M7.5 9h8M7.5 17h8',
	lab: 'M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7',
	scanned: 'M4.5 4.5h15v15h-15zM7 7h10v8H7zM7 15l3-3 2.5 2 2-1.5L17 15',
	negatives: 'M5 3.5h13v17H5zM8.5 3.5v17M11 7.5h4.5M11 11h4.5M11 14.5h4.5',
};
// Mailed rolls at a lab: where the envelope is, asked for once the page is up.
const { tracks } = useTracks(() => rolls.value.filter((r) => r.status === 'lab').map((r) => r.trackingOut));

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
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
	gap: 1.5rem 1.25rem;
	padding-top: 0.25rem;
}

/*
 * A camera on the table. Its top plate (brushed chrome by day, black paint at
 * night) carries the engraved name and the frame counter; below it, the back,
 * in pebbled leatherette, with the memo holder and the film in the gate.
 */
.lcard {
	--ink: oklch(94% 0.01 80);
	--dim: oklch(78% 0.012 75);
	--plate: linear-gradient(180deg, oklch(93% 0.004 80), oklch(82% 0.006 80) 48%, oklch(88% 0.005 80) 52%, oklch(76% 0.008 75));
	--plate-ink: oklch(30% 0.01 60);
	--plate-sub: oklch(40% 0.012 60);
	--plate-shine: oklch(100% 0 0 / 0.65);
	position: relative;
	display: grid;
	align-content: start;
	border-radius: 0.9rem 0.9rem 0.7rem 0.7rem;
	background:
		radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.06) 0.7px, transparent 1.1px) 0 0 / 3px 3px,
		radial-gradient(circle at 2px 2px, oklch(0% 0 0 / 0.35) 0.8px, transparent 1.2px) 0 0 / 4px 4px,
		linear-gradient(180deg, oklch(24% 0.006 60), oklch(19% 0.006 60));
	color: var(--ink);
	box-shadow:
		0 1px 0 oklch(100% 0 0 / 0.08) inset,
		0 2px 3px rgb(0 0 0 / 0.25),
		0 18px 34px -16px rgb(0 0 0 / 0.55);
	transition:
		translate 0.35s cubic-bezier(0.22, 1, 0.36, 1),
		box-shadow 0.35s ease;
}

:root.theme-dark .lcard {
	--plate: linear-gradient(180deg, oklch(29% 0.004 60), oklch(18% 0.004 60) 50%, oklch(22% 0.004 60));
	--plate-ink: oklch(93% 0.006 80);
	--plate-sub: oklch(76% 0.01 75);
	--plate-shine: oklch(100% 0 0 / 0.12);
	box-shadow:
		0 1px 0 oklch(100% 0 0 / 0.07) inset,
		0 0 0 1px oklch(100% 0 0 / 0.05),
		0 22px 40px -18px rgb(0 0 0 / 0.9);
}

@media (hover: hover) {
	.lcard:hover {
		translate: 0 -3px;
		box-shadow:
			0 1px 0 oklch(100% 0 0 / 0.08) inset,
			0 3px 6px rgb(0 0 0 / 0.25),
			0 26px 44px -18px rgb(0 0 0 / 0.6);
	}
}

.lcard-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.75rem 0.9rem 0.65rem 1.1rem;
	border-radius: 0.9rem 0.9rem 0 0;
	background:
		repeating-linear-gradient(90deg, oklch(100% 0 0 / 0.05) 0 1px, transparent 1px 3px),
		var(--plate);
	box-shadow:
		0 1px 0 var(--plate-shine) inset,
		0 -1px 0 rgb(0 0 0 / 0.25) inset,
		0 3px 6px -3px rgb(0 0 0 / 0.6);
}

.names {
	display: grid;
	gap: 0.2rem;
	min-width: 0;
}

/* Engraved into the plate. */
.cam {
	font-family: var(--font-mono);
	font-size: 0.95rem;
	font-weight: 600;
	letter-spacing: 0.16em;
	line-height: 1.2;
	font-variant-caps: all-small-caps;
	color: var(--plate-ink);
	text-shadow: 0 1px 0 var(--plate-shine);
	overflow-wrap: anywhere;
}

.sub {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	letter-spacing: 0.02em;
	color: var(--plate-sub);
}

.back {
	display: grid;
	gap: 0.7rem;
	padding: 0.9rem 0.9rem 0.2rem;
}

/* The memo holder: a box end slid in, and the roll's code on a strip of tape. */
.memo {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.box-end {
	display: grid;
	gap: 0.05rem;
	min-width: 0;
	max-width: 70%;
	padding: 0.32rem 0.6rem 0.36rem;
	border-radius: 2px;
	background: linear-gradient(180deg, color-mix(in oklch, var(--can) 100%, white 12%), var(--can));
	color: var(--can-ink);
	box-shadow:
		0 0 0 2px oklch(14% 0.004 60),
		0 0 0 3px oklch(40% 0.006 60),
		0 4px 8px -4px rgb(0 0 0 / 0.8);
	rotate: -0.6deg;
}

.box-end b {
	font-family: var(--font-brand);
	font-size: 0.8rem;
	font-weight: 700;
	letter-spacing: 0.03em;
	line-height: 1.1;
	text-transform: uppercase;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.box-end i {
	font-family: var(--font-mono);
	font-size: 0.6rem;
	font-style: normal;
	letter-spacing: 0.06em;
	opacity: 0.85;
}

/* Masking tape, written on in marker. */
.memo .lab-code {
	flex: none;
	padding: 0.32rem 0.6rem 0.28rem;
	background: linear-gradient(180deg, oklch(92% 0.035 88 / 0.95), oklch(88% 0.04 85 / 0.95));
	color: oklch(22% 0.01 60);
	white-space: nowrap;
	clip-path: polygon(2% 8%, 9% 0, 24% 6%, 41% 1%, 58% 7%, 76% 0, 91% 5%, 100% 1%, 98% 92%, 89% 100%, 72% 94%, 55% 100%, 37% 95%, 19% 100%, 6% 94%, 0 100%);
	rotate: 2.5deg;
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}

/* Canister, the film across the gate, and the take-up spool. */
.spool {
	display: flex;
	align-items: center;
	padding: 0.55rem 0.5rem;
	border-radius: 0.35rem;
	background: linear-gradient(180deg, oklch(13% 0.004 60), oklch(16% 0.004 60) 50%, oklch(13% 0.004 60));
	box-shadow:
		inset 0 2px 6px rgb(0 0 0 / 0.7),
		0 1px 0 oklch(100% 0 0 / 0.06);
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
	background: var(--lab-film);
}

.leader::before,
.leader::after {
	content: '';
	position: absolute;
	inset-inline: 8px 4px;
	height: 3px;
	background: repeating-linear-gradient(90deg, oklch(80% 0.01 80) 0 4px, transparent 4px 8px);
	opacity: 0.75;
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
	height: 16px;
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

/* The take-up spool's teeth. */
.takeup {
	flex: none;
	width: 14px;
	height: 44px;
	margin-left: -2px;
	border-radius: 3px;
	background:
		repeating-linear-gradient(180deg, oklch(55% 0.005 70) 0 3px, oklch(32% 0.005 70) 3px 6px),
		oklch(40% 0.005 70);
	box-shadow: inset -2px 0 3px rgb(0 0 0 / 0.5);
}

@media (prefers-reduced-motion: no-preference) {
	/* The film draws out of the canister as the page opens. */
	.leader {
		animation: draw-out 1.1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.25s + var(--ci, 0) * 0.12s);
	}

	@keyframes draw-out {
		from {
			clip-path: inset(0 100% 0 0);
		}
	}

	.takeup {
		animation: takeup-spin 1.1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.25s + var(--ci, 0) * 0.12s);
	}

	@keyframes takeup-spin {
		from {
			background-position: 0 -18px, 0 0;
		}
	}
}

.lcard-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	padding: 0.7rem 0.9rem 0.9rem;
}

.lcard-foot .lab-meta {
	color: var(--dim);
}

.count {
	color: var(--ink);
	font-weight: 600;
}

/* The empty camera: an open gate with only the take-up spool and pressure plate. */
.empty-gate {
	justify-content: flex-end;
	min-height: 4.6rem;
	background:
		linear-gradient(90deg, transparent 18%, oklch(30% 0.004 60) 18% 82%, transparent 82%) center / 100% 62% no-repeat,
		linear-gradient(180deg, oklch(13% 0.004 60), oklch(16% 0.004 60) 50%, oklch(13% 0.004 60));
}

.lcard--empty .lcard-foot {
	color: var(--dim);
}

.lcard--empty .lab-link {
	color: var(--ink);
	text-decoration-color: oklch(100% 0 0 / 0.4);
}

.lcard .pace {
	color: var(--lab-edge-ink);
}

.lcard .nudge {
	color: oklch(80% 0.13 70);
}

.lcard .lab-btn--quiet {
	color: var(--ink);
	border-color: oklch(100% 0 0 / 0.28);
	background: oklch(100% 0 0 / 0.04);
}

.lcard .lab-btn--quiet:hover {
	background: oklch(100% 0 0 / 0.12);
}

.lcard .lab-btn--quiet:focus-visible,
.lcard .lab-code:focus-visible {
	outline-color: var(--lab-lit);
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

.col-h svg {
	flex: none;
	width: 1.05rem;
	height: 1.05rem;
	margin-right: 0.35rem;
	align-self: center;
	fill: none;
	stroke: var(--lab-edge-text);
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.col-h span {
	flex: 1;
	min-width: 0;
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
