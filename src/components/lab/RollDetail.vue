<template>
	<div class="roll-page">
		<header class="roll-head">
			<div class="can" :style="{ '--can-h': '128px' }">
				<FilmCanister :stock="roll.stock.token ?? roll.stock.id" :stock-label="roll.stock.name" :stock-brand="roll.stock.brand" />
			</div>
			<div class="head-text">
				<a class="lab-edge crumbs" href="/photography/lab/rolls/">← The binder</a>
				<span class="lab-code big-code">{{ roll.code }}</span>
				<h1 class="lab-title">{{ roll.title || roll.stock.name }}</h1>
				<p class="lab-meta lab-mono summary">
					<span v-for="(part, i) in summary" :key="i">{{ part }}</span>
				</p>
				<div class="head-actions">
					<span class="lab-chip stage-stamp" :class="{ 'lab-chip--warn': roll.status === 'lost' }">{{ stageLabel(roll.status, roll.labDelivery) }}</span>
					<template v-if="!readOnly">
					<button v-if="next" type="button" class="lab-btn" @click="openStep(next)">{{ stepVerb(next, roll.labDelivery) }}</button>
					<button v-if="roll.status !== 'lost'" type="button" class="lab-btn lab-btn--quiet" @click="openStep('lost')">Mark lost or ruined</button>
					<button v-if="events.length > 1" type="button" class="lab-link small" :disabled="busy" @click="undo">Undo last step</button>
					</template>
				</div>
			</div>
		</header>

		<!-- The roll's own line: the six stations it goes through, dated (click a date to fix it). -->
		<section class="lifeline-wrap" aria-labelledby="tl-h">
			<h2 id="tl-h" class="sr-only">Where it’s been</h2>
			<ol class="lifeline steps" :class="{ lost: roll.status === 'lost' }">
				<li v-for="stage in STAGES" :key="stage" class="step" :class="[stepState(stage), `st-${stage}`]">
					<span class="pip" aria-hidden="true">{{ stepState(stage) === 'done' ? '✓' : STAGES.indexOf(stage) + 1 }}</span>
					<div class="step-body">
						<span class="step-t">{{ stageLabel(stage, roll.labDelivery) }}</span>
						<template v-for="ev in eventsFor(stage)" :key="ev.id">
							<form v-if="editing === ev.id" class="ev-edit" @submit.prevent="saveEvent(ev.id)">
								<input :id="`ev-on-${ev.id}`" v-model="evOn" class="lab-input" type="date" required aria-label="Date" />
								<input :id="`ev-note-${ev.id}`" v-model="evNote" class="lab-input" type="text" maxlength="300" placeholder="Note" aria-label="Note" />
								<span class="lab-actions">
									<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy">Save</button>
									<button type="button" class="lab-btn lab-btn--quiet" @click="editing = null">Cancel</button>
								</span>
							</form>
							<span v-else-if="readOnly" class="step-d">{{ formatDay(ev.on) }}<template v-if="ev.note"> · {{ ev.note }}</template></span>
							<button v-else type="button" class="step-d" :title="ev.note ?? 'Change the date'" @click="startEdit(ev)">
								{{ formatDay(ev.on) }}<template v-if="ev.note"> · {{ ev.note }}</template>
								<span class="edit" aria-hidden="true">edit</span>
							</button>
						</template>
						<span v-if="stage === roll.status && stageDetail" class="step-x">{{ stageDetail }}</span>
						<TrackingNumber v-if="stage === 'lab' && roll.trackingOut" class="step-track" :number="roll.trackingOut" :track="tracks[roll.trackingOut]" label="Outbound" />
						<TrackingNumber v-if="stage === 'scanned' && roll.trackingBack" class="step-track" :number="roll.trackingBack" :track="tracks[roll.trackingBack]" label="Negatives coming back" />
					</div>
				</li>
				<li v-if="roll.status === 'lost'" class="step now lost">
					<span class="pip" aria-hidden="true">!</span>
					<div class="step-body">
						<span class="step-t">{{ STATUS_LABEL.lost }}</span>
						<span v-for="ev in eventsFor('lost')" :key="ev.id" class="step-x">{{ formatDay(ev.on) }}<template v-if="ev.note"> · {{ ev.note }}</template></span>
					</div>
				</li>
			</ol>
		</section>

		<!-- The report card: five numbers worth knowing about this roll. -->
		<dl class="report" aria-label="This roll in numbers">
			<div class="r-yield">
				<dt>Yield</dt>
				<dd>
					<b>{{ report.yield.scans ?? report.yield.frames }}</b><small> of {{ report.yield.exposures }}</small>
				</dd>
				<dd class="sub">{{ report.yield.scans != null ? 'scans back' : report.yield.frames ? 'frames logged' : 'nothing logged yet' }}</dd>
			</div>
			<div class="r-keepers">
				<dt>Keepers</dt>
				<dd><b>{{ report.keepers ? report.keepers.n : '—' }}</b><small v-if="report.keepers?.of"> · {{ Math.round((report.keepers.n / report.keepers.of) * 100) }}%</small></dd>
				<dd class="sub">{{ report.keepers ? 'rated four stars or more' : 'once its scans are in' }}</dd>
			</div>
			<div class="r-density">
				<dt>Density</dt>
				<dd>
					<b>{{ report.density ? (report.density.roll / 100).toFixed(2) : '—' }}</b>
					<small v-if="report.density?.lift != null" class="lift" :class="{ warn: report.density.lift >= 3, good: report.density.lift <= -2 }">
						{{ report.density.lift > 0 ? '+' : report.density.lift < 0 ? '−' : '±' }}{{ (Math.abs(report.density.lift) / 100).toFixed(2) }} vs usual
					</small>
				</dd>
				<dd class="sub">
					<template v-if="!report.density">black point, once scans are in</template>
					<template v-else-if="report.density.lift == null">black point; too few other rolls of this film to compare</template>
					<template v-else>black point vs this film elsewhere: {{ report.density.lift >= 3 ? 'thinner' : report.density.lift <= -2 ? 'denser' : 'typical' }}</template>
				</dd>
			</div>
			<div class="r-cost">
				<dt>A frame cost</dt>
				<dd><b>{{ report.cost?.perFrameCents != null ? formatMoney(report.cost.perFrameCents) : '—' }}</b></dd>
				<dd class="sub">{{ report.cost ? `${formatMoney(report.cost.totalCents)} in all` : 'add the film and lab prices' }}</dd>
			</div>
			<div class="r-days">
				<dt>Days</dt>
				<dd>
					<span v-if="Object.keys(report.days).length" class="days-bar" aria-hidden="true">
						<i v-for="(d, k) in report.days" :key="k" :style="{ flexGrow: Math.max(0.4, d ?? 0), '--c': `var(--lab-stage-${DAY_STAGE[k]})` }">{{ d }}</i>
					</span>
					<b v-else>—</b>
				</dd>
				<dd class="sub">{{ Object.keys(report.days).length ? Object.keys(report.days).map((k) => DAY_LABEL[k as keyof typeof DAY_LABEL]).join(' · ') : 'from loading to filing' }}</dd>
			</div>
		</dl>

		<RollStrip
			:code="roll.code"
			:stock-name="roll.stock.name"
			:profile="strip?.profile ?? null"
			:scans="strip?.scans ?? null"
			:frames="framesList"
			:exposures="roll.exposures"
			:first-scan-frame="roll.firstScanFrame"
			:roll-id="readOnly ? undefined : roll.id"
			:read-only="readOnly"
			@shift="shiftScans"
			@marked="(n: number) => (report.keepers = report.keepers ? { ...report.keepers, n } : report.keepers)"
		/>

		<div class="grid">
			<div class="col-main">
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
							<button v-if="!readOnly" type="button" class="lab-btn lab-btn--quiet lab-btn--danger" :disabled="busy" @click="link(null)">Unlink</button>
						</div>
					</template>
					<p v-else-if="readOnly" class="lab-meta">Not on the public film desk yet.</p>
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
				<RollShare
					v-if="roll.publicRollId && strip && !readOnly"
					:key="roll.publicRollId"
					:roll="roll"
					:sample="shareSample"
					:last-published="lastPublished"
					@saved="roll = $event"
				/>
				<form class="lab-form details" :class="{ 'read-only': readOnly }" @submit.prevent="saveDetails">
					<fieldset class="ro-wrap" :disabled="readOnly">
					<div class="docket" aria-hidden="true">
						<span class="docket-no">Roll docket · {{ roll.code }}</span>
						<span class="barcode" :style="{ background: barcode }"></span>
					</div>
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
						<div class="lab-row2">
							<label class="lab-field">
								<span>Rated at ISO</span>
								<input id="d-iso" v-model="f.shotAtIso" class="lab-input" type="number" min="1" max="12800" />
								<small v-if="push" class="lab-hint">{{ push }}</small>
							</label>
							<label class="lab-field">
								<span>Exposure comp (EV)</span>
								<input id="d-comp" v-model="f.exposureComp" class="lab-input" type="number" min="-5" max="5" step="0.1" inputmode="decimal" placeholder="0" />
							</label>
						</div>
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
						<label class="lab-field">
							<span>Got there</span>
							<select id="d-delivery" v-model="f.labDelivery" class="lab-input lab-select">
								<option value="">Not recorded</option>
								<option value="dropoff">Dropped off</option>
								<option value="mail">Mailed in</option>
							</select>
						</label>
						<template v-if="f.labDelivery === 'mail'">
							<label class="lab-field">
								<span>Tracking, outbound</span>
								<input id="d-track-out" v-model="f.trackingOut" class="lab-input mono" type="text" maxlength="60" autocomplete="off" spellcheck="false" />
							</label>
							<label class="lab-field">
								<span>Tracking, negatives coming back</span>
								<input id="d-track-back" v-model="f.trackingBack" class="lab-input mono" type="text" maxlength="60" autocomplete="off" spellcheck="false" />
							</label>
						</template>
						<div class="lab-row2">
							<label class="lab-field"><span>Order</span><input id="d-order" v-model="f.labOrder" class="lab-input" type="text" maxlength="60" /></label>
							<label class="lab-field"><span>Dev + scans ($)</span><input id="d-cost" v-model="f.devCost" class="lab-input" type="number" min="0" step="0.01" /></label>
						</div>
						<label class="check">
							<input id="d-prints" v-model="f.printsIncluded" type="checkbox" />
							<span>Price includes prints</span>
						</label>
						<label v-if="!f.printsIncluded" class="lab-field">
							<span>Prints ($) <small>(if you ordered them)</small></span>
							<input id="d-prints-cost" v-model="f.printsCost" class="lab-input" type="number" min="0" step="0.01" />
						</label>
						<label class="lab-field"><span>Notes for the lab</span><input id="d-devnotes" v-model="f.devNotes" class="lab-input" type="text" maxlength="300" /></label>
						<label class="lab-field"><span>Negatives filed in</span><input id="d-neg" v-model="f.negativesAt" class="lab-input" type="text" maxlength="80" placeholder="Binder 1, page 23" /></label>
					</fieldset>
					<label class="lab-field">
						<span>Notes</span>
						<textarea id="d-notes" v-model="f.notes" class="lab-input" rows="4" maxlength="2000"></textarea>
					</label>
					<p v-if="saved" class="lab-hint" role="status">Saved.</p>
					<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
					</fieldset>
					<div v-if="!readOnly" class="lab-actions">
						<button type="submit" class="lab-btn" :disabled="busy">Save details</button>
						<button type="button" class="lab-btn lab-btn--quiet lab-btn--danger push-right" :disabled="busy" @click="remove">
							{{ confirmDelete ? 'Delete it for good?' : 'Delete roll' }}
						</button>
					</div>
				</form>
			</aside>
		</div>

		<LabDialog :open="!!stepTo" :title="stepTo ? stepVerb(stepTo, roll.labDelivery) : ''" @close="stepTo = null">
			<StepForm v-if="stepTo" :key="stepTo" :roll="roll" :to="stepTo" :choices="choices" :today="today" :binder-hints="binderHints" @done="stepped" @cancel="stepTo = null" />
		</LabDialog>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { dollars, num, run } from '../../lib/lab/client';
