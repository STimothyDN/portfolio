<template>
	<form class="lab-form step" @submit.prevent="save">
		<p class="lab-meta step-roll">
			<span class="lab-code">{{ roll.code }}</span>
			<span>{{ roll.stock.name }}{{ roll.camera && to !== 'camera' ? ` · ${roll.camera.name}` : '' }}</span>
		</p>

		<template v-if="to === 'camera'">
			<label class="lab-field">
				<span>Camera</span>
				<select id="step-camera" v-model="cameraId" class="lab-input lab-select" required>
					<option value="" disabled>Choose a camera</option>
					<option v-for="c in cameraOptions" :key="c.id" :value="c.id">{{ c.name }}{{ c.format !== roll.stock.format ? ` (${c.format})` : '' }}</option>
				</select>
				<small v-if="!choices.cameras.length" class="lab-hint">
					No cameras yet. <a class="lab-link" href="/photography/lab/gear/">Add one on the Gear page</a>.
				</small>
			</label>
			<label class="lab-field">
				<span>Rated at ISO</span>
				<input id="step-iso" v-model="iso" class="lab-input" type="number" min="1" max="12800" inputmode="numeric" />
				<small class="lab-hint">
					Box speed {{ roll.stock.iso ?? 'not set' }}<template v-if="push">. That’s a <b>{{ push }}</b>, so tell the lab.</template>
				</small>
			</label>
		</template>

		<template v-else-if="to === 'shot'">
			<label class="lab-field">
				<span>Notes for the lab</span>
				<input id="step-dev-notes" v-model="devNotes" class="lab-input" type="text" maxlength="300" :placeholder="push ? `${push}` : 'Optional'" />
			</label>
		</template>

		<template v-else-if="to === 'lab'">
			<label class="lab-field">
				<span>Lab</span>
				<select id="step-lab" v-model="labId" class="lab-input lab-select" @change="fillCost">
					<option value="">Not recorded</option>
					<option v-for="l in choices.labs" :key="l.id" :value="l.id">{{ l.name }}</option>
				</select>
			</label>
			<div class="lab-row2">
				<label class="lab-field">
					<span>Order number</span>
					<input id="step-order" v-model="labOrder" class="lab-input" type="text" maxlength="60" />
				</label>
				<label class="lab-field">
					<span>Dev + scans ($)</span>
					<input id="step-cost" v-model="cost" class="lab-input" type="number" min="0" step="0.01" inputmode="decimal" />
				</label>
			</div>
			<label class="lab-field">
				<span>Notes for the lab</span>
				<input id="step-dev-notes-lab" v-model="devNotes" class="lab-input" type="text" maxlength="300" :placeholder="push ?? 'Normal process'" />
			</label>
		</template>

		<template v-else-if="to === 'scanned'">
			<label class="lab-field">
				<span>Scans on the film desk</span>
				<select id="step-desk" v-model="publicRollId" class="lab-input lab-select">
					<option value="">Not uploaded yet</option>
					<option v-for="r in deskOptions" :key="r.id" :value="r.id">{{ r.title }} · {{ r.stock }} · {{ formatDay(r.developed) }}</option>
				</select>
				<small class="lab-hint">Best matches first. You can link them later from the roll page.</small>
			</label>
		</template>

		<template v-else-if="to === 'negatives'">
			<label class="lab-field">
				<span>Filed in</span>
				<input id="step-negatives" v-model="negativesAt" class="lab-input" type="text" maxlength="80" placeholder="Binder 1, page 23" list="step-binders" />
				<datalist id="step-binders">
					<option v-for="b in binderHints" :key="b" :value="b" />
				</datalist>
			</label>
		</template>

		<template v-else-if="to === 'lost'">
			<label class="lab-field">
				<span>What happened</span>
				<input id="step-lost" v-model="note" class="lab-input" type="text" maxlength="300" required placeholder="Opened the back mid-roll" />
			</label>
		</template>

		<label class="lab-field">
			<span>Date</span>
			<input id="step-date" v-model="on" class="lab-input" type="date" required :max="today" />
		</label>

		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy">{{ STEP_VERB[to] }}</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
		</div>
	</form>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, ref } from 'vue';

