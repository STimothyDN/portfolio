<template>
	<div class="labs">
		<p class="lab-meta">{{ shot.length }} waiting to send · {{ atLab.length }} at a lab</p>

		<!-- Ready to send -->
		<section class="lab-section" aria-labelledby="send-h">
			<header class="sec-head">
				<div>
					<h2 id="send-h" class="lab-h2">Ready to send</h2>
					<p class="lab-meta">Shot rolls waiting for a lab. Tick the ones going in this batch.</p>
				</div>
			</header>
			<p v-if="!shot.length" class="lab-empty">Nothing waiting. Finished rolls land here.</p>
			<template v-else>
				<ul class="lab-rows">
					<li v-for="r in shot" :key="r.id">
						<input :id="`send-${r.id}`" v-model="picked" type="checkbox" class="pick" :value="r.id" />
						<label :for="`send-${r.id}`" class="lab-grow">
							<span><span class="lab-code">{{ r.code }}</span> {{ r.stock.name }}</span>
							<span class="lab-meta">{{ [r.stock.process, pushPull(r.stock.iso, r.shotAtIso), r.devNotes, r.camera?.name].filter(Boolean).join(' · ') }}</span>
						</label>
						<span class="lab-meta">shot {{ formatDay(r.statusOn, false) }}</span>
					</li>
				</ul>
				<form class="batch" @submit.prevent="send">
					<label class="lab-field">
						<span>Lab</span>
						<select id="batch-lab" v-model="labId" class="lab-input lab-select" required @change="fillCost">
							<option value="" disabled>Choose a lab</option>
							<option v-for="l in labs" :key="l.id" :value="l.id">{{ l.name }}</option>
						</select>
					</label>
					<label class="lab-field"><span>Date</span><input id="batch-on" v-model="on" class="lab-input" type="date" required :max="today" /></label>
					<label class="lab-field"><span>Order number</span><input id="batch-order" v-model="order" class="lab-input" type="text" maxlength="60" /></label>
					<label class="lab-field"><span>Cost per roll ($)</span><input id="batch-cost" v-model="cost" class="lab-input" type="number" min="0" step="0.01" /></label>
					<div class="lab-actions batch-actions">
						<button type="submit" class="lab-btn" :disabled="busy || !picked.length || !labId">
							Mark {{ picked.length }} {{ picked.length === 1 ? 'roll' : 'rolls' }} as sent
						</button>
						<button type="button" class="lab-btn lab-btn--quiet" :disabled="!picked.length" @click="print">Print a slip</button>
					</div>
				</form>
			</template>
			<p v-if="sendError" class="lab-error" role="alert">{{ sendError }}</p>
		</section>

		<!-- At the lab -->
		<section v-if="atLab.length" class="lab-section" aria-labelledby="atlab-h">
			<header class="sec-head"><h2 id="atlab-h" class="lab-h2">At the lab now</h2></header>
			<ul class="lab-rows">
				<li v-for="r in atLab" :key="r.id">
					<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
					<span class="lab-grow">
						<span>{{ r.stock.name }}</span>
						<span class="lab-meta">{{ [r.lab?.name, r.labOrder ? `#${r.labOrder}` : null].filter(Boolean).join(' · ') }}</span>
					</span>
					<span class="lab-chip" :class="{ 'lab-chip--warn': late(r) }">
						{{ formatDays(daysBetween(r.statusOn, today)) }}<template v-if="usual(r) != null"> · usually {{ usual(r) }}</template>
					</span>
				</li>
			</ul>
		</section>

		<!-- Labs -->
		<section class="lab-section" aria-labelledby="labs-h">
			<header class="sec-head">
				<h2 id="labs-h" class="lab-h2">Labs</h2>
				<button type="button" class="lab-btn lab-btn--quiet" @click="editLab = 'new'">Add lab</button>
			</header>
			<div class="cards">
				<article v-for="l in labs" :key="l.id" class="card">
					<h3 class="card-name">{{ l.name }}</h3>
					<p class="lab-meta">{{ [l.location, l.costCents != null ? `${formatMoney(l.costCents)} a roll` : null].filter(Boolean).join(' · ') || 'No details yet' }}</p>
					<dl class="stats">
						<div><dt>Rolls</dt><dd>{{ stats[l.id]?.rolls ?? 0 }}</dd></div>
						<div>
							<dt>Turnaround</dt>
							<dd>{{ stats[l.id]?.medianDays != null ? `${stats[l.id]!.medianDays} days` : '—' }}</dd>
						</div>
					</dl>
					<p v-if="stats[l.id]?.medianDays == null" class="lab-hint">Turnaround appears once a roll goes from “sent” to “scans in” here.</p>
					<div class="lab-actions">
						<button type="button" class="lab-link" @click="editLab = l.id">Edit</button>
						<a v-if="l.url" class="lab-link" :href="l.url" target="_blank" rel="noopener">Website</a>
					</div>
				</article>
			</div>
		</section>

		<!-- The printable slip (only shows when printing) -->
		<div class="slip" aria-hidden="true">
			<h2>Film for development</h2>
			<p>{{ slipLab?.name ?? '' }} · {{ formatDay(on) }}{{ order ? ` · order ${order}` : '' }}</p>
			<table>
				<thead><tr><th>Roll</th><th>Film</th><th>Process</th><th>Instructions</th></tr></thead>
				<tbody>
					<tr v-for="r in pickedRolls" :key="r.id">
						<td>{{ r.code }}</td>
						<td>{{ r.stock.name }} · {{ r.exposures }} exp</td>
						<td>{{ r.stock.process }}</td>
						<td>{{ [pushPull(r.stock.iso, r.shotAtIso), r.devNotes].filter(Boolean).join(' · ') || 'Normal' }}</td>
					</tr>
				</tbody>
			</table>
		</div>

		<LabDialog :open="!!editLab" :title="editLab === 'new' ? 'Add lab' : 'Edit lab'" @close="editLab = null">
			<form v-if="editLab" :key="editLab" class="lab-form" @submit.prevent="saveLab">
				<label class="lab-field"><span>Name</span><input id="lab-name" v-model="lf.name" class="lab-input" type="text" maxlength="120" required /></label>
				<div class="lab-row2">
					<label class="lab-field"><span>Where</span><input id="lab-loc" v-model="lf.location" class="lab-input" type="text" maxlength="120" placeholder="Carrboro, or mail-in" /></label>
					<label class="lab-field"><span>Usual cost ($)</span><input id="lab-cost" v-model="lf.cost" class="lab-input" type="number" min="0" step="0.01" /></label>
				</div>
				<label class="lab-field"><span>Website</span><input id="lab-url" v-model="lf.url" class="lab-input" type="url" maxlength="300" placeholder="https://" /></label>
				<label class="lab-field"><span>Notes</span><textarea id="lab-notes" v-model="lf.notes" class="lab-input" rows="2" maxlength="1000" placeholder="Scan sizes, pickup hours"></textarea></label>
				<p v-if="labError" class="lab-error" role="alert">{{ labError }}</p>
				<div class="lab-actions">
					<button type="submit" class="lab-btn" :disabled="busy">Save</button>
					<button type="button" class="lab-btn lab-btn--quiet" @click="editLab = null">Cancel</button>
					<button v-if="editLab !== 'new'" type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="deleteLab">
						{{ confirmDelete ? 'Really delete?' : 'Delete' }}
					</button>
				</div>
			</form>
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, reactive, ref, watch } from 'vue';

