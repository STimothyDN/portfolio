<template>
	<div class="labs">
		<p class="lab-meta">{{ shot.length }} waiting to send · {{ atLab.length }} at a lab</p>

		<!-- Ready to send -->
		<section class="lab-section" aria-labelledby="send-h">
			<header class="sec-head">
				<div>
					<h2 id="send-h" class="lab-h2">Ready to send</h2>
					<p class="lab-meta">{{ readOnly ? 'Shot rolls waiting for a lab.' : 'Shot rolls waiting for a lab. Tick the ones going in this batch.' }}</p>
				</div>
			</header>
			<p v-if="!shot.length" class="lab-empty">Nothing waiting. Finished rolls land here.</p>
			<div v-else class="envelope">
				<div class="env-print" aria-hidden="true">
					<span>Film for development</span>
					<span class="stamp">{{ picked.length }}<small>{{ picked.length === 1 ? 'roll' : 'rolls' }}</small></span>
				</div>
				<ul class="lab-rows">
					<li v-for="r in shot" :key="r.id">
						<input v-if="!readOnly" :id="`send-${r.id}`" v-model="picked" type="checkbox" class="pick" :value="r.id" />
						<label :for="`send-${r.id}`" class="lab-grow">
							<span><span class="lab-code">{{ r.code }}</span> {{ r.stock.name }}</span>
							<span class="lab-meta">{{ [r.stock.process, pushPull(r.stock.iso, r.shotAtIso), r.devNotes, r.camera?.name].filter(Boolean).join(' · ') }}</span>
						</label>
						<span class="lab-meta">shot {{ formatDay(r.statusOn, false) }}</span>
					</li>
				</ul>
				<form v-if="!readOnly" class="batch" @submit.prevent="send">
					<label class="lab-field">
						<span>Lab</span>
						<select id="batch-lab" v-model="labId" class="lab-input lab-select" required @change="fillCost">
							<option value="" disabled>Choose a lab</option>
							<option v-for="l in labs" :key="l.id" :value="l.id">{{ l.name }}</option>
						</select>
					</label>
					<label class="lab-field">
						<span>{{ sendDraft.delivery === 'mail' ? 'Shipped on' : 'Dropped off on' }}</span>
						<input id="batch-on" v-model="on" class="lab-input" type="date" required :max="today" />
					</label>
					<label class="lab-field"><span>Order number</span><input id="batch-order" v-model="order" class="lab-input" type="text" maxlength="60" /></label>
					<label class="lab-field"><span>Dev + scans per roll ($)</span><input id="batch-cost" v-model="cost" class="lab-input" type="number" min="0" step="0.01" /></label>
					<div class="send-fields">
						<LabSendFields v-if="!isHomeLab" v-model="sendDraft" />
			<p v-else class="lab-hint">Your own darkroom: no post. The darkroom page times the run and records the recipe on the roll.</p>
					</div>
					<div class="lab-actions batch-actions">
						<button type="submit" class="lab-btn" :disabled="busy || !picked.length || !labId">
							Mark {{ picked.length }} {{ picked.length === 1 ? 'roll' : 'rolls' }} as sent
						</button>
						<button type="button" class="lab-btn lab-btn--quiet" :disabled="!picked.length" @click="print">Print a slip</button>
						<!-- Say why the button is waiting, rather than leaving it grey. -->
						<span v-if="!picked.length || !labId" class="lab-hint send-why">{{ !picked.length ? 'Tick the rolls going in this batch.' : 'Choose the lab first.' }}</span>
					</div>
				</form>
			</div>
			<p v-if="sendError" class="lab-error" role="alert">{{ sendError }}</p>
		</section>

		<!-- At the lab -->
		<section v-if="atLab.length" class="lab-section" aria-labelledby="atlab-h">
			<header class="sec-head"><h2 id="atlab-h" class="lab-h2">At the lab now</h2></header>
			<TransitionGroup tag="ul" name="post" class="lab-rows">
				<li v-for="r in atLab" :key="r.id">
					<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
					<span class="lab-grow">
						<span>{{ r.stock.name }}</span>
						<span class="lab-meta">{{ [r.lab?.name, r.labOrder ? `#${r.labOrder}` : null, r.labDelivery ? DELIVERY[r.labDelivery].toLowerCase() : null].filter(Boolean).join(' · ') }}</span>
						<TrackingNumber v-if="r.trackingOut" :number="r.trackingOut" :track="tracks[r.trackingOut]" />
					</span>
					<!-- The way to the lab: home on the left, the lab on the right, and the
					     roll (an envelope if it was mailed) as far along as the days are
					     toward the lab's usual turnaround. -->
					<span class="timer" :class="{ late: late(r) }" :data-delivery="r.labDelivery ?? undefined" :title="usual(r) != null ? `Usually ${usual(r)} days` : 'No usual time yet'">
						<i :style="{ width: `${Math.min(100, (daysBetween(r.statusOn, today) / Math.max(1, usual(r) ?? 14)) * 100)}%` }"></i>
					</span>
					<span class="lab-chip" :class="{ 'lab-chip--warn': late(r) }">
						{{ formatDays(daysBetween(r.statusOn, today)) }}<template v-if="usual(r) != null"> · usually {{ usual(r) }}</template>
					</span>
				</li>
			</TransitionGroup>
		</section>

		<!-- Mailed rolls: scans are in, the negatives are in the post -->
		<section v-if="comingBack.length" class="lab-section" aria-labelledby="back-h">
			<header class="sec-head">
				<div>
					<h2 id="back-h" class="lab-h2">Negatives on the way back</h2>
					<p class="lab-meta">Scans are in; the lab is mailing the negatives.</p>
				</div>
			</header>
			<ul class="lab-rows">
				<li v-for="r in comingBack" :key="r.id">
					<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
					<span class="lab-grow">
						<span>{{ r.stock.name }}</span>
						<span class="lab-meta">{{ [r.lab?.name, `scans in ${formatDay(r.statusOn, false)}`].filter(Boolean).join(' · ') }}</span>
						<TrackingNumber v-if="r.trackingBack" :number="r.trackingBack" :track="tracks[r.trackingBack]" />
						<span v-else-if="!readOnly" class="lab-meta">No return tracking number yet: add it on the roll’s page.</span>
					</span>
				</li>
			</ul>
		</section>

		<!-- Labs -->
		<section class="lab-section" aria-labelledby="labs-h">
			<header class="sec-head">
				<h2 id="labs-h" class="lab-h2">Labs</h2>
				<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet" @click="editLab = 'new'">Add lab</button>
			</header>
			<div class="cards">
				<article v-for="l in labs" :key="l.id" class="card" :data-initial="l.name.trim().charAt(0).toUpperCase()">
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
						<button v-if="!readOnly" type="button" class="lab-link" @click="editLab = l.id">Edit</button>
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
import { daysBetween, DELIVERY, formatDay, formatDays, formatMoney, pushPull, toCents, type Delivery, type LabView, type RollView } from '../../lib/lab/inventory';
import { useTracks } from '../../lib/lab/use-tracks';
import type { LabStats } from '../../lib/lab/server/inventory';
import LabDialog from './LabDialog.vue';
import LabSendFields, { type SendDraft } from './LabSendFields.vue';
import TrackingNumber from './TrackingNumber.vue';

