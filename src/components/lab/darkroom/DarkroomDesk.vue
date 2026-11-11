<script setup lang="ts">
/**
 * The darkroom: pick the rolls going in the tank and a recipe, say how warm
 * the developer is, and the timer runs every step of the process (developer
 * time adjusted for temperature and for what's already been through the
 * chemistry), calling each agitation with a tone and a buzz. When it's done,
 * the run is recorded on each roll and the chemistry counts the rolls.
 */
import { actions } from 'astro:actions';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import { run } from '../../../lib/lab/client';
import {
	AGITATION,
	BUILT_IN,
	CHEM_KINDS,
	PROCESS_LABEL,
	agitationWindows,
	chemistryState,
	clock,
	devRunLine,
	planRun,
	processOf,
	recipesFor,
	type ChemistryView,
	type DevRun,
	type Process,
	type RecipeSpec,
	type Step,
} from '../../../lib/lab/darkroom';
import { formatDay, type RollView } from '../../../lib/lab/inventory';
import type { SavedRecipe } from '../../../lib/lab/server/darkroom';

const props = defineProps<{
	waiting: RollView[];
	recipes: SavedRecipe[];
	chemistry: ChemistryView[];
	developed: { code: string; on: string; run: DevRun }[];
	today: string;
	initialRoll?: string | null;
}>();

type Recipe = RecipeSpec & { id: string; name: string; saved?: boolean };

const waiting = ref<RollView[]>([...props.waiting]);
const saved = ref<SavedRecipe[]>([...props.recipes]);
const chem = ref<ChemistryView[]>([...props.chemistry]);
const developed = ref([...props.developed]);
const error = ref('');
const busy = ref(false);

/* ---------- the tank ---------- */

const first = props.initialRoll ? props.waiting.find((r) => r.code === props.initialRoll?.toUpperCase()) : undefined;
const picked = ref<string[]>(first ? [first.id] : props.waiting[0] ? [props.waiting[0].id] : []);
const pickedRolls = computed(() => waiting.value.filter((r) => picked.value.includes(r.id)));
const lead = computed(() => pickedRolls.value[0] ?? null);
const process = computed<Process>(() => (lead.value ? processOf(lead.value.stock.process) : 'bw'));
/** Rolls that can share the tank with what's picked: same process. */
const canJoin = (r: RollView) => !lead.value || processOf(r.stock.process) === process.value;
function toggle(r: RollView) {
	picked.value = picked.value.includes(r.id) ? picked.value.filter((x) => x !== r.id) : [...picked.value, r.id];
}

/* ---------- the recipe ---------- */

const allRecipes = computed<Recipe[]>(() => [...saved.value.map((r) => ({ ...r, saved: true })), ...BUILT_IN]);
const suited = computed<Recipe[]>(() =>
	lead.value
		? recipesFor(allRecipes.value, { process: lead.value.stock.process, film: lead.value.stock.name, ei: lead.value.shotAtIso ?? lead.value.stock.iso })
		: allRecipes.value.filter((r) => r.process === process.value)
);
const recipeId = ref<string>('');
const recipe = computed<Recipe | null>(() => allRecipes.value.find((r) => r.id === recipeId.value) ?? suited.value[0] ?? null);
watch(
	suited,
	(list) => {
		if (!list.some((r) => r.id === recipeId.value)) recipeId.value = list[0]?.id ?? '';
	},
	{ immediate: true }
);

/** The developer's real temperature now (set from the recipe, then yours to change). */
const temp = ref(20);

/** The recipe as you'll run it: start from the chosen one, change anything. */
const edit = reactive({ developer: '', dilution: '', minutes: 0, seconds: 0, tempC: 20, agitation: 'ilford', ei: 0 });
function loadRecipe(r: Recipe | null) {
	if (!r) return;
	edit.developer = r.developer;
	edit.dilution = r.dilution;
	edit.minutes = Math.floor(r.devSeconds / 60);
	edit.seconds = r.devSeconds % 60;
	edit.tempC = r.tempC;
	edit.agitation = r.agitation;
	edit.ei = r.ei;
	temp.value = r.tempC;
}
watch(recipe, (r) => loadRecipe(r), { immediate: true });
const spec = computed<RecipeSpec | null>(() => {
	const r = recipe.value;
	if (!r) return null;
	const devSeconds = Math.max(10, edit.minutes * 60 + edit.seconds);
	return {
		...r,
		developer: edit.developer || r.developer,
		dilution: edit.dilution,
		devSeconds,
		tempC: edit.tempC,
		agitation: edit.agitation,
		ei: edit.ei,
		steps: r.steps.map((s) => (s.develop ? { ...s, seconds: devSeconds, agitation: edit.agitation } : s)),
	};
});
const changed = computed(
	() =>
		!!recipe.value &&
		(recipe.value.developer !== edit.developer ||
			recipe.value.dilution !== edit.dilution ||
			recipe.value.devSeconds !== edit.minutes * 60 + edit.seconds ||
			recipe.value.tempC !== edit.tempC ||
			recipe.value.agitation !== edit.agitation)
);