import {
	daysBetween,
	formatDay,
	formatDays,
	formatMoney,
	nextStage,
	pushPull,
	STAGES,
	STATUS_LABEL,
	STEP_VERB,
	stepVerb,
	toCents,
	type FrameView,
	type RollEventView,
	type RollStatus,
	type RollView,
	type StepChoices,
	type StockView,
	ratingLine,
	stageLabel,
} from '../../lib/lab/inventory';
import FilmCanister from '../film/FilmCanister.vue';
import LabDialog from './LabDialog.vue';
import RollShare from './RollShare.vue';
import RollStrip from './RollStrip.vue';
import { alignScans } from '../../lib/lab/alignment';
import StepForm from './StepForm.vue';
import TrackingNumber from './TrackingNumber.vue';
import { useTracks } from '../../lib/lab/use-tracks';
import type { NegativeProfileKey } from '../film/negative';
import type { RollReport } from '../../lib/lab/server/report';

const DAY_STAGE = { camera: 'camera', waiting: 'shot', lab: 'lab', filing: 'scanned' } as const;
const DAY_LABEL = { camera: 'camera', waiting: 'waiting', lab: 'lab', filing: 'to file' } as const;

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
		scans: { file: string; src: string; full: string; frame: number; w?: number; h?: number; exposure: number; tone?: [number, number, number] | null; keeper?: boolean; mark?: number | null; priority?: number }[];
	} | null;
	frames: FrameView[];
	lensNames: Record<string, string>;
	lastPublished: string | null;
	report: RollReport;
	/** A guest looking round: everything shown, nothing changed. */
	readOnly?: boolean;
}>();