const props = defineProps<{
	shot: RollView[];
	atLab: RollView[];
	comingBack: RollView[];
	labs: LabView[];
	stats: Record<string, LabStats>;
	lastDelivery: Record<string, Delivery>;
	today: string;
	/** A guest looking round the owner's lab: nothing can be changed. */
	readOnly?: boolean;
}>();
const comingBack = ref<RollView[]>([...props.comingBack]);
const sendDraft = ref<SendDraft>({ delivery: 'dropoff', tracking: '', printsIncluded: false, printsCost: '' });
// Live status for mailed rolls, asked for once the page is up.
const { tracks } = useTracks(() => [...atLab.value.map((r) => r.trackingOut), ...comingBack.value.map((r) => r.trackingBack)]);

const shot = ref<RollView[]>([...props.shot]);
const atLab = ref<RollView[]>([...props.atLab]);
const labs = ref<LabView[]>([...props.labs]);
const isHomeLab = computed(() => !!labs.value.find((l) => l.id === labId.value)?.home);
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
	// Send the way film last went to this lab.
	const last = l ? props.lastDelivery[l.id] : undefined;
	if (last) sendDraft.value.delivery = last;
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
			actions.lab.sendBatch({
				rollIds: picked.value,
				labId: labId.value,
				on: on.value,
				labOrder: order.value,
				devCostCents: toCents(cost.value),
				labDelivery: sendDraft.value.delivery,
				trackingOut: sendDraft.value.delivery === 'mail' ? sendDraft.value.tracking : null,
				printsIncluded: sendDraft.value.printsIncluded,
				printsCostCents: sendDraft.value.printsIncluded ? null : toCents(sendDraft.value.printsCost),
			})
		);
		const ids = new Set(sent.map((r) => r.id));
		shot.value = shot.value.filter((r) => !ids.has(r.id));
		atLab.value = [...sent, ...atLab.value];
		picked.value = shot.value.map((r) => r.id);
		order.value = '';
		sendDraft.value.tracking = '';
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