/* ---------- chemistry and temperature ---------- */

const KINDS_FOR: Record<Process, string[]> = { bw: ['developer', 'stop', 'fixer', 'wetting'], c41: ['c41'], e6: ['e6'] };
const usable = computed(() => chem.value.filter((c) => KINDS_FOR[process.value].includes(c.kind) && !chemistryState(c, props.today).spent));
const using = ref<string[]>([]);
watch(
	usable,
	(list) => {
		// Use the freshest batch of each kind by default.
		const pick = new Map<string, string>();
		for (const c of list) if (!pick.has(c.kind)) pick.set(c.kind, c.id);
		using.value = [...pick.values()];
	},
	{ immediate: true }
);
/** Rolls already through the developer this run uses (reusable kits lengthen with use). */
const rollsBefore = computed(() => {
	const dev = chem.value.find((c) => using.value.includes(c.id) && (c.kind === 'developer' || c.kind === 'c41' || c.kind === 'e6'));
	return dev?.rollsUsed ?? 0;
});
const plan = computed(() => (spec.value ? planRun({ spec: spec.value, tempC: temp.value, rollsBefore: rollsBefore.value }) : null));

/* ---------- the timer ---------- */

const timing = ref(false);
const stepIndex = ref(0);
const elapsed = ref(0);
const runningSince = ref<number | null>(null);
const stepDone = ref(false);
const finished = ref(false);
let tick: ReturnType<typeof setInterval> | undefined;
let lock: WakeLockSentinel | null = null;

const steps = computed<Step[]>(() => plan.value?.steps ?? []);
const current = computed(() => steps.value[stepIndex.value] ?? null);
const windows = computed(() => (current.value ? agitationWindows(current.value.seconds, current.value.agitation) : []));
const left = computed(() => Math.max(0, (current.value?.seconds ?? 0) - elapsed.value));
const inWindow = computed(() => windows.value.find(([a, b]) => elapsed.value >= a && elapsed.value < b) ?? null);
const nextWindow = computed(() => windows.value.find(([a]) => a > elapsed.value) ?? null);
const agitation = computed(() => (current.value?.agitation ? AGITATION[current.value.agitation] : null));

let audio: AudioContext | null = null;
function beep(times = 1, freq = 880) {
	try {
		audio ??= new AudioContext();
		for (let i = 0; i < times; i++) {
			const o = audio.createOscillator();
			const g = audio.createGain();
			o.frequency.value = freq;
			g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.25);
			g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + i * 0.25 + 0.02);
			g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.25 + 0.18);
			o.connect(g).connect(audio.destination);
			o.start(audio.currentTime + i * 0.25);
			o.stop(audio.currentTime + i * 0.25 + 0.2);
		}
		navigator.vibrate?.(times > 1 ? [120, 80, 120, 80, 120] : 150);
	} catch {
		// Sound is a courtesy; the screen says it too.
	}
}

let lastCue = -1;
function onTick() {
	if (runningSince.value == null || !current.value) return;
	elapsed.value = (Date.now() - runningSince.value) / 1000;
	const w = windows.value.findIndex(([a, b]) => elapsed.value >= a && elapsed.value < b);
	if (w !== -1 && w !== lastCue) {
		lastCue = w;
		if (w > 0) beep(1);
	}
	if (elapsed.value >= current.value.seconds) {
		runningSince.value = null;
		elapsed.value = current.value.seconds;
		stepDone.value = true;
		beep(3, 660);
		if (stepIndex.value === steps.value.length - 1) finished.value = true;
	}
}