import { dollars, num, run } from '../../lib/lab/client';
import {
	daysBetween,
	formatDay,
	pushPull,
	STEP_VERB,
	toCents,
	type RollStatus,
	type RollView,
	type StepChoices,
} from '../../lib/lab/inventory';

const props = defineProps<{
	roll: RollView;
	to: RollStatus;
	choices: StepChoices;
	today: string;
	binderHints?: string[];
}>();
const emit = defineEmits<{ done: [roll: RollView]; cancel: [] }>();

const on = ref(props.today);
const cameraId = ref(props.roll.camera?.id ?? '');
const iso = ref<string | number>(props.roll.shotAtIso ?? props.roll.stock.iso ?? '');
const labId = ref(props.roll.lab?.id ?? '');
const labOrder = ref(props.roll.labOrder ?? '');
const cost = ref<string | number>(dollars(props.roll.devCostCents ?? props.choices.labs.find((l) => l.id === props.roll.lab?.id)?.costCents));
const devNotes = ref(props.roll.devNotes ?? '');
const publicRollId = ref(props.roll.publicRollId ?? '');
const negativesAt = ref(props.roll.negativesAt ?? '');
const note = ref('');
const busy = ref(false);
const error = ref('');

const push = computed(() => pushPull(props.roll.stock.iso, num(props.to === 'camera' ? iso.value : props.roll.shotAtIso)));

// Cameras that take this format first.
const cameraOptions = computed(() =>
	[...props.choices.cameras].sort(
		(a, b) => Number(b.format === props.roll.stock.format) - Number(a.format === props.roll.stock.format) || a.name.localeCompare(b.name)
	)
);

// Desk rolls most likely to be this one: same stock, then camera, lab, and a close date.
const deskOptions = computed(() => {
	const r = props.roll;
	const score = (d: StepChoices['deskRolls'][number]) =>
		(d.stock === r.stock.name ? 4 : 0) +
		(r.camera && d.camera === r.camera.name ? 2 : 0) +
		(r.lab && d.lab === r.lab.name ? 1 : 0) -
		Math.min(Math.abs(daysBetween(r.statusOn, d.developed)), 365) / 60;
	return [...props.choices.deskRolls].sort((a, b) => score(b) - score(a));
});

function fillCost() {
	const l = props.choices.labs.find((x) => x.id === labId.value);
	if (l?.costCents != null && cost.value === '') cost.value = dollars(l.costCents);
}

async function save() {
	busy.value = true;
	error.value = '';
	const fields: Record<string, unknown> = {};
	if (props.to === 'camera') Object.assign(fields, { cameraId: cameraId.value, shotAtIso: num(iso.value) });
	if (props.to === 'shot') fields.devNotes = devNotes.value || push.value || '';
	if (props.to === 'lab')
		Object.assign(fields, {
			labId: labId.value || null,
			labOrder: labOrder.value,
			devCostCents: toCents(cost.value),
			devNotes: devNotes.value || push.value || '',
		});
	if (props.to === 'negatives') fields.negativesAt = negativesAt.value;
	try {
		let view = await run(
			actions.lab.advanceRoll({
				rollId: props.roll.id,
				to: props.to as never,
				on: on.value,
				note: note.value,
				...(fields as object),
			})
		);
		// Linking scans has its own checks (one roll per desk roll), so it's a second call.
		if (props.to === 'scanned' && publicRollId.value) {
			view = await run(actions.lab.linkDeskRoll({ rollId: props.roll.id, publicRollId: publicRollId.value }));
		}
		emit('done', view);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.step-roll {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}
</style>