/* ---------- the lab envelope ---------- */
.envelope {
	--kraft: oklch(84% 0.055 78);
	--kraft-flap: oklch(78% 0.06 74);
	--kraft-ink: oklch(27% 0.03 55);
	--kraft-soft: oklch(38% 0.035 58);
	--kraft-line: oklch(66% 0.06 70);
	position: relative;
	display: grid;
	gap: 0.75rem;
	padding: 3.2rem clamp(1rem, 3vw, 1.75rem) 1.5rem;
	border-radius: 0.35rem;
	background:
		radial-gradient(120% 80% at 30% 20%, rgb(255 255 255 / 0.18), transparent 60%),
		repeating-linear-gradient(115deg, rgb(0 0 0 / 0.025) 0 2px, transparent 2px 5px),
		var(--kraft);
	color: var(--kraft-ink);
	box-shadow:
		0 1px 0 rgb(255 255 255 / 0.3) inset,
		0 18px 30px -22px rgb(0 0 0 / 0.55);
}

:root.theme-dark .envelope {
	--kraft: oklch(33% 0.04 62);
	--kraft-flap: oklch(29% 0.04 60);
	--kraft-ink: oklch(93% 0.02 80);
	--kraft-soft: oklch(80% 0.03 75);
	--kraft-line: oklch(47% 0.045 65);
}

/* The flap, folded down over the top. */
.envelope::before {
	content: '';
	position: absolute;
	inset: 0 0 auto;
	height: 2.4rem;
	border-radius: 0.35rem 0.35rem 0 0;
	background: var(--kraft-flap);
	clip-path: polygon(0 0, 100% 0, 100% 15%, 50% 100%, 0 15%);
	filter: drop-shadow(0 2px 1px rgb(0 0 0 / 0.15));
}

.env-print {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding-bottom: 0.6rem;
	border-bottom: 1.5px dashed var(--kraft-line);
	font-family: var(--font-mono);
	font-size: 0.72rem;
	letter-spacing: 0.22em;
	text-transform: uppercase;
}

/* A rubber stamp with the roll count. */
.stamp {
	display: grid;
	place-items: center;
	width: 3.2rem;
	height: 3.2rem;
	border: 2px solid oklch(52% 0.17 28 / 0.75);
	border-radius: 50%;
	color: oklch(52% 0.17 28 / 0.85);
	font-size: 1.1rem;
	font-weight: 600;
	letter-spacing: 0;
	line-height: 1;
	rotate: -12deg;
}

.stamp small {
	font-size: 0.5rem;
	letter-spacing: 0.12em;
}

.envelope .lab-rows > li {
	border-bottom: 1px solid var(--kraft-line);
}

.envelope .lab-meta {
	color: var(--kraft-soft);
}

.envelope .lab-code {
	color: var(--kraft-ink);
}

.envelope .batch {
	padding: 0.5rem 0 0;
	background: none;
}

.envelope .lab-field > span,
.envelope :deep(.lab-field > span) {
	color: var(--kraft-soft);
}

/* Fields as lines on a printed form. */
.envelope .lab-input,
.envelope :deep(.lab-input) {
	min-height: 2.5rem;
	padding-inline: 0.15rem;
	border: 0;
	border-bottom: 1.5px solid var(--kraft-ink);
	border-radius: 0;
	background: transparent;
	color: var(--kraft-ink);
}