import { dollars, run, upsert } from '../../lib/lab/client';
import { daysBetween, formatDay, formatDays, formatMoney, pushPull, toCents, type LabView, type RollView } from '../../lib/lab/inventory';
import type { LabStats } from '../../lib/lab/server/inventory';
import LabDialog from './LabDialog.vue';

const props = defineProps<{ shot: RollView[]; atLab: RollView[]; labs: LabView[]; stats: Record<string, LabStats>; today: string }>();

const shot = ref<RollView[]>([...props.shot]);
const atLab = ref<RollView[]>([...props.atLab]);
const labs = ref<LabView[]>([...props.labs]);
const picked = ref<string[]>(props.shot.map((r) => r.id));
const labId = ref('');
const on = ref(props.today);
const order = ref('');
const cost = ref<string | number>('');
const busy = ref(false);
const sendError = ref('');
const editLab = ref<string | null>(null);
const labError = ref('');
const confirmDelete = ref(false);
const lf = reactive({ name: '', location: '', cost: '' as string | number, url: '', notes: '' });

const pickedRolls = computed(() => shot.value.filter((r) => picked.value.includes(r.id)));
const slipLab = computed(() => labs.value.find((l) => l.id === labId.value));
const usual = (r: RollView) => (r.lab ? props.stats[r.lab.id]?.medianDays ?? null : null);
const late = (r: RollView) => {
	const u = usual(r);
	return u != null && daysBetween(r.statusOn, props.today) > u + 1;
};