const framesList = ref<FrameView[]>([...props.frames]);
/** The report card, kept here so marking keepers updates it. */
const report = ref<RollReport>({ ...props.report });

/** The roll page's frames list (a separate island) saved a change: keep the strip in step. */
function onFrames(e: Event) {
	const d = (e as CustomEvent<{ rollId: string; frames: FrameView[] }>).detail;
	if (d.rollId === props.roll.id) framesList.value = d.frames;
}
onMounted(() => window.addEventListener('lab:frames', onFrames));
onBeforeUnmount(() => window.removeEventListener('lab:frames', onFrames));

/** Shift which frame the lab's first scan is, and tell the frames list. */
async function shiftScans(firstScanFrame: number) {
	const view = await act(() => run(actions.lab.setFirstScanFrame({ rollId: roll.value.id, firstScanFrame })));
	if (view) {
		roll.value = view;
		window.dispatchEvent(new CustomEvent('lab:align', { detail: { rollId: view.id, firstScanFrame: view.firstScanFrame } }));
	}
}

/** The first frame that lines up with a scan, for the sharing preview. */
const shareSample = computed(() => {
	if (!props.strip) return null;
	const aligned = alignScans(props.strip.scans.map((s) => s.file), framesList.value, roll.value.firstScanFrame);
	const f = [...aligned.values()].find((x) => x.aperture != null || x.shutter != null) ?? [...aligned.values()][0];
	return f ? { aperture: f.aperture, shutter: f.shutter, focalLength: f.focalLength, note: f.note, lensName: f.lensId ? (props.lensNames[f.lensId] ?? null) : null } : null;
});

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
// Live status for the roll's tracking numbers, asked for once the page is up.
const { tracks } = useTracks(() => [roll.value.trackingOut, roll.value.trackingBack]);