.envelope .lab-select {
	padding-right: 2rem;
	background-image:
		linear-gradient(45deg, transparent 50%, var(--kraft-ink) 50%),
		linear-gradient(135deg, var(--kraft-ink) 50%, transparent 50%);
	background-position:
		calc(100% - 0.9rem) 55%,
		calc(100% - 0.55rem) 55%;
	background-size: 0.35rem 0.35rem;
	background-repeat: no-repeat;
}

.envelope .lab-btn--quiet {
	color: var(--kraft-ink);
	border-color: var(--kraft-ink);
}

@media (prefers-reduced-motion: no-preference) {
	.envelope .stamp {
		animation: stamp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both 0.5s;
	}

	@keyframes stamp {
		from {
			scale: 1.6;
			opacity: 0;
		}
	}
}

/*
 * At the lab: the road there. A dotted line from home (left) to the lab
 * (right); the roll travels along it as the days count toward the lab's
 * usual turnaround: an envelope if it was mailed, a canister if dropped off.
 */
.timer {
	--road: var(--gray-500);
	--mark: var(--gray-300);
	position: relative;
	flex: none;
	width: clamp(7.5rem, 20vw, 12rem);
	height: 1.5rem;
	background: radial-gradient(circle, var(--road) 0.9px, transparent 1.3px) 1.1rem 50% / 6px 4px repeat-x;
	background-clip: content-box;
	padding-inline: 1.1rem;
}

/* Home. */
.timer::before,
.timer::after {
	content: '';
	position: absolute;
	top: 50%;
	width: 0.85rem;
	height: 0.85rem;
	translate: 0 -55%;
	background: var(--mark);
}

.timer::before {
	left: 0;
	clip-path: polygon(50% 0, 100% 45%, 86% 45%, 86% 100%, 14% 100%, 14% 45%, 0 45%);
}

/* The lab, with its sawtooth roof. */
.timer::after {
	right: 0;
	width: 1rem;
	clip-path: polygon(0 30%, 33% 0, 33% 30%, 66% 0, 66% 30%, 100% 0, 100% 100%, 0 100%);
}

.timer i {
	position: absolute;
	top: 50%;
	left: 1.1rem;
	display: block;
	max-width: calc(100% - 2.2rem);
	height: 2px;
	translate: 0 -50%;
	border-radius: 2px;
	background: var(--gray-0);
}

/* The roll on its way. */
.timer i::after {
	content: '';
	position: absolute;
	right: 0;
	top: 50%;
	width: 0.6rem;
	height: 1rem;
	translate: 50% -50%;
	border-radius: 1.5px;
	background:
		linear-gradient(90deg, rgb(0 0 0 / 0.3), rgb(255 255 255 / 0.3) 30%, rgb(0 0 0 / 0.3)),
		linear-gradient(180deg, oklch(76% 0.006 80) 0 0.16rem, oklch(62% 0.13 58) 0.16rem calc(100% - 0.16rem), oklch(76% 0.006 80) calc(100% - 0.16rem));
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
}

.timer[data-delivery='mail'] i::after {
	width: 1.15rem;
	height: 0.78rem;
	border-radius: 1px;
	background:
		linear-gradient(to bottom right, transparent calc(50% - 0.6px), oklch(45% 0.05 60 / 0.6) 50%, transparent calc(50% + 0.6px)) 0 0 / 50% 60% no-repeat,
		linear-gradient(to bottom left, transparent calc(50% - 0.6px), oklch(45% 0.05 60 / 0.6) 50%, transparent calc(50% + 0.6px)) 100% 0 / 50% 60% no-repeat,
		oklch(82% 0.06 75);
}

.timer.late {
	--mark: var(--lab-warn);
}

.timer.late i {
	background: var(--lab-warn);
}