async function startTimer() {
	if (!steps.value.length) return;
	timing.value = true;
	stepIndex.value = 0;
	elapsed.value = 0;
	stepDone.value = false;
	finished.value = false;
	runningSince.value = null;
	try {
		lock = (await navigator.wakeLock?.request('screen')) ?? null;
	} catch {
		lock = null;
	}
}
/** Pour in and go: the step's clock starts now. */
function go() {
	lastCue = -1;
	stepDone.value = false;
	runningSince.value = Date.now() - elapsed.value * 1000;
	beep(1, 990);
	clearInterval(tick);
	tick = setInterval(onTick, 200);
}
function pause() {
	if (runningSince.value == null) return;
	elapsed.value = (Date.now() - runningSince.value) / 1000;
	runningSince.value = null;
}
function nextStep() {
	if (stepIndex.value >= steps.value.length - 1) {
		finished.value = true;
		runningSince.value = null;
		return;
	}
	stepIndex.value++;
	elapsed.value = 0;
	stepDone.value = false;
	runningSince.value = null;
}
/** A little longer on this step (a later start means less elapsed). */
function addTime(s: number) {
	if (runningSince.value != null) runningSince.value += s * 1000;
	else elapsed.value = Math.max(0, elapsed.value - s);
	stepDone.value = false;
	finished.value = false;
}
function stopTimer() {
	clearInterval(tick);
	runningSince.value = null;
	timing.value = false;
	void lock?.release();
	lock = null;
}
onBeforeUnmount(() => {
	clearInterval(tick);
	void lock?.release();
});

/* The ring: progress round a dial, agitation bursts marked as arcs. */
const R = 92;
const C = 2 * Math.PI * R;
const r2 = (n: number) => Math.round(n * 100) / 100;
const progress = computed(() => (current.value?.seconds ? Math.min(1, elapsed.value / current.value.seconds) : 0));
const arcs = computed(() =>
	current.value?.seconds
		? windows.value.map(([a, b]) => ({ dash: `${r2(((b - a) / current.value!.seconds) * C)} ${r2(C)}`, offset: r2(-(a / current.value!.seconds) * C) }))
		: []
);

/* ---------- logging the run ---------- */

