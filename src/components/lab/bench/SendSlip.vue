<script setup lang="ts">
/**
 * Sending film: tick the rolls going in this envelope, pick the lab, and say
 * how it gets there. Each lab shows when scans should come back if it goes
 * today (from its past turnaround), so the choice is made with that in view.
 */
import { actions } from 'astro:actions';
import { computed, ref } from 'vue';

import { dollars, run } from '../../../lib/lab/client';
import { formatMoney, pushPull, toCents, type RollView, type StepChoices } from '../../../lib/lab/inventory';
import { returnWindow } from '../../../lib/lab/stats/labs';
import type { Spread } from '../../../lib/lab/stats/pipeline';
import LabSendFields, { type SendDraft } from '../LabSendFields.vue';
import { advanceOrQueue, deviceToday, type MaybeQueued } from '../../../lib/lab/offline';

const props = defineProps<{
	shot: RollView[];
	labs: StepChoices['labs'];
	turnaround: Record<string, Spread | null>;
	today: string;
	preset?: { labId?: string; rollIds?: string[] };
}>();
const emit = defineEmits<{ done: [views: RollView[]]; cancel: [] }>();

const picked = ref<string[]>(props.preset?.rollIds?.length ? [...props.preset.rollIds] : props.shot.map((r) => r.id));
const firstLab = props.preset?.labId ?? props.labs.find((l) => l.delivery)?.id ?? props.labs[0]?.id ?? '';
const labId = ref(firstLab);
const isHomeLab = computed(() => !!props.labs.find((l) => l.id === labId.value)?.home);
const on = ref(typeof window === 'undefined' ? props.today : deviceToday());
const order = ref('');
const lab = computed(() => props.labs.find((l) => l.id === labId.value));
const cost = ref<string | number>(dollars(lab.value?.costCents));
const draft = ref<SendDraft>({ delivery: lab.value?.delivery ?? 'dropoff', tracking: '', printsIncluded: false, printsCost: '' });
const busy = ref(false);
const error = ref('');

function pickLab(id: string) {
	labId.value = id;
	const l = props.labs.find((x) => x.id === id);
	if (l?.costCents != null) cost.value = dollars(l.costCents);
	if (l?.delivery) draft.value.delivery = l.delivery;
}

const back = (id: string) => returnWindow(on.value, props.turnaround[id], on.value);