@media (prefers-reduced-motion: no-preference) {
	.timer i {
		animation: travel 1.4s 0.3s cubic-bezier(0.22, 1, 0.36, 1) backwards;
	}

	@keyframes travel {
		from {
			max-width: 0;
		}
	}

	/* Fresh off the envelope: a sent roll drops into the list. */
	.post-enter-active {
		transition:
			opacity 0.5s ease,
			translate 0.6s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.post-enter-from {
		opacity: 0;
		translate: 0 -1.5rem;
	}
}

@media (max-width: 40em) {
	.labs .lab-rows > li:has(> .timer) {
		flex-wrap: wrap;
	}
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

.batch-actions,
.send-fields {
	grid-column: 1 / -1;
}

/* The envelope's own ink for the shared send fields. */
.envelope .send-fields :deep(.seg) {
	border-color: color-mix(in oklch, var(--kraft-soft) 50%, transparent);
	background: color-mix(in oklch, white 30%, transparent);
}

.envelope .send-fields :deep(.seg-btn) {
	color: var(--kraft-soft);
}

.envelope .send-fields :deep(.seg-btn[aria-checked='true']) {
	background: var(--kraft-soft);
	color: oklch(96% 0.02 80);
}

.envelope .send-fields :deep(.check),
.envelope .send-fields :deep(small) {
	color: var(--kraft-soft);
}

/*
 * Labs: their business cards, letterpressed on heavy stock, dealt out on the
 * table a little askew.
 */
.cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
	gap: 1.25rem;
	padding: 0.25rem;
}

.card {
	--stock: oklch(97.4% 0.012 85);
	--press: oklch(26% 0.012 50);
	--press-soft: oklch(44% 0.015 55);
	position: relative;
	display: grid;
	align-content: start;
	gap: 0.5rem;
	padding: 1.15rem 1.25rem 1.05rem 4rem;
	border-radius: 4px;
	background:
		radial-gradient(circle at 1px 1px, oklch(0% 0 0 / 0.025) 0.6px, transparent 1px) 0 0 / 3px 3px,
		var(--stock);
	color: var(--press);
	box-shadow:
		0 0 0 1px oklch(0% 0 0 / 0.05),
		0 1px 1px rgb(0 0 0 / 0.08),
		0 3px 6px -2px rgb(0 0 0 / 0.12),
		0 14px 24px -16px rgb(0 0 0 / 0.4);
	rotate: -0.6deg;
	transition:
		rotate 0.3s ease,
		translate 0.3s ease,
		box-shadow 0.3s ease;
}

.card:nth-child(2n) {
	rotate: 0.5deg;
}

.card:nth-child(3n) {
	rotate: -0.25deg;
}

@media (hover: hover) {
	.card:hover {
		rotate: 0deg;
		translate: 0 -3px;
	}
}

:root.theme-dark .card {
	--stock: oklch(22% 0.01 60);
	--press: oklch(93% 0.012 80);
	--press-soft: oklch(76% 0.014 75);
	box-shadow:
		0 0 0 1px oklch(100% 0 0 / 0.05),
		0 16px 28px -16px rgb(0 0 0 / 0.9);
}

/* The lab's mark: its initial in a ring, pressed in. */
.card::before {
	content: attr(data-initial);
	position: absolute;
	top: 1.1rem;
	left: 1.1rem;
	display: grid;
	place-items: center;
	width: 2.2rem;
	height: 2.2rem;
	border: 1.5px solid currentColor;
	border-radius: 50%;
	font-family: var(--font-brand);
	font-size: 1.1rem;
	font-style: italic;
	font-weight: 500;
	box-shadow: inset 0 0 0 3px var(--stock), inset 0 0 0 4px currentColor;
	opacity: 0.85;
}

.card-name {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	line-height: 1.15;
	color: var(--press);
	text-shadow: 0 1px 0 color-mix(in oklch, var(--stock) 80%, white);
}

.card .lab-meta,
.card .lab-hint {
	color: var(--press-soft);
}

.card .lab-link {
	color: var(--press);
}

.stats {
	display: flex;
	gap: 1.5rem;
	margin: 0.35rem 0 0;
	padding-top: 0.6rem;
	border-top: 1px solid color-mix(in oklch, var(--press) 18%, transparent);
}

.stats dt {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: var(--press-soft);
}

.stats dd {
	margin: 0;
	font-family: var(--font-brand);
	font-size: var(--text-xl);
	color: var(--press);
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