const runNote = ref('');
const loggedCodes = ref<string[]>([]);
async function logRun() {
	if (!spec.value || !plan.value || !pickedRolls.value.length) return;
	busy.value = true;
	error.value = '';
	try {
		const r = recipe.value!;
		const res = await run(
			actions.lab.logDevRun({
				rollIds: picked.value,
				on: props.today,
				run: {
					recipe: changed.value ? `${r.name} (adjusted)` : r.name,
					process: spec.value.process,
					developer: spec.value.developer,
					dilution: spec.value.dilution,
					ei: spec.value.ei || (lead.value?.shotAtIso ?? lead.value?.stock.iso ?? null),
					tempC: temp.value,
					devSeconds: plan.value.devSeconds,
					chemistry: using.value,
					note: runNote.value || null,
				},
			})
		);
		chem.value = res.chemistry;
		loggedCodes.value = res.rolls.map((x) => x.code);
		for (const x of res.rolls) if (x.devRun) developed.value = [{ code: x.code, on: props.today, run: x.devRun }, ...developed.value];
		waiting.value = waiting.value.filter((x) => !picked.value.includes(x.id));
		picked.value = waiting.value[0] ? [waiting.value[0].id] : [];
		stopTimer();
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

/* ---------- saving recipes ---------- */

const recipeName = ref('');
async function saveRecipe() {
	if (!spec.value) return;
	busy.value = true;
	error.value = '';
	try {
		const name = recipeName.value.trim() || `${spec.value.film || PROCESS_LABEL[spec.value.process]} · ${spec.value.developer} ${spec.value.dilution}`.trim();
		const { id: _id, name: _n, saved: _s, ...rest } = recipe.value as Recipe;
		saved.value = await run(actions.lab.saveRecipe({ name, spec: { ...rest, ...spec.value, source: 'Your own' } }));
		recipeId.value = saved.value.find((r) => r.name === name)?.id ?? recipeId.value;
		recipeName.value = '';
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
async function deleteRecipe(id: string) {
	saved.value = await run(actions.lab.deleteRecipe({ id }));
}

/* ---------- the chemistry shelf ---------- */

const mixing = ref(false);
const mix = reactive({ name: '', kind: 'developer', mixedOn: props.today, capacity: '' as number | '', life: '' as number | '', notes: '' });
async function saveMix() {
	busy.value = true;
	error.value = '';
	try {
		chem.value = await run(
			actions.lab.saveChemistry({
				name: mix.name,
				kind: mix.kind as 'developer',
				mixedOn: mix.mixedOn,
				capacityRolls: mix.capacity === '' ? null : Number(mix.capacity),
				lifeDays: mix.life === '' ? null : Number(mix.life),
				notes: mix.notes,
			})
		);
		mixing.value = false;
		mix.name = '';
		mix.notes = '';
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
async function retire(c: ChemistryView) {
	chem.value = await run(
		actions.lab.saveChemistry({ id: c.id, name: c.name, kind: c.kind as 'developer', mixedOn: c.mixedOn, capacityRolls: c.capacityRolls, lifeDays: c.lifeDays, retiredOn: props.today, notes: c.notes })
	);
}
async function removeBatch(c: ChemistryView) {
	chem.value = await run(actions.lab.deleteChemistry({ id: c.id }));
}
/** Sensible capacity and keeping for common kinds, filled in when a kind is picked. */
watch(
	() => mix.kind,
	(k) => {
		if (k === 'c41' && mix.capacity === '') [mix.capacity, mix.life] = [24, 60];
	}
);

const sortedChem = computed(() =>
	[...chem.value].sort((a, b) => Number(!!chemistryState(a, props.today).spent) - Number(!!chemistryState(b, props.today).spent) || b.mixedOn.localeCompare(a.mixedOn))
);

onMounted(() => {
	if (props.initialRoll && first) document.getElementById('dr-develop')?.scrollIntoView({ block: 'start' });
});
</script>

<template>
	<div class="darkroom">
		<!-- 1 · Develop: the tank, the recipe, the temperature -->
		<section id="dr-develop" class="lab-section" aria-labelledby="dev-h">
			<header class="sec-head">
				<h2 id="dev-h" class="lab-h2">Develop</h2>
				<span class="lab-meta">{{ waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'roll' : 'rolls'} waiting for the tank` : 'Nothing waiting: finish a roll first' }}</span>
			</header>

			<p v-if="loggedCodes.length" class="lab-notice" role="status">
				Recorded on {{ loggedCodes.join(', ') }}. They’re now “Developed at home”: scan them, then mark the scans in on the bench.
			</p>

			<div v-if="!timing" class="dev-grid">
				<fieldset class="tank">
					<legend>In the tank</legend>
					<p v-if="!waiting.length" class="lab-empty">Shot rolls show up here.</p>
					<ul>
						<li v-for="r in waiting" :key="r.id">
							<label :class="{ off: !canJoin(r) && !picked.includes(r.id) }">
								<input :id="`dr-roll-${r.code}`" type="checkbox" :checked="picked.includes(r.id)" :disabled="!canJoin(r) && !picked.includes(r.id)" @change="toggle(r)" />
								<span class="lab-code">{{ r.code }}</span>
								<span>{{ r.stock.name }}</span>
								<span class="lab-meta">{{ r.stock.process }}{{ r.shotAtIso && r.shotAtIso !== r.stock.iso ? ` · EI ${r.shotAtIso}` : '' }}</span>
							</label>
						</li>
					</ul>
					<small v-if="lead" class="lab-hint">{{ PROCESS_LABEL[process] }} only: rolls of another process wait for their own run.</small>
				</fieldset>

				<fieldset class="recipe">
					<legend>Recipe</legend>
					<label class="lab-field">
						<span>Start from</span>
						<select id="dr-recipe" v-model="recipeId" class="lab-input lab-select">
							<option v-for="r in suited" :key="r.id" :value="r.id">{{ r.saved ? '★ ' : '' }}{{ r.name }}</option>
						</select>
					</label>
					<p v-if="recipe?.source" class="lab-hint">
						{{ recipe.saved ? 'Your recipe.' : `From the ${recipe.source}.` }}
						<template v-if="!recipe.saved"> A starting point: check the sheet that came with your chemistry.</template>
					</p>
					<p v-if="recipe?.notes" class="lab-hint">{{ recipe.notes }}</p>
					<div class="lab-row2">
						<label class="lab-field"><span>Developer</span><input id="dr-dev" v-model="edit.developer" class="lab-input" type="text" maxlength="80" /></label>
						<label class="lab-field"><span>Dilution</span><input id="dr-dil" v-model="edit.dilution" class="lab-input" type="text" maxlength="30" /></label>
					</div>
					<div class="time-row">
						<label class="lab-field"><span>Developer time</span>
							<span class="mmss">
								<input id="dr-min" v-model.number="edit.minutes" class="lab-input num" type="number" min="0" max="120" inputmode="numeric" aria-label="Minutes" /> :
								<input id="dr-sec" v-model.number="edit.seconds" class="lab-input num" type="number" min="0" max="59" step="5" inputmode="numeric" aria-label="Seconds" />
							</span>
						</label>
						<label class="lab-field"><span>at °C</span><input id="dr-at" v-model.number="edit.tempC" class="lab-input num" type="number" min="10" max="45" step="0.5" /></label>
						<label class="lab-field"><span>Agitation</span>
							<select id="dr-agit" v-model="edit.agitation" class="lab-input lab-select">
								<option v-for="a in AGITATION" :key="a.key" :value="a.key">{{ a.label }}</option>
							</select>
						</label>
					</div>
					<form v-if="changed" class="save-recipe" @submit.prevent="saveRecipe">
						<input id="dr-recipe-name" v-model="recipeName" class="lab-input" type="text" maxlength="120" placeholder="Name it (optional)" />
						<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy">Save as my recipe</button>
					</form>
				</fieldset>

				<fieldset class="conditions">
					<legend>Today</legend>
					<label class="lab-field">
						<span>Developer is at °C</span>
						<input id="dr-temp" v-model.number="temp" class="lab-input num" type="number" min="10" max="45" step="0.5" inputmode="decimal" />
					</label>
					<div v-if="usable.length" class="chem-pick">
						<span class="lab-meta">Chemistry</span>
						<label v-for="c in usable" :key="c.id">
							<input :id="`dr-chem-${c.id}`" v-model="using" type="checkbox" :value="c.id" />
							{{ c.name }} <span class="lab-meta">· {{ c.rollsUsed }}{{ c.capacityRolls ? ` of ${c.capacityRolls}` : '' }} through</span>
						</label>
					</div>
					<p v-else class="lab-hint">No {{ process === 'bw' ? 'black-and-white chemistry' : PROCESS_LABEL[process] + ' kit' }} on the shelf yet; add it below to count the rolls through it.</p>

					<div v-if="plan" class="plan">
						<p class="dev-time"><b>{{ clock(plan.devSeconds) }}</b> in the developer</p>
						<p v-for="a in plan.adjustments" :key="a" class="lab-hint">Adjusted for {{ a }}.</p>
						<ol class="seq">
							<li v-for="s in plan.steps" :key="s.key" :class="{ dev: s.develop }">
								<span>{{ s.label }}</span><span class="lab-mono">{{ clock(s.seconds) }}</span>
							</li>
						</ol>
						<button id="dr-start" type="button" class="lab-btn" :disabled="!pickedRolls.length" @click="startTimer">
							{{ pickedRolls.length ? `Start the timer · ${pickedRolls.length} ${pickedRolls.length === 1 ? 'roll' : 'rolls'}` : 'Pick a roll first' }}
						</button>
					</div>
				</fieldset>
			</div>

			<!-- The timer: one step at a time, the clock as a dial, agitation marked on it. -->
			<div v-else class="timer" :class="{ agitate: !!inWindow && runningSince != null, done: stepDone }" role="region" aria-label="Development timer">
				<ol class="frames" aria-label="Steps">
					<li v-for="(s, i) in steps" :key="s.key" :class="{ past: i < stepIndex, now: i === stepIndex }">
						<span class="f-n">{{ i + 1 }}</span>
						<span class="f-l">{{ s.label }}</span>
						<span class="f-t">{{ clock(s.seconds) }}</span>
					</li>
				</ol>
				<div class="dial-wrap">
					<svg class="dial" viewBox="0 0 220 220" aria-hidden="true">
						<circle class="track" cx="110" cy="110" :r="R" />
						<circle v-for="(a, i) in arcs" :key="i" class="burst" cx="110" cy="110" :r="R" :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" />
						<circle class="hand" cx="110" cy="110" :r="R" :stroke-dasharray="`${r2(progress * C)} ${r2(C)}`" />
					</svg>
					<div class="readout" aria-live="polite">
						<span class="step-name">{{ current?.label }}</span>
						<b class="left">{{ clock(left) }}</b>
						<span v-if="finished" class="cue">All done: hang it to dry.</span>
						<span v-else-if="stepDone" class="cue">Drain it. Then the next step.</span>
						<span v-else-if="inWindow && runningSince != null" class="cue now">Agitate: {{ agitation?.how }}</span>
						<span v-else-if="runningSince == null" class="cue">{{ elapsed ? 'Paused' : 'Pour in, then start' }}</span>
						<span v-else-if="nextWindow" class="cue">Next agitation in {{ clock(nextWindow[0] - elapsed) }}</span>
						<span v-else class="cue">Let it sit</span>
					</div>
				</div>
				<p v-if="current?.note" class="lab-hint step-note">{{ current.note }}</p>
				<div class="controls">
					<button v-if="!finished && !stepDone && runningSince == null" id="dr-go" type="button" class="lab-btn" @click="go">{{ elapsed ? 'Resume' : 'Poured: start' }}</button>
					<button v-if="runningSince != null" type="button" class="lab-btn lab-btn--quiet" @click="pause">Pause</button>
					<button v-if="!finished" id="dr-next" type="button" class="lab-btn" :class="{ 'lab-btn--quiet': !stepDone }" @click="nextStep">{{ stepIndex === steps.length - 1 ? 'Finish' : stepDone ? 'Next step' : 'Skip step' }}</button>
					<button v-if="!finished" type="button" class="lab-btn lab-btn--quiet" @click="addTime(15)">+15 s</button>
					<button type="button" class="lab-link" @click="stopTimer">Stop the run</button>
				</div>
				<form v-if="finished" class="log" @submit.prevent="logRun">
					<label class="lab-field"><span>Anything to remember (optional)</span><input id="dr-note" v-model="runNote" class="lab-input" type="text" maxlength="300" placeholder="Bit of surge marks on the edges" /></label>
					<button id="dr-log" type="submit" class="lab-btn" :disabled="busy">Record it on {{ pickedRolls.map((r) => r.code).join(', ') }}</button>
				</form>
			</div>
			<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		</section>

		<!-- 2 · The chemistry shelf -->
		<section class="lab-section" aria-labelledby="chem-h">
			<header class="sec-head">
				<h2 id="chem-h" class="lab-h2">Chemistry shelf</h2>
				<button v-if="!mixing" id="dr-mix" type="button" class="lab-btn lab-btn--quiet" @click="mixing = true">Mixed a batch</button>
			</header>
			<form v-if="mixing" class="mix" @submit.prevent="saveMix">
				<label class="lab-field"><span>What</span><input id="mix-name" v-model="mix.name" class="lab-input" type="text" maxlength="120" required placeholder="Cs41 kit, Rapid Fixer 1+4…" /></label>
				<label class="lab-field"><span>Kind</span>
					<select id="mix-kind" v-model="mix.kind" class="lab-input lab-select">
						<option v-for="(label, key) in CHEM_KINDS" :key="key" :value="key">{{ label }}</option>
					</select>
				</label>
				<label class="lab-field"><span>Mixed on</span><input id="mix-on" v-model="mix.mixedOn" class="lab-input" type="date" required /></label>
				<label class="lab-field"><span>Good for (rolls)</span><input id="mix-cap" v-model.number="mix.capacity" class="lab-input num" type="number" min="1" max="500" placeholder="one-shot" /></label>
				<label class="lab-field"><span>Keeps (days)</span><input id="mix-life" v-model.number="mix.life" class="lab-input num" type="number" min="1" max="3650" /></label>
				<div class="lab-actions">
					<button type="submit" class="lab-btn" :disabled="busy">Put it on the shelf</button>
					<button type="button" class="lab-btn lab-btn--quiet" @click="mixing = false">Cancel</button>
				</div>
			</form>
			<p v-if="!chem.length && !mixing" class="lab-empty">Nothing mixed yet. Add each batch and the darkroom counts the rolls through it and warns before it’s spent.</p>
			<ul v-else class="shelf">
				<li v-for="c in sortedChem" :key="c.id" class="bottle" :class="`t-${chemistryState(c, today).tone}`">
					<span class="b-name">{{ c.name }}</span>
					<span class="lab-meta">{{ CHEM_KINDS[c.kind] ?? c.kind }} · mixed {{ formatDay(c.mixedOn, false) }}</span>
					<span v-if="c.capacityRolls" class="fill" :aria-label="`${c.rollsUsed} of ${c.capacityRolls} rolls used`">
						<i :style="{ width: `${Math.min(100, (c.rollsUsed / c.capacityRolls) * 100)}%` }"></i>
					</span>
					<span class="lab-meta">
						{{
							[
								c.capacityRolls ? `${Math.max(0, c.capacityRolls - c.rollsUsed)} of ${c.capacityRolls} rolls left` : `${c.rollsUsed} ${c.rollsUsed === 1 ? 'roll' : 'rolls'} through`,
								chemistryState(c, today).daysLeft != null ? (chemistryState(c, today).daysLeft! < 0 ? 'past its keeping time' : `keeps ${chemistryState(c, today).daysLeft} more days`) : null,
								c.retiredOn ? `retired ${formatDay(c.retiredOn, false)}` : null,
							]
								.filter(Boolean)
								.join(' · ')
						}}
					</span>
					<span class="b-actions">
						<button v-if="!c.retiredOn" type="button" class="lab-link" @click="retire(c)">Used up</button>
						<button type="button" class="lab-link" @click="removeBatch(c)">Remove</button>
					</span>
				</li>
			</ul>
		</section>

		<!-- 3 · Recipes -->
		<section class="lab-section" aria-labelledby="rec-h">
			<header class="sec-head">
				<h2 id="rec-h" class="lab-h2">Recipes</h2>
			</header>
			<p class="lab-meta">Your own first, then starting points from the makers’ data sheets. Adjust a time above and save it as yours once it’s dialled in.</p>
			<ul class="recipes">
				<li v-for="r in allRecipes" :key="r.id" :class="{ mine: r.saved }">
					<span class="r-name">{{ r.saved ? '★ ' : '' }}{{ r.name }}</span>
					<span class="lab-meta">{{ PROCESS_LABEL[r.process] }} · {{ clock(r.devSeconds) }} at {{ r.tempC }} °C · {{ AGITATION[r.agitation]?.label ?? r.agitation }}</span>
					<span class="lab-hint">{{ r.saved ? 'Yours' : r.source }}</span>
					<button v-if="r.saved" type="button" class="lab-link" @click="deleteRecipe(r.id)">Delete</button>
				</li>
			</ul>
		</section>

		<!-- 4 · What's been developed here -->
		<section v-if="developed.length" class="lab-section" aria-labelledby="log-h">
			<header class="sec-head">
				<h2 id="log-h" class="lab-h2">Developed here</h2>
			</header>
			<ul class="lab-rows">
				<li v-for="d in developed" :key="d.code + d.on">
					<a class="lab-code" :href="`/photography/lab/rolls/${d.code}/`">{{ d.code }}</a>
					<span class="lab-grow">{{ devRunLine(d.run) }}<template v-if="d.run.note"> · {{ d.run.note }}</template></span>
					<span class="lab-meta">{{ formatDay(d.on, false) }}</span>
				</li>
			</ul>
		</section>
	</div>
</template>

<style scoped>
.darkroom {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

.sec-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem 1rem;
}

.dev-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
	gap: 1rem;
	align-items: start;
}

fieldset {
	display: grid;
	gap: 0.75rem;
	min-width: 0;
	margin: 0;
	padding: 1rem 1.1rem 1.2rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.7rem;
	background: var(--lab-card, var(--gray-999));
}

legend {
	padding: 0 0.4rem;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.tank ul {
	display: grid;
	gap: 0.35rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.tank label {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.5rem;
	cursor: pointer;
}

.tank label.off {
	opacity: 0.45;
	cursor: default;
}

.time-row {
	display: grid;
	grid-template-columns: auto 5rem minmax(0, 1fr);
	gap: 0.6rem;
	align-items: end;
}

.mmss {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
}

.lab-input.num {
	width: 4.6rem;
	font-family: var(--font-mono);
	font-size: 1rem;
}

.save-recipe {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.save-recipe .lab-input {
	flex: 1 1 10rem;
}

.chem-pick {
	display: grid;
	gap: 0.3rem;
	font-size: var(--text-sm);
}

.plan {
	display: grid;
	gap: 0.5rem;
	padding-top: 0.6rem;
	border-top: 1px dashed var(--gray-800);
}

.dev-time {
	margin: 0;
	font-size: var(--text-lg);
}

.dev-time b {
	font-family: var(--font-mono);
	font-size: 1.6rem;
	font-weight: 500;
}

.seq {
	display: grid;
	gap: 0.15rem;
	margin: 0 0 0.4rem;
	padding-left: 1.2rem;
	font-size: var(--text-sm);
}

.seq li {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	color: var(--gray-200);
}

.seq li.dev {
	color: var(--gray-0);
	font-weight: 600;
}

/* ---- The timer: a darkroom clock ---- */
.timer {
	--tick: oklch(70% 0.17 45);
	--burst: oklch(64% 0.2 28);
	display: grid;
	justify-items: center;
	gap: 1.1rem;
	padding: clamp(1rem, 3vw, 2rem);
	border-radius: 1rem;
	background:
		radial-gradient(80% 60% at 50% 30%, oklch(24% 0.03 30), oklch(13% 0.01 30));
	color: oklch(92% 0.01 70);
	box-shadow: inset 0 0 0 1px oklch(35% 0.03 30 / 0.6);
}

.frames {
	display: flex;
	gap: 3px;
	width: 100%;
	margin: 0;
	padding: 6px;
	overflow-x: auto;
	list-style: none;
	border-radius: 4px;
	background:
		radial-gradient(circle, transparent 2px, oklch(10% 0.01 30) 2.5px) 0 0 / 12px 6px repeat-x,
		oklch(10% 0.01 30);
	scrollbar-width: thin;
}

.frames li {
	flex: 1 0 6.5rem;
	display: grid;
	gap: 0.1rem;
	padding: 0.5rem 0.55rem;
	border-radius: 2px;
	background: oklch(20% 0.02 30);
	color: oklch(70% 0.02 60);
	font-size: 0.72rem;
}

.frames li.past {
	opacity: 0.5;
}

.frames li.now {
	background: oklch(93% 0.04 80);
	color: oklch(18% 0.02 50);
	box-shadow: 0 0 18px -4px oklch(85% 0.08 80 / 0.7);
}

.f-n,
.f-t {
	font-family: var(--font-mono);
}

.f-l {
	font-weight: 600;
}

.dial-wrap {
	position: relative;
	width: min(18rem, 80vw);
	aspect-ratio: 1;
}

.dial {
	width: 100%;
	height: 100%;
	rotate: -90deg;
}

.dial circle {
	fill: none;
}

.track {
	stroke: oklch(30% 0.02 30);
	stroke-width: 10;
}

.burst {
	stroke: var(--burst);
	stroke-width: 10;
	opacity: 0.55;
}

.hand {
	stroke: var(--tick);
	stroke-width: 4;
	stroke-linecap: round;
	transition: stroke-dasharray 0.2s linear;
}

.readout {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	justify-items: center;
	gap: 0.25rem;
	text-align: center;
}

.step-name {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: oklch(75% 0.03 60);
}

.left {
	font-family: var(--font-mono);
	font-size: clamp(2.6rem, 9vw, 3.6rem);
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	line-height: 1;
}

.cue {
	max-width: 12rem;
	font-size: var(--text-sm);
	color: oklch(80% 0.03 60);
}

.cue.now {
	color: oklch(80% 0.17 40);
	font-weight: 600;
}

.timer.agitate .dial-wrap {
	animation: agitate 0.9s ease-in-out infinite;
}

@keyframes agitate {
	50% {
		filter: drop-shadow(0 0 22px oklch(64% 0.2 28 / 0.65));
	}
}

@media (prefers-reduced-motion: reduce) {
	.timer.agitate .dial-wrap {
		animation: none;
		outline: 3px solid var(--burst);
		outline-offset: 6px;
		border-radius: 50%;
	}
}

.step-note {
	max-width: 32rem;
	margin: 0;
	text-align: center;
	color: oklch(78% 0.02 60);
}

.controls {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	align-items: center;
	gap: 0.6rem;
}

.timer .lab-link {
	color: oklch(80% 0.03 60);
}

.log {
	display: grid;
	gap: 0.6rem;
	width: min(100%, 28rem);
}

/* ---- The shelf: bottles, filled to what's left ---- */
.mix {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
	gap: 0.6rem;
	align-items: end;
}

.shelf {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
	gap: 0.6rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.bottle {
	display: grid;
	gap: 0.3rem;
	padding: 0.8rem 0.9rem;
	border-radius: 0.6rem;
	background: var(--lab-card, var(--gray-999));
	box-shadow: 0 0 0 1px var(--gray-800);
}

.bottle.t-low {
	box-shadow: 0 0 0 1.5px var(--lab-warn, oklch(70% 0.15 70));
}

.bottle.t-spent {
	opacity: 0.55;
}

.b-name {
	font-weight: 600;
}

.fill {
	height: 0.5rem;
	border-radius: 999px;
	background: var(--gray-800);
	overflow: hidden;
}

.fill i {
	display: block;
	height: 100%;
	background: var(--gray-300);
}

.b-actions {
	display: flex;
	gap: 0.8rem;
}

.recipes {
	display: grid;
	gap: 0.4rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.recipes li {
	display: grid;
	grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr) auto;
	gap: 0.3rem 1rem;
	align-items: baseline;
	padding: 0.45rem 0;
	border-bottom: 1px solid var(--gray-800);
}

@media (max-width: 50em) {
	.recipes li {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.recipes li > .lab-meta,
	.recipes li > .lab-hint {
		grid-column: 1;
	}
}

.r-name {
	font-weight: 500;
}
</style>