async function send() {
	busy.value = true;
	error.value = '';
	const fields = {
		labId: labId.value,
		on: on.value,
		labOrder: order.value,
		devCostCents: toCents(cost.value),
		labDelivery: draft.value.delivery,
		trackingOut: draft.value.delivery === 'mail' ? draft.value.tracking : null,
		printsIncluded: draft.value.printsIncluded,
		printsCostCents: draft.value.printsIncluded ? null : toCents(draft.value.printsCost),
	};
	try {
		if (!navigator.onLine) throw new TypeError('offline');
		const sent = await run(
			actions.lab.sendBatch({
				rollIds: picked.value,
				labId: labId.value,
				on: on.value,
				labOrder: order.value,
				devCostCents: toCents(cost.value),
				labDelivery: draft.value.delivery,
				trackingOut: draft.value.delivery === 'mail' ? draft.value.tracking : null,
				printsIncluded: draft.value.printsIncluded,
				printsCostCents: draft.value.printsIncluded ? null : toCents(draft.value.printsCost),
			})
		);
		emit('done', sent);
	} catch (e) {
		// No signal: each roll goes into this device's outbox as its own move (same result once synced).
		if (e instanceof TypeError) {
			try {
				const look = { cameras: {}, labs: Object.fromEntries(props.labs.map((l) => [l.id, { name: l.name }])) };
				const views: MaybeQueued[] = [];
				for (const id of picked.value) {
					const r = props.shot.find((x) => x.id === id);
					if (r) views.push(await advanceOrQueue(r, { rollId: id, to: 'lab', ...fields }, look));
				}
				emit('done', views);
			} catch (err) {
				error.value = (err as Error).message;
			}
			return;
		}
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<form class="lab-form send-slip" @submit.prevent="send">
		<fieldset class="rolls">
			<legend>In this envelope</legend>
			<label v-for="r in shot" :key="r.id" class="roll-row">
				<input :id="`slip-${r.id}`" v-model="picked" type="checkbox" :value="r.id" />
				<span class="lab-code">{{ r.code }}</span>
				<span class="what">{{ r.stock.name }}<small>{{ [r.stock.process, pushPull(r.stock.iso, r.shotAtIso), r.camera?.name].filter(Boolean).join(' · ') }}</small></span>
			</label>
		</fieldset>

		<fieldset class="labs" role="radiogroup" aria-label="Lab">
			<legend>To</legend>
			<label v-for="l in labs" :key="l.id" class="lab-card" :class="{ on: labId === l.id }">
				<input type="radio" name="slip-lab" :value="l.id" :checked="labId === l.id" @change="pickLab(l.id)" />
				<b>{{ l.name }}</b>
				<small>
					<template v-if="back(l.id)">back {{ back(l.id)!.text }}</template>
					<template v-else>no turnaround yet</template>
					<template v-if="l.costCents != null"> · {{ formatMoney(l.costCents) }}</template>
				</small>
			</label>
			<p v-if="!labs.length" class="lab-hint">Add a lab on the Post page first.</p>
		</fieldset>

		<div class="lab-row2">
			<label class="lab-field">
				<span>{{ draft.delivery === 'mail' ? 'Shipped on' : 'Dropped off on' }}</span>
				<input id="slip-on" v-model="on" class="lab-input" type="date" required :max="today" />
			</label>
			<label class="lab-field"><span>Order number</span><input id="slip-order" v-model="order" class="lab-input" type="text" maxlength="60" /></label>
			<label class="lab-field"><span>Dev + scans per roll ($)</span><input id="slip-cost" v-model="cost" class="lab-input" type="number" min="0" step="0.01" /></label>
		</div>
		<LabSendFields v-if="!isHomeLab" v-model="draft" />
			<p v-else class="lab-hint">Your own darkroom: no post. The darkroom page times the run and records the recipe on the roll.</p>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="submit" class="lab-btn" :disabled="busy || !picked.length || !labId">Send {{ picked.length }} {{ picked.length === 1 ? 'roll' : 'rolls' }}</button>
			<button type="button" class="lab-btn lab-btn--quiet" @click="emit('cancel')">Cancel</button>
			<span v-if="!picked.length || !labId" class="lab-hint">{{ !picked.length ? 'Tick at least one roll.' : 'Choose the lab first.' }}</span>
		</div>
	</form>
</template>

<style scoped>
fieldset {
	display: grid;
	gap: 0.35rem;
	margin: 0;
	padding: 0;
	border: 0;
	min-width: 0;
}

legend {
	margin-bottom: 0.35rem;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.roll-row {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	min-height: 2.6rem;
	padding: 0.25rem 0.5rem;
	border-radius: 0.5rem;
	cursor: pointer;
}

.roll-row:hover {
	background: var(--gray-900);
}

.roll-row input {
	width: 1.1rem;
	height: 1.1rem;
}

.what {
	display: grid;
	min-width: 0;
}

.what small {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--gray-300);
}

.labs {
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
	gap: 0.5rem;
}

.labs legend {
	grid-column: 1 / -1;
}

.lab-card {
	position: relative;
	display: grid;
	gap: 0.1rem;
	padding: 0.6rem 0.75rem;
	border: 1px solid var(--gray-700);
	border-radius: 0.5rem;
	cursor: pointer;
}

.lab-card input {
	position: absolute;
	opacity: 0;
	pointer-events: none;
}

.lab-card.on {
	border-color: var(--gray-0);
	box-shadow: inset 0 0 0 1px var(--gray-0);
}

.lab-card:has(input:focus-visible) {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.lab-card b {
	font-weight: 600;
}

.lab-card small {
	font-family: var(--font-mono);
	font-size: 0.68rem;
	color: var(--lab-edge-text);
}
</style>