const summary = computed(() =>
	[
		roll.value.title ? roll.value.stock.name : null,
		`${roll.value.exposures} exp`,
		roll.value.stock.process,
		roll.value.shotAtIso || roll.value.exposureComp ? ratingLine(roll.value) : null,
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
	if (r.status === 'lab') return `${r.labDelivery === 'mail' ? 'Mailed to' : 'At'} ${r.lab?.name ?? 'the lab'} ${days}${r.labOrder ? ` · order ${r.labOrder}` : ''}`;
	if (r.status === 'negatives' && r.negativesAt) return `Filed in ${r.negativesAt}`;
	return '';
});

/** A docket's barcode, drawn from the roll's code (decoration only). */
const barcode = computed(() => {
	const bits = [...roll.value.code].flatMap((c) => {
		const n = c.charCodeAt(0);
		return [1 + (n % 3), 1 + ((n >> 2) % 2), 1 + ((n >> 1) % 3), 1 + (n % 2)];
	});
	let x = 0;
	const stops: string[] = [];
	bits.forEach((w, i) => {
		const ink = i % 2 === 0 ? 'currentColor' : 'transparent';
		stops.push(`${ink} ${x}px ${x + w}px`);
		x += w;
	});
	return `linear-gradient(90deg, ${stops.join(', ')}, transparent ${x}px)`;
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
		exposureComp: (r.exposureComp ?? '') as string | number,
		labId: r.lab?.id ?? '',
		labOrder: r.labOrder ?? '',
		labDelivery: (r.labDelivery ?? '') as '' | 'dropoff' | 'mail',
		trackingOut: r.trackingOut ?? '',
		trackingBack: r.trackingBack ?? '',
		devCost: dollars(r.devCostCents) as string | number,
		printsIncluded: r.printsIncluded,
		printsCost: dollars(r.printsCostCents) as string | number,
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
				exposureComp: num(f.exposureComp),
				labId: f.labId || null,
				labOrder: f.labOrder,
				labDelivery: f.labDelivery || null,
				trackingOut: f.labDelivery === 'mail' ? f.trackingOut : null,
				trackingBack: f.labDelivery === 'mail' ? f.trackingBack : null,
				devCostCents: toCents(f.devCost),
				printsIncluded: f.printsIncluded,
				printsCostCents: f.printsIncluded ? null : toCents(f.printsCost),
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
.check {
	display: inline-flex;
	align-items: center;
	gap: 0.55rem;
	font-size: var(--text-sm);
	cursor: pointer;
}

.check input {
	width: 1.1rem;
	height: 1.1rem;
	accent-color: var(--accent-regular);
}

.mono {
	font-family: var(--font-mono);
	letter-spacing: 0.04em;
}

.step-track {
	margin-top: 0.2rem;
}

.roll-page {
	display: grid;
	gap: clamp(2rem, 5vw, 3rem);
}

/* ---- The roll, standing on the table under a lamp ---- */
.roll-head {
	display: flex;
	align-items: center;
	gap: clamp(1.25rem, 4vw, 2.75rem);
}

.can {
	position: relative;
	display: grid;
	place-items: center;
	flex: none;
	padding: 1.25rem 1rem 0.75rem;
}

/* The pool of lamplight it stands in, and its shadow on the table. */
.can::before {
	content: '';
	position: absolute;
	inset: -1.5rem -2rem -0.5rem;
	z-index: -1;
	border-radius: 50%;
	background: radial-gradient(closest-side, oklch(97% 0.05 85 / 0.9), oklch(95% 0.04 85 / 0.35) 55%, transparent);
}

:root.theme-dark .can::before {
	background: radial-gradient(closest-side, oklch(55% 0.13 40 / 0.4), oklch(40% 0.1 35 / 0.15) 55%, transparent);
}

.can::after {
	content: '';
	position: absolute;
	left: 50%;
	bottom: 0.45rem;
	width: 70%;
	height: 0.7rem;
	translate: -50% 0;
	z-index: -1;
	border-radius: 50%;
	background: radial-gradient(closest-side, rgb(0 0 0 / 0.35), transparent);
}

@media (prefers-reduced-motion: no-preference) {
	/* Set down on the table. */
	.can :deep(.canister) {
		animation: set-down 0.8s cubic-bezier(0.3, 1.4, 0.5, 1) both;
	}

	.can::after {
		animation: shadow-in 0.8s ease-out both;
	}

	@keyframes set-down {
		from {
			translate: 0 -1.6rem;
			rotate: -6deg;
			opacity: 0;
		}
	}

	@keyframes shadow-in {
		from {
			scale: 0.4;
			opacity: 0;
		}
	}
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

/* The code, on a strip of masking tape. */
.big-code {
	font-size: 1.55rem;
	padding: 0.4rem 0.85rem 0.3rem;
	background: linear-gradient(180deg, oklch(93% 0.035 88), oklch(88% 0.042 85));
	color: oklch(20% 0.01 60);
	clip-path: polygon(1% 10%, 8% 0, 22% 7%, 39% 1%, 57% 8%, 74% 0, 90% 6%, 100% 2%, 99% 90%, 91% 100%, 73% 93%, 55% 100%, 36% 94%, 18% 100%, 5% 93%, 0 100%);
	box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
}

/* Where it is now, as a rubber stamp. */
.stage-stamp {
	padding: 0.2rem 0.65rem;
	border: 1.5px solid currentColor;
	border-radius: 3px;
	color: oklch(48% 0.14 28);
	font-size: 0.68rem;
	font-weight: 600;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	rotate: -2deg;
	box-shadow: inset 0 0 0 1px color-mix(in oklch, currentColor 25%, transparent);
}

:root.theme-dark .stage-stamp {
	color: oklch(72% 0.14 32);
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

/*
 * ---- Where it's been: a strip of film running down the page ----
 * Each stage is a frame: developed (done), lit on the light table (now),
 * or still dark (to come).
 */
.steps {
	list-style: none;
	padding: 0.4rem 0 0;
	display: grid;
}

.step {
	--strip: 2.2rem;
	position: relative;
	display: grid;
	grid-template-columns: var(--strip) minmax(0, 1fr);
	gap: 1.1rem;
	padding-bottom: 1.4rem;
}

.step::before {
	content: '';
	position: absolute;
	left: 0;
	top: 0;
	bottom: 0;
	width: var(--strip);
	background:
		repeating-linear-gradient(180deg, oklch(84% 0.01 80) 0 4px, transparent 4px 9px) 3px 2px / 4px 100% no-repeat,
		repeating-linear-gradient(180deg, oklch(84% 0.01 80) 0 4px, transparent 4px 9px) calc(100% - 3px) 2px / 4px 100% no-repeat,
		var(--lab-film);
}

.step:first-child::before {
	top: -0.4rem;
	border-radius: 3px 3px 0 0;
}

/* The roll's end: the tongue, cut at an angle. */
.step:last-child::before {
	bottom: -0.6rem;
	clip-path: polygon(0 0, 100% 0, 100% calc(100% - 0.9rem), 0 100%);
}

.pip {
	position: relative;
	z-index: 1;
	display: grid;
	place-items: center;
	justify-self: center;
	width: 1.25rem;
	height: 1.6rem;
	margin-top: 0.05rem;
	border-radius: 2px;
	background: var(--lab-film-frame);
	font-family: var(--font-mono);
	font-size: 0.68rem;
	color: oklch(70% 0.02 70);
}

/* Developed: the orange of a C-41 negative. */
.step.done .pip {
	background: linear-gradient(180deg, oklch(68% 0.13 58), oklch(57% 0.12 50));
	color: oklch(22% 0.03 50);
	font-weight: 600;
}

/* Now: held up to the light. */
.step.now .pip {
	background: var(--lab-lit);
	color: oklch(22% 0.01 60);
	font-weight: 600;
	box-shadow:
		0 0 0 1px oklch(100% 0 0 / 0.5) inset,
		0 0 16px 2px var(--lab-lit-glow);
}

@media (prefers-reduced-motion: no-preference) {
	.step.now .pip {
		animation: lit 2.8s ease-in-out infinite alternate;
	}

	@keyframes lit {
		to {
			box-shadow:
				0 0 0 1px oklch(100% 0 0 / 0.5) inset,
				0 0 26px 5px var(--lab-lit-glow);
		}
	}
}

.step.lost .pip {
	background: oklch(52% 0.18 28);
	color: oklch(97% 0.01 80);
}

.step-body {
	display: grid;
	gap: 0.3rem;
	padding-top: 0.15rem;
	min-width: 0;
}

.step-t {
	color: var(--gray-0);
	font-size: var(--text-md);
	line-height: 1.2;
}

.step.now .step-t {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
}

.step.later .step-t {
	color: var(--gray-300);
}

.step-d {
	justify-self: start;
	padding: 0;
	border: 0;
	background: none;
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--gray-300);
	text-align: left;
	cursor: pointer;
}

.step-d:hover {
	color: var(--gray-0);
}

.step-d:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.step-x {
	font-size: var(--text-sm);
	color: var(--gray-200);
}

.edit {
	margin-left: 0.4rem;
	font-family: var(--font-body);
	font-size: 0.72rem;
	text-decoration: underline;
	opacity: 0;
	transition: opacity 0.15s ease;
}

.step-d:hover .edit,
.step-d:focus-visible .edit {
	opacity: 0.8;
}

@media (pointer: coarse) {
	.edit {
		opacity: 0.7;
	}
}

/* ---- the head's actions, and the report card ---- */
.head-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 0.75rem;
	margin-top: 0.35rem;
}

.lifeline-wrap {
	min-width: 0;
}

.report {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	gap: 0;
	margin: 0;
	border-radius: 0.7rem;
	background: var(--lab-card);
	box-shadow:
		0 0 0 1px var(--gray-800),
		var(--lab-lift-0);
	overflow: hidden;
}

.report > div {
	display: grid;
	align-content: start;
	gap: 0.15rem;
	padding: 0.85rem 1rem 0.9rem;
	border-left: 1px solid var(--gray-800);
	min-width: 0;
}

.report > div:first-child {
	border-left: 0;
}

.report dt {
	font-family: var(--font-mono);
	font-size: 0.64rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.report dd {
	margin: 0;
}

.report b {
	font-family: var(--font-brand);
	font-size: var(--text-2xl);
	font-weight: 500;
	line-height: 1.1;
	font-variant-numeric: tabular-nums;
}

.report small {
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--gray-300);
}

.report small.lift {
	margin-left: 0.35rem;
}

.report small.warn {
	color: var(--lab-warn);
}

.report small.good {
	color: var(--lab-ok);
}

.report .sub {
	font-size: 0.78rem;
	line-height: 1.3;
	color: var(--gray-300);
	text-wrap: pretty;
}

.days-bar {
	display: flex;
	gap: 2px;
	height: 1.9rem;
	margin-top: 0.15rem;
}

.days-bar i {
	display: grid;
	place-items: center;
	min-width: 1.4rem;
	border-top: 3px solid var(--c);
	background: color-mix(in oklch, var(--c) 22%, transparent);
	font-family: var(--font-mono);
	font-size: 0.72rem;
	font-style: normal;
}

@media (max-width: 56em) {
	.report {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.report > div {
		border-left: 0;
		border-top: 1px solid var(--gray-800);
	}

	.report > div:nth-child(-n + 2) {
		border-top: 0;
	}

	.report > div:nth-child(even) {
		border-left: 1px solid var(--gray-800);
	}

	.r-days {
		grid-column: 1 / -1;
		border-left: 0 !important;
	}
}

/*
 * ---- On wide screens the line runs across the page: the six stations as
 * frames on one strip of film, sprockets top and bottom. ----
 */
@media (min-width: 56em) {
	.lifeline {
		grid-template-columns: repeat(6, minmax(0, 1fr));
		padding: 1.1rem 0.5rem 1rem;
		border-radius: 4px;
		background:
			repeating-linear-gradient(90deg, oklch(84% 0.01 80) 0 6px, transparent 6px 13px) 0 0.3rem / 100% 4px no-repeat,
			repeating-linear-gradient(90deg, oklch(84% 0.01 80) 0 6px, transparent 6px 13px) 0 calc(100% - 0.3rem) / 100% 4px no-repeat,
			var(--lab-film);
		box-shadow: var(--lab-lift-1);
	}

	.lifeline.lost {
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}

	.lifeline .step {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto 1fr;
		gap: 0.45rem;
		margin-inline: 0.2rem;
		padding: 0.55rem 0.6rem 0.65rem;
		border-radius: 2px;
		background: var(--lab-film-frame);
		color: oklch(88% 0.012 75);
	}

	.lifeline .step::before {
		display: none;
	}

	.lifeline .pip {
		justify-self: start;
		width: 1.4rem;
		height: 1.4rem;
	}

	.lifeline .step-t {
		color: oklch(92% 0.01 80);
		font-size: var(--text-base);
	}

	.lifeline .step.later .step-t {
		color: oklch(66% 0.012 75);
	}

	.lifeline .step-d,
	.lifeline .step-x {
		color: oklch(78% 0.012 75);
	}

	.lifeline .step-d:hover {
		color: oklch(97% 0.01 80);
	}

	/* The frame you're on: lit, held to the light. */
	.lifeline .step.now {
		background: var(--lab-lit);
		color: oklch(22% 0.01 60);
		box-shadow:
			0 0 0 1px oklch(100% 0 0 / 0.4) inset,
			0 0 24px -4px var(--lab-lit-glow);
	}

	.lifeline .step.now .step-t,
	.lifeline .step.now .step-d,
	.lifeline .step.now .step-x {
		color: oklch(22% 0.01 60);
	}

	.lifeline .step.now .pip {
		background: oklch(22% 0.01 60);
		color: var(--lab-lit);
		animation: none;
	}

	.lifeline .ev-edit {
		display: grid;
	}
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

.col-side {
	display: grid;
	gap: 1.25rem;
	align-content: start;
}

/*
 * ---- Details: the roll's docket, torn off a pad ----
 * Card stock with a perforated top edge, fields as ruled lines.
 */
.details {
	--card: oklch(97.6% 0.014 85);
	--rule: oklch(72% 0.03 240 / 0.45);
	--card-ink: oklch(24% 0.01 60);
	--card-soft: oklch(42% 0.015 60);
	position: relative;
	padding: 1.6rem 1.35rem 1.35rem;
	background: var(--card);
	color: var(--card-ink);
	border-radius: 0 0 0.35rem 0.35rem;
	box-shadow:
		0 1px 1px rgb(0 0 0 / 0.08),
		0 14px 30px -18px rgb(0 0 0 / 0.45);
}

/* The perforations it was torn along. */
.details::before {
	content: '';
	position: absolute;
	inset: 0 0 auto;
	height: 5px;
	background: radial-gradient(circle at 7px 0, var(--gray-999) 3.4px, transparent 3.9px) 0 0 / 14px 5px repeat-x;
	pointer-events: none;
}

:root.theme-dark .details {
	--card: oklch(21% 0.01 60);
	--rule: oklch(60% 0.03 240 / 0.3);
	--card-ink: oklch(93% 0.008 80);
	--card-soft: oklch(76% 0.012 75);
	box-shadow:
		0 0 0 1px oklch(100% 0 0 / 0.04),
		0 18px 34px -18px rgb(0 0 0 / 0.9);
}

.docket {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding-bottom: 0.7rem;
	border-bottom: 1.5px solid var(--card-ink);
	color: var(--card-ink);
}

.docket-no {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.18em;
	text-transform: uppercase;
}

.barcode {
	flex: none;
	width: 4.5rem;
	height: 1.4rem;
	background-size: 100% 100%;
	opacity: 0.85;
}

.details .lab-h2 {
	color: var(--card-ink);
}

.details :is(.lab-field > span, .check, .lab-hint) {
	color: var(--card-soft);
}

.details .lab-input {
	min-height: 2.4rem;
	padding-inline: 0.15rem;
	border: 0;
	border-bottom: 1px solid var(--rule);
	border-radius: 0;
	background-color: transparent;
	color: var(--card-ink);
}

.details .lab-input:focus-visible {
	outline: none;
	border-bottom: 2px solid var(--card-ink);
	background-color: color-mix(in oklch, var(--card-ink) 5%, transparent);
}

.details .lab-select {
	padding-right: 1.8rem;
	background-image:
		linear-gradient(45deg, transparent 50%, var(--card-soft) 50%),
		linear-gradient(135deg, var(--card-soft) 50%, transparent 50%);
	background-position:
		calc(100% - 0.85rem) 52%,
		calc(100% - 0.5rem) 52%;
	background-size: 0.35rem 0.35rem;
	background-repeat: no-repeat;
}

/* Notes: lined paper. */
.details textarea.lab-input {
	line-height: 1.75rem;
	padding-top: 0.2rem;
	border-bottom: 0;
	background-image: repeating-linear-gradient(transparent 0 calc(1.75rem - 1px), var(--rule) calc(1.75rem - 1px) 1.75rem);
	background-attachment: local;
	background-position: 0 0.2rem;
}

.details .lab-btn:not(.lab-btn--quiet) {
	background: var(--card-ink);
	border-color: var(--card-ink);
	color: var(--card);
}

.details .lab-btn--quiet {
	color: var(--card-ink);
	border-color: color-mix(in oklch, var(--card-ink) 35%, transparent);
}

.details .lab-btn--danger {
	color: oklch(50% 0.16 35);
	border-color: oklch(50% 0.16 35 / 0.5);
}

:root.theme-dark .details .lab-btn--danger {
	color: oklch(76% 0.13 45);
	border-color: oklch(76% 0.13 45 / 0.5);
}

fieldset {
	display: grid;
	gap: 0.75rem;
	padding: 0;
	border: 0;
	min-width: 0;
}

/* Section labels, stamped on with a rule running out to the edge. */
legend {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	width: 100%;
	padding: 0.4rem 0 0.35rem;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	font-weight: 600;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--card-ink);
}

legend::after {
	content: '';
	flex: 1;
	height: 1px;
	background: var(--card-ink);
	opacity: 0.35;
}

textarea.lab-input {
	resize: vertical;
}

.ro-wrap {
	display: contents;
	border: 0;
	margin: 0;
	padding: 0;
}

/* A guest reads the docket; the fields look printed, not editable. */
.details.read-only .lab-input {
	background: transparent;
	border-color: transparent;
	padding-inline: 0;
	opacity: 1;
	-webkit-text-fill-color: currentColor;
}

.details.read-only .lab-select {
	background-image: none;
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
		padding-inline: 0.5rem;
	}
}
</style>