function fillCost() {
	const l = slipLab.value;
	if (l?.costCents != null) cost.value = dollars(l.costCents);
}

watch(editLab, (id) => {
	const l = labs.value.find((x) => x.id === id);
	Object.assign(lf, { name: l?.name ?? '', location: l?.location ?? '', cost: dollars(l?.costCents), url: l?.url ?? '', notes: l?.notes ?? '' });
	labError.value = '';
	confirmDelete.value = false;
});

async function send() {
	busy.value = true;
	sendError.value = '';
	try {
		const sent = await run(
			actions.lab.sendBatch({ rollIds: picked.value, labId: labId.value, on: on.value, labOrder: order.value, devCostCents: toCents(cost.value) })
		);
		const ids = new Set(sent.map((r) => r.id));
		shot.value = shot.value.filter((r) => !ids.has(r.id));
		atLab.value = [...sent, ...atLab.value];
		picked.value = shot.value.map((r) => r.id);
		order.value = '';
	} catch (e) {
		sendError.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

function print() {
	window.print();
}

async function saveLab() {
	busy.value = true;
	labError.value = '';
	try {
		const saved = await run(
			actions.lab.saveLab({
				...(editLab.value && editLab.value !== 'new' ? { id: editLab.value } : {}),
				name: lf.name,
				location: lf.location,
				url: lf.url,
				costCents: toCents(lf.cost),
				notes: lf.notes,
			})
		);
		labs.value = upsert(labs.value, saved).sort((a, b) => a.name.localeCompare(b.name));
		editLab.value = null;
	} catch (e) {
		labError.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

async function deleteLab() {
	if (!confirmDelete.value) {
		confirmDelete.value = true;
		return;
	}
	busy.value = true;
	try {
		await run(actions.lab.deleteLab({ id: editLab.value! }));
		labs.value = labs.value.filter((l) => l.id !== editLab.value);
		editLab.value = null;
	} catch (e) {
		labError.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.labs {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

.sec-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: flex-end;
	gap: 0.75rem;
	padding-bottom: 0.75rem;
	border-bottom: 1px solid var(--gray-800);
}

.sec-head > div {
	display: grid;
	gap: 0.3rem;
}

.pick {
	width: 1.15rem;
	height: 1.15rem;
	accent-color: var(--accent-regular);
}

.lab-grow {
	cursor: pointer;
}

.batch {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
	gap: 0.75rem;
	align-items: end;
	padding: 1rem 1.1rem;
	border-radius: 0.6rem;
	background: var(--gray-900);
}

.batch-actions {
	grid-column: 1 / -1;
}

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
	gap: 0.85rem;
}

.card {
	display: grid;
	align-content: start;
	gap: 0.5rem;
	padding: 1rem 1.1rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.6rem;
}

.card-name {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	line-height: 1.15;
}

.stats {
	display: flex;
	gap: 1.5rem;
	margin: 0.25rem 0 0;
}

.stats dt {
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.stats dd {
	margin: 0;
	font-family: var(--font-brand);
	font-size: var(--text-xl);
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

textarea.lab-input {
	resize: vertical;
}

.push-right {
	margin-left: auto;
}

.slip {
	display: none;
}

@media print {
	.slip {
		display: block;
		color: #000;
		font-family: var(--font-body);
	}

	.slip h2 {
		font-size: 20pt;
		color: #000;
	}

	.slip table {
		width: 100%;
		margin-top: 12pt;
		border-collapse: collapse;
		font-size: 11pt;
	}

	.slip th,
	.slip td {
		padding: 6pt;
		border: 1px solid #000;
		text-align: left;
	}
}
</style>
