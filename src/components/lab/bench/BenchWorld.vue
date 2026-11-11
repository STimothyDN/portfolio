<script setup lang="ts">
/**
 * The bench: the whole lab on one surface, laid out as a roll's loop.
 *
 *   1 Fridge ──load──▶ 2 Cameras ──finish──▶ 3 Shot
 *       ▲                 Today                 │ send
 *   6 Binder ◀──file── 5 Light table ◀──scans── 4 Post
 *
 * A roll is a physical thing that changes shape as it goes round: a canister
 * in the fridge, film across a camera's gate, a loose canister in the tray, an
 * envelope, a strip of negatives on the light table, a sleeve in the binder.
 * Moving it is picking it up and putting it where it goes next (drag, or its
 * button), confirming one small slip, and watching it travel (carry.ts). Every
 * move can be undone from the toast.
 */
import { actions } from 'astro:actions';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { run, upsert } from '../../../lib/lab/client';
import {
	daysBetween,
	expiryNote,
	formatDay,
	formatExpiry,
	formatMoney,
	nextStage,
	STATUS_LABEL,
	stepVerb,
	type RollStatus,
	type RollView,
} from '../../../lib/lab/inventory';
import { ghostOf, land, type Snapshot } from '../../../lib/lab/motion/carry';
import { applyPending, flush, labUserId, pending, type MaybeQueued } from '../../../lib/lab/offline';
import { createDrag, type DragItem, type DropTarget, type Dropped } from '../../../lib/lab/motion/drag';
import { nudges as rankNudges, type Nudge } from '../../../lib/lab/nudges';
import { formatMonths, rollPace } from '../../../lib/lab/pace';
import type { BenchData } from '../../../lib/lab/server/bench';
import { returnWindow } from '../../../lib/lab/stats/labs';
import { daysHere } from '../../../lib/lab/stats/pipeline';
import { TRACK_STATUS } from '../../../lib/lab/tracking';
import { useTracks } from '../../../lib/lab/use-tracks';
import { canisterColors } from '../../film/canister';
import FilmCanister from '../../film/FilmCanister.vue';
import ImportDesk from '../ImportDesk.vue';
import LabDialog from '../LabDialog.vue';
import PublishButton from '../PublishButton.vue';
import StepForm from '../StepForm.vue';
import BinderSpine from '../objects/BinderSpine.vue';
import CameraTop from '../objects/CameraTop.vue';
import Envelope from '../objects/Envelope.vue';
import NegFilters from '../objects/NegFilters.vue';
import NegStrip from '../objects/NegStrip.vue';
import RollCan from '../objects/RollCan.vue';
import TodayCard from '../objects/TodayCard.vue';
import ArriveSlip from './ArriveSlip.vue';
import SendSlip from './SendSlip.vue';

const props = defineProps<{ data: BenchData; firstName?: string; move?: string | null; /** A guest looking round the owner's lab: everything visible, nothing movable. */ readOnly?: boolean }>();

const today = props.data.today;
const rolls = ref<RollView[]>([...props.data.rolls]);
const filedCount = ref(props.data.filed.count);
const recentFiled = ref<RollView[]>([...props.data.filed.recent]);
const strips = ref({ ...props.data.strips });
const stage = ref<HTMLElement | null>(null);
const annotate = ref(false);
const error = ref('');

/* ---------- where everything is ---------- */

const by = (s: RollStatus) => rolls.value.filter((r) => r.status === s).sort((a, b) => a.statusOn.localeCompare(b.statusOn) || a.code.localeCompare(b.code));
const storage = computed(() => by('storage'));
const loaded = computed(() => by('camera'));
const shot = computed(() => by('shot'));
const atLab = computed(() => by('lab'));
const scanned = computed(() => by('scanned'));

/** The fridge: one canister per stock, the oldest-dated roll in front (use oldest first). */
const groups = computed(() => {
	const map = new Map<string, RollView[]>();
	for (const r of storage.value) {
		const list = map.get(r.stock.id);
		if (list) list.push(r);
		else map.set(r.stock.id, [r]);
	}
	return [...map.values()]
		.map((list) => {
			list.sort((a, b) => (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.code.localeCompare(b.code));
			const front = list[0];
			const note = expiryNote(front.expires, today);
			const late = list.filter((r) => props.data.forecast.byStock[r.stock.id]?.late.includes(r.id)).length;
			return { key: front.stock.id, front, list, note, late, forecast: props.data.forecast.byStock[front.stock.id] ?? null };
		})
		.sort((a, b) => (a.front.expires ?? '9999').localeCompare(b.front.expires ?? '9999') || b.list.length - a.list.length);
});
const FRIDGE_SHOWN = 8;

/** Cameras: loaded ones first (with their roll), then the empty ones that could take film. */
const slots = computed(() => {
	const byCam = new Map(loaded.value.filter((r) => r.camera).map((r) => [r.camera!.id, r]));
	const known = new Set(props.data.cameras.map((c) => c.id));
	const loadedSlots = [
		...props.data.cameras.filter((c) => byCam.has(c.id)).map((c) => ({ camera: c, roll: byCam.get(c.id)! })),
		// A roll in a camera that's since been put away still shows.
		...loaded.value.filter((r) => !r.camera || !known.has(r.camera.id)).map((r) => ({ camera: { id: r.camera?.id ?? `none-${r.id}`, name: r.camera?.name ?? 'Unknown camera', kind: 'other', lastOut: null as string | null }, roll: r })),
	];
	const empty = props.data.cameras.filter((c) => !byCam.has(c.id) && c.status === 'active');
	// The camera loaded most recently first: what you just did is in view.
	loadedSlots.sort((a, b) => b.roll.statusOn.localeCompare(a.roll.statusOn) || a.camera.name.localeCompare(b.camera.name));
	return { loaded: loadedSlots, empty };
});
const paces = computed(() => new Map(loaded.value.map((r) => [r.id, rollPace(r, today)])));
/** Where a roll would usually go: the empty camera that takes its format and that you shoot most. */
function suggestCamera(r: RollView | null): string | undefined {
	if (!r) return undefined;
	const fits = slots.value.empty.filter((c) => c.format === r.stock.format);
	return [...(fits.length ? fits : slots.value.empty)].sort((a, b) => b.rolls - a.rolls)[0]?.id;
}

/** Post: one envelope per batch (same lab, same day, same way). */
const envelopes = computed(() => {
	const map = new Map<string, RollView[]>();
	for (const r of atLab.value) {
		const key = [r.lab?.id ?? '-', r.statusOn, r.labDelivery ?? '-', r.trackingOut ?? ''].join('|');
		const list = map.get(key);
		if (list) list.push(r);
		else map.set(key, [r]);
	}
	return [...map.entries()].map(([key, list]) => {
		const r = list[0];
		const lab = props.data.labs.find((l) => l.id === r.lab?.id);
		const w = returnWindow(r.statusOn, lab?.turnaround, today);
		const days = daysHere(r, today);
		const track = r.trackingOut ? tracks.value[r.trackingOut] : null;
		const status = track?.status ? TRACK_STATUS[track.status]?.label : null;
		return {
			key,
			rolls: list,
			lab: r.lab?.name ?? 'A lab',
			sentOn: r.statusOn,
			delivery: r.labDelivery,
			order: r.labOrder,
			window: w,
			readout: [w ? `day ${days} of ~${w.usual}` : `day ${days}`, status].filter(Boolean).join(' · '),
			progress: w ? w.progress : null,
			late: !!w && (w.late || days > w.usual + 2),
		};
	});
});
/** Blank envelopes to drop film on: the labs you use most recently first. */
const outgoing = computed(() => {
	const labs = [...props.data.choices.labs].sort((a, b) => Number(!!b.delivery) - Number(!!a.delivery));
	return labs.slice(0, 2);
});
const { tracks } = useTracks(() => atLab.value.map((r) => r.trackingOut));

const negUses = computed(() => Object.values(strips.value).flatMap((s) => s.scans.map((x) => ({ profile: s.profile, exposure: x.exposure }))));

const counts = computed(() => ({
	storage: storage.value.length,
	camera: loaded.value.length,
	shot: shot.value.length,
	lab: atLab.value.length,
	scanned: scanned.value.length,
	negatives: filedCount.value,
}));

const turnaround = computed(() => Object.fromEntries(props.data.labs.map((l) => [l.id, l.turnaround])));
const nudges = computed(() =>
	rankNudges({
		rolls: rolls.value,
		today,
		turnaround: Object.fromEntries(props.data.labs.filter((l) => l.turnaround).map((l) => [l.id, l.turnaround!])),
		forecast: props.data.forecast,
		canLink: !props.readOnly && props.data.owner && props.data.choices.deskRolls.length > 0,
		passkeys: props.readOnly ? 2 : props.data.passkeys,
	})
);
const fridgeValue = computed(() => storage.value.reduce((s, r) => s + (r.priceCents ?? 0), 0));

const can = (r: RollView) => canisterColors({ stock: r.stock.token ?? r.stock.id, stockLabel: r.stock.name, stockBrand: r.stock.brand });
const tilt = (id: string, spread = 14) => {
	let h = 0;
	for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
	return Math.round(((h / 997) * 2 - 1) * spread * 10) / 10;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- slips ---------- */

type Slip =
	| { kind: 'step'; roll: RollView; to: RollStatus; preset?: { cameraId?: string; labId?: string } }
	| { kind: 'send'; rollIds?: string[]; labId?: string }
	| { kind: 'arrive'; rolls: RollView[] }
	| { kind: 'load'; rollId?: string; cameraId?: string };
const slip = ref<Slip | null>(null);
const loadId = ref('');
const loadRoll = computed(() => storage.value.find((r) => r.id === loadId.value) ?? null);
const slipTitle = computed(() => {
	const s = slip.value;
	if (!s) return '';
	if (s.kind === 'step') {
		if (s.to === 'camera' && s.preset?.cameraId) return `Load ${s.roll.code} into the ${props.data.cameras.find((c) => c.id === s.preset!.cameraId)?.name ?? 'camera'}`;
		return `${stepVerb(s.to, s.roll.labDelivery)}: ${s.roll.code}`;
	}
	if (s.kind === 'send') return 'Send film to a lab';
	if (s.kind === 'arrive') return s.rolls.length > 1 ? 'Scans arrived' : `Scans arrived: ${s.rolls[0].code}`;
	const cam = props.data.cameras.find((c) => c.id === s.cameraId);
	const r = s.rollId ? storage.value.find((x) => x.id === s.rollId) : null;
	if (r) return cam ? `Load ${r.code} into the ${cam.name}` : `Load ${r.code}`;
	return cam ? `Load the ${cam.name}` : 'Load a roll';
});

function openStep(roll: RollView, to: RollStatus, preset?: { cameraId?: string; labId?: string }) {
	error.value = '';
	menu.value = null;
	if (to === 'lab') return openSend([roll.id]);
	slip.value = { kind: 'step', roll, to, preset };
}
function openSend(rollIds?: string[], labId?: string) {
	menu.value = null;
	slip.value = { kind: 'send', rollIds, labId };
}
function openLoad(rollId?: string, cameraId?: string) {
	menu.value = null;
	loadId.value = rollId ?? groups.value[0]?.front.id ?? '';
	slip.value = { kind: 'load', rollId, cameraId };
}
function openArrive(list: RollView[]) {
	menu.value = null;
	// One roll: the full step (it can link the scans on the film desk there and then); an envelope of several: one date for all.
	if (list.length === 1) slip.value = { kind: 'step', roll: list[0], to: 'scanned' };
	else slip.value = { kind: 'arrive', rolls: list };
}

/* ---------- moving rolls (and carrying them there) ---------- */

/** The object that is roll `id` right now, whatever shape it has. */
const rollEl = (id: string) =>
	stage.value?.querySelector<HTMLElement>(`[data-roll="${CSS.escape(id)}"]`) ?? stage.value?.querySelector<HTMLElement>(`[data-rolls~="${CSS.escape(id)}"]`) ?? null;
const snap = (id: string): Snapshot | null => {
	const el = rollEl(id);
	if (!el) return null;
	const rect = el.getBoundingClientRect();
	return rect.width && rect.height ? { clone: ghostOf(el, rect), rect } : null;
};
const ARRIVE: Partial<Record<RollStatus, string>> = { camera: 'arrive-load', shot: 'arrive-drop', lab: 'arrive-post', scanned: 'arrive-lit', negatives: 'arrive-file', storage: 'arrive-drop' };

function place(view: RollView) {
	if (view.status === 'negatives' || view.status === 'lost') {
		rolls.value = rolls.value.filter((r) => r.id !== view.id);
		if (view.status === 'negatives' && !recentFiled.value.some((r) => r.id === view.id)) {
			filedCount.value++;
			recentFiled.value = [view, ...recentFiled.value].slice(0, 4);
		}
	} else {
		if (recentFiled.value.some((r) => r.id === view.id)) {
			filedCount.value--;
			recentFiled.value = recentFiled.value.filter((r) => r.id !== view.id);
		}
		rolls.value = upsert(rolls.value, view);
	}
}

/** Apply moves and fly each roll from where it was to where it is now. */
async function moved(views: RollView[], undoable = true) {
	const snaps = new Map(views.map((v) => [v.id, snap(v.id)]));
	for (const v of views) place(v);
	// Say what happened at once (with its undo); the roll travels while you read it. With no signal
	// the move waits on this device (no undo until it has synced).
	const queued = views.some((v) => (v as MaybeQueued).queued);
	const tail = queued ? ' Saved on this phone; it syncs when there’s signal.' : '';
	if (queued) waitingMoves.value += views.length;
	if (views.length === 1) showToast(movedLine(views[0]) + tail, undoable && !queued ? views[0].id : undefined);
	else if (views.length) showToast(`${plural(views.length, 'roll')}: ${movedLine(views[0]).replace(/^R-\d+:? ?/, '')}${tail}`);
	await nextTick();
	await Promise.all(
		views.map((v, i) => {
			const s = snaps.get(v.id);
			const to = rollEl(v.id) ?? (v.status === 'negatives' ? stage.value?.querySelector<HTMLElement>('.z-binder .binder') ?? null : null);
			if (!s) return Promise.resolve();
			// Where it lands may be scrolled out of its station (a long row of cameras, a full rack).
			to?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
			return new Promise<void>((done) => setTimeout(() => land(s, to, { arrive: ARRIVE[v.status], spin: v.status === 'shot' ? -80 : 0 }).then(done), i * 90));
		})
	);
}

/** "R-031 loaded into the X-700.", "R-031 sent to Fotoshoppe." */
function movedLine(v: RollView): string {
	switch (v.status) {
		case 'storage':
			return `${v.code} is back in the fridge.`;
		case 'camera':
			return `${v.code} loaded${v.camera ? ` into the ${v.camera.name}` : ''}.`;
		case 'shot':
			return `${v.code} finished.`;
		case 'lab':
			return `${v.code} ${v.labDelivery === 'mail' ? 'mailed' : 'sent'}${v.lab ? ` to ${v.lab.name}` : ''}.`;
		case 'scanned':
			return `${v.code}: scans in.`;
		case 'negatives':
			return `${v.code} filed in the binder.`;
		default:
			return `${v.code}: ${STATUS_LABEL[v.status].toLowerCase()}.`;
	}
}

function done(views: RollView | RollView[]) {
	slip.value = null;
	void moved(Array.isArray(views) ? views : [views]);
}

const toast = ref<{ text: string; undo?: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string, undo?: string) {
	toast.value = { text, undo };
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toast.value = null), 7000);
}
async function undo(id: string) {
	toast.value = null;
	try {
		const view = await run(actions.lab.undoRollStep({ rollId: id }));
		await moved([view], false);
	} catch (e) {
		error.value = (e as Error).message;
	}
}

/* ---------- the menu an object opens when tapped ---------- */

const menu = ref<{ rollIds: string[]; x: number; y: number; flip: boolean } | null>(null);
const menuRolls = computed(() => (menu.value ? menu.value.rollIds.map((id) => rolls.value.find((r) => r.id === id)).filter((r): r is RollView => !!r) : []));
const menuEl = ref<HTMLElement | null>(null);
let menuFrom: HTMLElement | null = null;
function openMenu(e: MouseEvent, rollIds: string[]) {
	const el = e.currentTarget as HTMLElement;
	const host = stage.value!.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	const below = innerHeight - r.bottom > 220;
	menuFrom = el;
	menu.value = {
		rollIds,
		x: Math.round(Math.min(Math.max(r.left + r.width / 2 - host.left, 130), host.width - 130)),
		y: Math.round((below ? r.bottom : r.top) - host.top),
		flip: !below,
	};
	void nextTick(() => menuEl.value?.querySelector<HTMLElement>('button, a')?.focus());
}
function closeMenu(refocus = true) {
	menu.value = null;
	if (refocus) menuFrom?.focus();
}
function onDocDown(e: PointerEvent) {
	if (menu.value && menuEl.value && !menuEl.value.contains(e.target as Node) && !(e.target as Element).closest?.('[data-menu-host]')) closeMenu(false);
}

/* ---------- drag and drop ---------- */

const ACCEPTS: Record<string, string[]> = {
	// what's held → where it can go
	storage: ['camera-slot', 'cameras'],
	camera: ['shot'],
	shot: ['post', 'post-lab'],
	envelope: ['table'],
	scanned: ['binder'],
};
function accepts(item: DragItem, target: DropTarget) {
	return ACCEPTS[item.kind]?.includes(target.kind) ?? false;
}
function onDrop({ item, target, clone }: Dropped) {
	// The ghost flies home while the slip opens; once confirmed, the roll travels for real.
	clone.animate([{ opacity: 1 }, { opacity: 0, scale: '0.9' }], { duration: 220, fill: 'forwards' }).finished.then(() => clone.remove(), () => clone.remove());
	const roll = rolls.value.find((r) => r.id === item.id);
	if (item.kind === 'storage' && roll) {
		if (target.kind === 'camera-slot') openStep(roll, 'camera', { cameraId: target.id });
		else openLoad(roll.id);
	} else if (item.kind === 'camera' && roll) openStep(roll, 'shot');
	else if (item.kind === 'shot' && roll) openSend([roll.id], target.kind === 'post-lab' ? target.id : undefined);
	else if (item.kind === 'envelope') {
		const env = envelopes.value.find((e) => e.key === item.id);
		if (env) openArrive(env.rolls);
	} else if (item.kind === 'scanned' && roll) openStep(roll, 'negatives');
}

let stopDrag: (() => void) | null = null;

/* ---------- no signal: moves wait on this device and sync when it's back ---------- */

const waitingMoves = ref(0);
const lookups = () => ({
	cameras: Object.fromEntries(props.data.cameras.map((c) => [c.id, { name: c.name }])),
	labs: Object.fromEntries(props.data.labs.map((l) => [l.id, { name: l.name }])),
});
/** Opened from this device's saved copy: lay the moves still waiting over it. */
async function applyOutbox() {
	const uid = labUserId();
	if (!uid || props.readOnly) return;
	const items = await pending(uid).catch(() => []);
	waitingMoves.value = items.length;
	const calls = items.filter((i) => i.kind === 'call');
	if (!calls.length) return;
	const before = [...rolls.value, ...recentFiled.value];
	for (const v of applyPending(before, calls, lookups())) {
		const was = before.find((r) => r.id === v.id);
		if (was && (was.status !== v.status || was.statusOn !== v.statusOn)) place(v);
	}
}
let syncing = false;
async function syncOutbox() {
	const uid = labUserId();
	if (!uid || props.readOnly || syncing || !waitingMoves.value) return;
	syncing = true;
	try {
		const r = await flush(uid);
		for (const v of r.rolls) place(v);
		waitingMoves.value = r.left;
		if (r.refused.length) error.value = `Not saved: ${r.refused[0]}`;
		else if (r.sent && !r.left) showToast('Synced: every move made offline is saved.');
	} catch {
		// Still no signal.
	} finally {
		syncing = false;
	}
}
let syncTimer: ReturnType<typeof setInterval> | undefined;

/* ---------- the Today card ---------- */

function act(n: Nudge) {
	const a = n.action;
	if (a.kind === 'href') location.href = a.href;
	else if (a.kind === 'load') openLoad(a.rollId);
	else if (a.kind === 'send') openSend();
	else {
		const r = rolls.value.find((x) => x.id === a.rollId);
		if (!r) return;
		if (a.to === 'scanned') openArrive([r]);
		else if (a.to === 'camera') openLoad(r.id);
		else openStep(r, a.to);
	}
}

/* ---------- the owner's "loaded now" line on the film desk ---------- */

const share = ref<boolean | null>(props.data.shareLoaded);
const shareChanged = ref(false);
async function toggleShare() {
	if (share.value === null) return;
	try {
		const r = await run(actions.lab.updateSettings({ shareLoaded: !share.value }));
		share.value = r.shareLoaded;
		shareChanged.value = true;
	} catch (e) {
		error.value = (e as Error).message;
	}
}

/* ---------- the verbs printed between stations ---------- */

const connectors = ref<{ key: string; label: string; x: number; y: number; dir: 'r' | 'd' | 'l' | 'u' }[]>([]);
const LINKS: [string, string, string, 'r' | 'd' | 'l' | 'u'][] = [
	['fridge', 'cameras', 'load', 'r'],
	['cameras', 'shot', 'finish', 'r'],
	['shot', 'post', 'send', 'd'],
	['post', 'table', 'scans', 'l'],
	['table', 'binder', 'file', 'l'],
];
function measure() {
	const root = stage.value;
	if (!root) return;
	const host = root.getBoundingClientRect();
	// The mat fills the screen from where it starts (the body is the scroller here).
	root.style.setProperty('--bench-top', `${Math.round(host.top + document.body.scrollTop)}px`);
	const rect = (k: string) => root.querySelector<HTMLElement>(`.z-${k}`)?.getBoundingClientRect();
	const out: typeof connectors.value = [];
	const stacked = getComputedStyle(root).getPropertyValue('--bench-flow').trim() === 'column';
	if (stacked) {
		connectors.value = [];
		return;
	}
	for (const [a, b, label, dir] of LINKS) {
		const A = rect(a);
		const B = rect(b);
		if (!A || !B) continue;
		let x: number;
		let y: number;
		if (dir === 'r' || dir === 'l') {
			const left = dir === 'r' ? A : B;
			const right = dir === 'r' ? B : A;
			x = (left.right + right.left) / 2;
			const top = Math.max(A.top, B.top);
			const bottom = Math.min(A.bottom, B.bottom);
			y = top < bottom ? (top + bottom) / 2 : (A.top + B.top) / 2;
		} else {
			y = (A.bottom + B.top) / 2;
			x = (Math.max(A.left, B.left) + Math.min(A.right, B.right)) / 2;
		}
		out.push({ key: `${a}-${b}`, label, x: Math.round(x - host.left), y: Math.round(y - host.top), dir });
	}
	connectors.value = out;
}
let ro: ResizeObserver | null = null;

onMounted(() => {
	try {
		annotate.value = sessionStorage.getItem('lab-annotate') === '1';
	} catch {
		// Private mode: annotations start off.
	}
	if (stage.value && !props.readOnly) {
		stopDrag = createDrag({ root: stage.value, accepts, onDrop, onLift: () => closeMenu(false) });
		ro = new ResizeObserver(() => measure());
		ro.observe(stage.value);
	}
	if (stage.value && !ro) {
		ro = new ResizeObserver(() => measure());
		ro.observe(stage.value);
	}
	measure();
	void applyOutbox().then(syncOutbox);
	addEventListener('online', syncOutbox);
	syncTimer = setInterval(() => void syncOutbox(), 30_000);
	document.addEventListener('pointerdown', onDocDown, true);
	addEventListener('keydown', onKey);
	// Arriving from a link that names a move (?move=R-031): open its slip.
	if (props.move) {
		const r = rolls.value.find((x) => x.code === props.move!.toUpperCase());
		const to = r ? nextStage(r.status) : null;
		if (r && to) {
			if (to === 'scanned') openArrive([r]);
			else if (to === 'camera') openLoad(r.id);
			else openStep(r, to);
		}
	}
});
onBeforeUnmount(() => {
	removeEventListener('online', syncOutbox);
	clearInterval(syncTimer);
	stopDrag?.();
	ro?.disconnect();
	document.removeEventListener('pointerdown', onDocDown, true);
	removeEventListener('keydown', onKey);
});
watch(annotate, (on) => {
	try {
		sessionStorage.setItem('lab-annotate', on ? '1' : '0');
	} catch {
		// Fine.
	}
	void nextTick(measure);
});
function onKey(e: KeyboardEvent) {
	if (e.key === 'Escape' && menu.value) closeMenu();
	const t = e.target as HTMLElement;
	if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === 'a' || e.key === 'A') annotate.value = !annotate.value;
}

/* ---------- annotations: the service manual's numbered parts ---------- */

const legs = props.data.legs;
const spec = computed(() => ({
	fridge: groups.value.slice(0, FRIDGE_SHOWN).map((g) => ({
		key: g.key,
		text: `${g.front.stock.name}: ${g.list.length} on hand${g.forecast?.perMonth ? ` · you load ${g.forecast.perMonth}/mo · lasts ${g.forecast.monthsLeft != null ? formatMonths(g.forecast.monthsLeft) : '—'}` : ' · not loaded lately'}${g.late ? ` · ${g.late} won’t keep` : ''}`,
		warn: !!g.late || !!g.note?.expired,
	})),
	cameras: [
		...slots.value.loaded.map((s) => {
			const p = paces.value.get(s.roll.id);
			return { key: s.roll.id, text: `${s.camera.name}: ${s.roll.frameCount} of ${s.roll.exposures}, loaded ${formatDay(s.roll.statusOn, false)}${p ? ` · ${p.rate} · ${p.finish}` : ''}`, warn: !!p?.nudge };
		}),
		...slots.value.empty.map((c) => ({ key: c.id, text: `${c.name}: empty${c.lastOut ? ` ${daysBetween(c.lastOut, today)} days` : ''}${c.rolls ? ` · ${plural(c.rolls, 'roll')} so far` : ''}`, warn: false })),
	],
	shot: shot.value.map((r) => ({ key: r.id, text: `${r.code}: waiting ${plural(daysHere(r, today), 'day')}`, warn: daysHere(r, today) > (legs.waiting?.hi ?? 14) })),
	post: envelopes.value.map((e) => ({ key: e.key, text: `${e.lab}: ${e.readout}${e.window ? ` · back ${e.window.text}` : ''}`, warn: e.late })),
	table: scanned.value.map((r) => {
		const s = strips.value[r.id];
		return { key: r.id, text: `${r.code}: ${s ? `${s.count} scans, ${s.keepers} rated 4+` : 'scans not linked'} · in ${plural(daysHere(r, today), 'day')}`, warn: !s };
	}),
}));
const zoneNote = computed(() => ({
	fridge: storage.value.length ? `${plural(storage.value.length, 'roll')}${props.data.forecast.monthsOfFilm != null ? ` · ${formatMonths(props.data.forecast.monthsOfFilm)} of film` : ''}${fridgeValue.value ? ` · ${formatMoney(fridgeValue.value)}` : ''}` : '',
	cameras: legs.camera ? `A roll usually spends ${Math.round(legs.camera.median)} days in a camera` : '',
	shot: legs.waiting ? `You usually send within ${Math.round(legs.waiting.median)} days` : '',
	post: legs.lab ? `Labs usually take ${Math.round(legs.lab.median)} days` : '',
	table: legs.filing ? `Negatives usually filed ${Math.round(legs.filing.median)} days after scans` : '',
	binder: `${plural(filedCount.value, 'roll')} filed`,
}));
const balloon = (zone: keyof typeof spec.value, key: string) => {
	const i = spec.value[zone].findIndex((s) => s.key === key);
	return i === -1 ? null : i + 1;
};
const ticker = computed(() => [
	[counts.value.camera, 'in cameras'],
	[counts.value.shot, 'shot'],
	[counts.value.lab, 'at a lab'],
	[counts.value.scanned, 'scans in'],
	[counts.value.storage, 'in the fridge'],
	[counts.value.negatives, 'filed'],
] as const);
</script>

<template>
	<div class="bench-wrap" :class="{ annotate, 'read-only': readOnly }">
		<div ref="stage" class="bench" :class="{ empty: data.total === 0 }">
			<NegFilters :uses="negUses" />

			<header class="bench-head">
				<p class="ticker" aria-label="Where your film is">
					<span class="mat-name">The bench</span>
					<span v-for="[n, label] in ticker" :key="label" :class="{ zero: !n }">▸ {{ n }} {{ label }}</span>
					<span v-if="waitingMoves" class="waiting" role="status">● {{ waitingMoves }} waiting to sync</span>
				</p>
				<div class="tools">
					<button type="button" class="tool" :aria-pressed="annotate" aria-keyshortcuts="A" title="Annotate (A): numbers and readouts for everything on the bench" @click="annotate = !annotate">
						<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="3.2" /><path d="M9.5 9.5 15 15M15 15h5M7 5.8v2.4" /></svg>
						Annotate
					</button>
					<button v-if="storage.length && !readOnly" type="button" class="tool" @click="openLoad()">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5h5v2h-5zM7 5.5h8v15H7zM15 12h6m-3-3 3 3-3 3" /></svg>
						Load a roll
					</button>
				</div>
			</header>

			<!-- the verbs between stations, printed on the mat -->
			<span v-for="c in connectors" :key="c.key" class="link" :class="`to-${c.dir}`" :style="{ left: `${c.x}px`, top: `${c.y}px` }" aria-hidden="true">
				<i>{{ c.label }}</i>
			</span>

			<!-- 1 · Fridge -->
			<section class="zone z-fridge" data-drop-kind="fridge" aria-labelledby="z-fridge-h">
				<header class="z-head">
					<h2 id="z-fridge-h"><b>1</b> Fridge</h2>
					<span class="z-count">{{ counts.storage }}</span>
					<a class="z-open" href="/photography/lab/fridge/">Open<span class="sr-only"> the fridge</span> <span aria-hidden="true">↗</span></a>
				</header>
				<div class="z-body fridge">
					<span class="frost" aria-hidden="true"></span>
					<ul v-if="groups.length" class="shelf" role="list">
						<li v-for="g in groups.slice(0, FRIDGE_SHOWN)" :key="g.key" class="can-slot" :data-rolls="g.list.map((r) => r.id).join(' ')">
							<button
								type="button"
								class="obj can-btn"
								data-menu-host
								data-drag-kind="storage"
								:data-drag-id="g.front.id"
								:data-roll="g.front.id"
								:aria-label="`${g.front.stock.name}, ${plural(g.list.length, 'roll')}${g.note ? `, ${g.note.text}` : ''}. Oldest first: ${g.front.code}.`"
								@click="openMenu($event, [g.front.id])"
							>
								<RollCan :roll="g.front" :size="52" :tag="g.front.expires ? `exp ${formatExpiry(g.front.expires)}` : 'no date'" :tone="g.note?.expired || g.late ? 'warn' : g.note?.soon ? 'soon' : null" />
								<span v-if="g.list.length > 1" class="n">×{{ g.list.length }}</span>
								<span v-if="annotate && balloon('fridge', g.key)" class="balloon">{{ balloon('fridge', g.key) }}</span>
							</button>
						</li>
						<li v-if="groups.length > FRIDGE_SHOWN" class="more">
							<a href="/photography/lab/fridge/">+{{ groups.length - FRIDGE_SHOWN }} more</a>
						</li>
					</ul>
					<p v-else class="z-empty">
						The fridge is empty.
						<a class="lab-link" href="/photography/lab/fridge/">Add the film you have</a>.
					</p>
				</div>
				<footer v-if="annotate" class="spec">
					<p v-if="zoneNote.fridge" class="spec-note">{{ zoneNote.fridge }}</p>
					<ol>
						<li v-for="s in spec.fridge" :key="s.key" :class="{ warn: s.warn }">{{ s.text }}</li>
					</ol>
				</footer>
			</section>

			<!-- 2 · Cameras -->
			<section class="zone z-cameras" data-drop-kind="cameras" aria-labelledby="z-cameras-h">
				<header class="z-head">
					<h2 id="z-cameras-h"><b>2</b> Cameras</h2>
					<span class="z-count">{{ counts.camera }} loaded</span>
					<span v-if="!readOnly && share !== null && (loaded.length || share)" class="desk-share" :title="'Show what’s loaded on the film desk (from the next publish)'">
						<button id="share-loaded" type="button" class="switch" role="switch" :aria-checked="share" aria-labelledby="share-loaded-l" @click="toggleShare"></button>
						<span id="share-loaded-l">On the desk</span>
						<PublishButton v-if="shareChanged" quiet />
					</span>
					<a class="z-open" href="/photography/lab/gear/">Kit<span class="sr-only">: all your cameras and lenses</span> <span aria-hidden="true">↗</span></a>
				</header>
				<div class="z-body cameras">
					<div v-if="slots.loaded.length" class="cam-row">
						<article v-for="(s, i) in slots.loaded" :key="s.camera.id" class="cam-slot">
							<button
								type="button"
								class="obj cam-btn"
								data-menu-host
								data-drag-kind="camera"
								:data-drag-id="s.roll.id"
								:data-roll="s.roll.id"
								:aria-label="`${s.camera.name}: ${s.roll.stock.name}, ${s.roll.code}, ${s.roll.frameCount} of ${s.roll.exposures} frames`"
								@click="openMenu($event, [s.roll.id])"
							>
								<CameraTop :name="s.camera.name" :kind="s.camera.kind" :roll="s.roll" :delay="0.3 + i * 0.12" />
								<span v-if="annotate && balloon('cameras', s.roll.id)" class="balloon">{{ balloon('cameras', s.roll.id) }}</span>
							</button>
							<p class="cam-foot">
								<span class="pace" :title="paces.get(s.roll.id) ? `${paces.get(s.roll.id)!.rate} · ${paces.get(s.roll.id)!.finish}` : undefined">{{ paces.get(s.roll.id)?.finish ?? `loaded ${formatDay(s.roll.statusOn, false)}` }}</span>
								<span v-if="!readOnly" class="lab-actions">
									<a class="mini" :href="`/photography/lab/shoot/?roll=${s.roll.code}`">Log</a>
									<button type="button" class="mini" @click="openStep(s.roll, 'shot')">Finish</button>
								</span>
							</p>
						</article>
					</div>
					<div v-if="slots.empty.length" class="empties" :class="{ alone: !slots.loaded.length }">
						<ul role="list" :aria-label="slots.loaded.length ? 'Empty cameras' : 'Nothing loaded: drop a canister on a camera'">
							<li class="empties-label" aria-hidden="true">{{ slots.loaded.length ? 'Empty' : 'Nothing loaded · drop film on a camera' }}</li>
							<li v-for="c in slots.empty" :key="c.id">
								<button type="button" class="obj cam-empty" data-drop-kind="camera-slot" :data-drop-id="c.id" :disabled="readOnly || !storage.length" :title="storage.length ? `Load the ${c.name}` : 'No film in the fridge'" @click="openLoad(undefined, c.id)">
									<span class="glyph" aria-hidden="true"><i></i></span>
									<span class="nm">{{ c.name }}</span>
									<span v-if="annotate && balloon('cameras', c.id)" class="balloon">{{ balloon('cameras', c.id) }}</span>
								</button>
							</li>
						</ul>
					</div>
					<p v-if="!slots.loaded.length && !slots.empty.length" class="z-empty">
						No cameras yet. <a class="lab-link" href="/photography/lab/gear/">Add one to your kit</a>.
					</p>
				</div>
				<footer v-if="annotate" class="spec">
					<p v-if="zoneNote.cameras" class="spec-note">{{ zoneNote.cameras }}</p>
					<ol>
						<li v-for="s in spec.cameras" :key="s.key" :class="{ warn: s.warn }">{{ s.text }}</li>
					</ol>
				</footer>
			</section>

			<!-- 3 · Shot, waiting -->
			<section class="zone z-shot" data-drop-kind="shot" aria-labelledby="z-shot-h">
				<header class="z-head">
					<h2 id="z-shot-h"><b>3</b> Shot</h2>
					<span class="z-count">{{ counts.shot }} waiting</span>
				</header>
				<div class="z-body tray">
					<ul v-if="shot.length" class="loose" role="list">
						<li v-for="r in shot" :key="r.id">
							<button
								type="button"
								class="obj loose-btn"
								data-menu-host
								data-drag-kind="shot"
								:data-drag-id="r.id"
								:data-roll="r.id"
								:aria-label="`${r.code}, ${r.stock.name}, shot ${plural(daysHere(r, today), 'day')} ago`"
								@click="openMenu($event, [r.id])"
							>
								<RollCan :roll="r" :size="50" lying :tilt="tilt(r.id, 10)" :tag="`${daysHere(r, today)} d`" :tone="daysHere(r, today) > (legs.waiting?.hi ?? 14) ? 'warn' : null" />
								<span v-if="annotate && balloon('shot', r.id)" class="balloon">{{ balloon('shot', r.id) }}</span>
							</button>
						</li>
					</ul>
					<p v-else class="z-empty">Finished rolls land here, waiting for a lab.</p>
					<button v-if="shot.length && !readOnly" type="button" class="mini push" @click="openSend()">Send {{ shot.length > 1 ? 'a batch' : 'it' }}…</button>
				</div>
				<footer v-if="annotate" class="spec">
					<p v-if="zoneNote.shot" class="spec-note">{{ zoneNote.shot }}</p>
					<ol>
						<li v-for="s in spec.shot" :key="s.key" :class="{ warn: s.warn }">{{ s.text }}</li>
					</ol>
				</footer>
			</section>

			<!-- Today -->
			<div class="z-today">
				<TodayCard :nudges="data.total ? nudges : []" :today="today" :rewind="data.rewind" :read-only="readOnly" @act="act" />
				<ul v-if="data.rewind?.scans.length" class="rewind-prints" :aria-label="`${data.rewind.when}: ${data.rewind.title}`">
					<li v-for="(p, i) in data.rewind.scans" :key="p.src" :style="{ '--i': i }">
						<img :src="p.src" :width="p.w" :height="p.h" alt="" loading="lazy" decoding="async" />
					</li>
				</ul>
				<div v-if="data.total === 0 && !readOnly" class="first-run">
					<template v-if="data.choices.deskRolls.length">
						<p>Your bench is empty. Start with the {{ data.choices.deskRolls.length }} rolls already on the film desk: each lands in the binder, linked to its scans, with its camera, film and lab.</p>
						<ImportDesk :count="data.choices.deskRolls.length" />
					</template>
					<p v-else>
						Your bench is empty. Add your cameras to the <a class="lab-link" href="/photography/lab/gear/">kit</a> and your film to the
						<a class="lab-link" href="/photography/lab/fridge/">fridge</a>; every roll gets a code to follow round the bench.
					</p>
				</div>
			</div>

			<!-- 4 · Post -->
			<section class="zone z-post" data-drop-kind="post" aria-labelledby="z-post-h">
				<header class="z-head">
					<h2 id="z-post-h"><b>4</b> At the lab</h2>
					<span class="z-count">{{ counts.lab }}</span>
					<a class="z-open" href="/photography/lab/labs/">Post<span class="sr-only">: labs and envelopes</span> <span aria-hidden="true">↗</span></a>
				</header>
				<div class="z-body post">
					<ul v-if="envelopes.length" class="rack" role="list">
						<li v-for="e in envelopes" :key="e.key">
							<button
								type="button"
								class="obj env-btn"
								data-menu-host
								data-drag-kind="envelope"
								:data-drag-id="e.key"
								:data-rolls="e.rolls.map((r) => r.id).join(' ')"
								:aria-label="`At ${e.lab} since ${formatDay(e.sentOn, false)}: ${e.rolls.map((r) => r.code).join(', ')}. ${e.readout}`"
								@click="openMenu($event, e.rolls.map((r) => r.id))"
							>
								<Envelope :lab="e.lab" :codes="e.rolls.map((r) => r.code)" :sent-on="e.sentOn" :delivery="e.delivery" :order="e.order" :readout="e.readout" :progress="e.progress" :late="e.late" :tilt="tilt(e.key, 1.6)" />
								<span v-if="annotate && balloon('post', e.key)" class="balloon">{{ balloon('post', e.key) }}</span>
							</button>
						</li>
					</ul>
					<ul v-if="shot.length && outgoing.length && !readOnly" class="outgoing" role="list" :aria-label="'Blank envelopes: drop shot film on one to send it'">
						<li v-for="l in outgoing" :key="l.id">
							<button type="button" class="obj out-btn" data-drop-kind="post-lab" :data-drop-id="l.id" @click="openSend(undefined, l.id)">
								<Envelope :lab="l.name" :codes="[]" :sent-on="today" blank />
							</button>
						</li>
					</ul>
					<p v-if="!envelopes.length && !shot.length" class="z-empty">Nothing at a lab.</p>
				</div>
				<footer v-if="annotate" class="spec">
					<p v-if="zoneNote.post" class="spec-note">{{ zoneNote.post }}</p>
					<ol>
						<li v-for="s in spec.post" :key="s.key" :class="{ warn: s.warn }">{{ s.text }}</li>
					</ol>
				</footer>
			</section>

			<!-- 5 · Light table -->
			<section class="zone z-table" data-drop-kind="table" aria-labelledby="z-table-h">
				<header class="z-head">
					<h2 id="z-table-h"><b>5</b> Light table</h2>
					<span class="z-count">{{ counts.scanned }} scans in</span>
				</header>
				<div class="z-body table lab-lightbox">
					<ul v-if="scanned.length" class="strips" role="list">
						<li v-for="r in scanned" :key="r.id">
							<button
								type="button"
								class="obj strip-btn"
								data-menu-host
								data-drag-kind="scanned"
								:data-drag-id="r.id"
								:data-roll="r.id"
								:aria-label="`${r.code}, ${r.title ?? r.stock.name}: scans in ${formatDay(r.statusOn, false)}`"
								@click="openMenu($event, [r.id])"
							>
								<NegStrip
									:code="r.code"
									:stock="r.stock.name"
									:profile="strips[r.id]?.profile ?? null"
									:scans="strips[r.id]?.scans ?? null"
									:frames="6"
									lit
								/>
								<span class="strip-title">{{ r.title ?? r.stock.name }}</span>
								<span v-if="annotate && balloon('table', r.id)" class="balloon">{{ balloon('table', r.id) }}</span>
							</button>
						</li>
					</ul>
					<p v-else class="z-empty">Scans that come in light up here.</p>
				</div>
				<footer v-if="annotate" class="spec">
					<p v-if="zoneNote.table" class="spec-note">{{ zoneNote.table }}</p>
					<ol>
						<li v-for="s in spec.table" :key="s.key" :class="{ warn: s.warn }">{{ s.text }}</li>
					</ol>
				</footer>
			</section>

			<!-- 6 · Binder -->
			<section class="zone z-binder" data-drop-kind="binder" aria-labelledby="z-binder-h">
				<header class="z-head">
					<h2 id="z-binder-h"><b>6</b> Binder</h2>
					<span class="z-count">{{ counts.negatives }}</span>
					<a class="z-open" href="/photography/lab/rolls/">Open<span class="sr-only"> the binder</span> <span aria-hidden="true">↗</span></a>
				</header>
				<div class="z-body binder-body">
					<a class="binder-link" href="/photography/lab/rolls/" :aria-label="`The binder: ${plural(counts.negatives, 'roll')} filed`">
						<BinderSpine :count="counts.negatives" :recent="recentFiled.map((r) => ({ id: r.id, code: r.code, color: can(r).can }))" />
					</a>
					<p v-if="recentFiled[0]" class="last">Last filed: <a class="lab-code" :href="`/photography/lab/rolls/${recentFiled[0].code}/`">{{ recentFiled[0].code }}</a> {{ recentFiled[0].title ?? recentFiled[0].stock.name }}</p>
				</div>
				<footer v-if="annotate" class="spec">
					<p class="spec-note">{{ zoneNote.binder }}</p>
				</footer>
			</section>

			<!-- the menu a tapped object opens -->
			<div
				v-if="menu && menuRolls.length"
				ref="menuEl"
				class="obj-menu"
				:class="{ up: menu.flip }"
				:style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
				role="menu"
				:aria-label="menuRolls.map((r) => r.code).join(', ')"
			>
				<template v-for="r in menuRolls" :key="r.id">
					<p class="m-head">
						<span class="lab-code">{{ r.code }}</span>
						<span>{{ r.title ?? r.stock.name }}</span>
					</p>
					<template v-if="readOnly"></template>
					<template v-else-if="r.status === 'storage'">
						<button type="button" role="menuitem" @click="openLoad(r.id)">Load into a camera</button>
					</template>
					<template v-else-if="r.status === 'camera'">
						<a role="menuitem" :href="`/photography/lab/shoot/?roll=${r.code}`">Log frames</a>
						<button type="button" role="menuitem" @click="openStep(r, 'shot')">Roll finished</button>
					</template>
					<template v-else-if="r.status === 'shot'">
						<button type="button" role="menuitem" @click="openSend([r.id])">Send to a lab…</button>
					</template>
					<template v-else-if="r.status === 'lab' && menuRolls.length === 1">
						<button type="button" role="menuitem" @click="openArrive([r])">Scans arrived</button>
					</template>
					<template v-else-if="r.status === 'scanned'">
						<a v-if="!r.publicRollId && data.owner" role="menuitem" :href="`/photography/lab/rolls/${r.code}/#scans`">Link its scans</a>
						<button type="button" role="menuitem" @click="openStep(r, 'negatives')">{{ stepVerb('negatives', r.labDelivery) }}</button>
					</template>
					<a role="menuitem" class="quiet" :href="`/photography/lab/rolls/${r.code}/`">Open {{ r.code }}</a>
				</template>
				<button v-if="!readOnly && menuRolls.length > 1 && menuRolls[0].status === 'lab'" type="button" role="menuitem" @click="openArrive(menuRolls)">Scans arrived for these</button>
			</div>
		</div>

		<LabDialog :open="!!slip" :title="slipTitle" @close="slip = null">
			<template v-if="slip?.kind === 'step'">
				<StepForm
					:key="`${slip.roll.id}-${slip.to}`"
					:roll="slip.roll"
					:to="slip.to"
					:choices="data.choices"
					:today="today"
					:binder-hints="data.binderHints"
					:preset="slip.preset"
					@done="done"
					@cancel="slip = null"
				/>
			</template>
			<template v-else-if="slip?.kind === 'send'">
				<SendSlip :shot="shot" :labs="data.choices.labs" :turnaround="turnaround" :today="today" :preset="{ labId: slip.labId, rollIds: slip.rollIds }" @done="done" @cancel="slip = null" />
			</template>
			<template v-else-if="slip?.kind === 'arrive'">
				<ArriveSlip :rolls="slip.rolls" :today="today" @done="done" @cancel="slip = null" />
			</template>
			<template v-else-if="slip?.kind === 'load'">
				<label class="lab-field">
					<span>Which roll</span>
					<select id="load-roll" v-model="loadId" class="lab-input lab-select">
						<option value="" disabled>Choose from the fridge</option>
						<optgroup v-for="g in groups" :key="g.key" :label="g.front.stock.name">
							<option v-for="r in g.list" :key="r.id" :value="r.id">{{ r.code }}{{ r.expires ? ` · exp ${r.expires.slice(5)}/${r.expires.slice(2, 4)}` : '' }}{{ r.storageSpot ? ` · ${r.storageSpot}` : '' }}</option>
						</optgroup>
					</select>
					<small class="lab-hint">Oldest dates first within each film.</small>
				</label>
				<StepForm v-if="loadRoll" :key="`${loadRoll.id}-load`" :roll="loadRoll" to="camera" :choices="data.choices" :today="today" :preset="{ cameraId: slip.cameraId ?? suggestCamera(loadRoll) }" @done="done" @cancel="slip = null" />
			</template>
		</LabDialog>

		<div v-if="toast" class="toast" role="status">
			<span>{{ toast.text }}</span>
			<button v-if="toast.undo" type="button" class="lab-link" @click="undo(toast.undo)">Undo</button>
		</div>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
	</div>
</template>

<style scoped>
.bench-wrap {
	display: grid;
}

/* Printed along the mat's top edge: where everything is, and the tools. */
.bench-head {
	grid-area: head;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.4rem 1rem;
	margin: -0.35rem 0 -0.4rem;
}

.ticker {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.15rem 0.95rem;
	font-family: var(--font-mono);
	font-size: 0.64rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.ticker .mat-name {
	font-family: var(--font-brand);
	font-style: italic;
	font-size: 1.05rem;
	font-weight: 420;
	letter-spacing: 0;
	text-transform: none;
	font-variation-settings: 'opsz' 60, 'SOFT' 60, 'WONK' 1;
	color: var(--gray-0);
	margin-right: 0.3rem;
}

.ticker .zero {
	opacity: 0.45;
}

.ticker .waiting {
	color: var(--lab-warn);
}

.tools {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.tool {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-height: 2.2rem;
	padding: 0.2rem 0.85rem 0.2rem 0.65rem;
	border: 1px solid color-mix(in oklch, var(--lab-bench-ink) 35%, transparent);
	border-radius: 999px;
	background: color-mix(in oklch, var(--lab-bench) 80%, transparent);
	color: var(--gray-0);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.tool svg {
	width: 1.05rem;
	height: 1.05rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.tool[aria-pressed='true'] {
	border-color: var(--lab-note);
	background: color-mix(in oklch, var(--lab-note) 12%, var(--lab-bench));
	color: var(--lab-note);
}

.tool:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

/* ---------- the mat ---------- */
.bench {
	/* Phones and small windows: the loop as a column, Today first. */
	--bench-flow: column;
	--gap: clamp(1.5rem, 2.6vw, 2.6rem);
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	grid-template-areas: 'head' 'today' 'cameras' 'shot' 'post' 'table' 'fridge' 'binder';
	gap: 1.4rem;
	padding: 1rem 1rem 1.4rem;
	border-radius: 1.1rem;
	/* A cutting mat: a fine centimetre grid, a heavier line every five, ruler ticks along two edges. */
	background:
		repeating-linear-gradient(90deg, var(--lab-bench-rule) 0 1px, transparent 1px 0.5rem) 1.1rem 0 / calc(100% - 2.2rem) 0.45rem no-repeat,
		repeating-linear-gradient(180deg, var(--lab-bench-rule) 0 1px, transparent 1px 0.5rem) 0 1.1rem / 0.45rem calc(100% - 2.2rem) no-repeat,
		linear-gradient(var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 100% 2.5rem,
		linear-gradient(90deg, var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 2.5rem 100%,
		linear-gradient(var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 100% 12.5rem,
		linear-gradient(90deg, var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 12.5rem 100%,
		radial-gradient(120% 90% at var(--lab-lamp-x) var(--lab-lamp-y), color-mix(in oklch, var(--lab-bench) 60%, white), var(--lab-bench) 55%, var(--lab-bench-deep));
	box-shadow:
		inset 0 0 0 1px color-mix(in oklch, var(--lab-bench-rule) 60%, transparent),
		inset 0 2px 0 oklch(100% 0 0 / 0.35),
		0 30px 60px -40px oklch(20% 0.02 60 / 0.5);
}

:root.theme-dark .bench {
	background:
		repeating-linear-gradient(90deg, var(--lab-bench-rule) 0 1px, transparent 1px 0.5rem) 1.1rem 0 / calc(100% - 2.2rem) 0.45rem no-repeat,
		repeating-linear-gradient(180deg, var(--lab-bench-rule) 0 1px, transparent 1px 0.5rem) 0 1.1rem / 0.45rem calc(100% - 2.2rem) no-repeat,
		linear-gradient(var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 100% 2.5rem,
		linear-gradient(90deg, var(--lab-bench-grid) 1px, transparent 1px) 0 0 / 2.5rem 100%,
		radial-gradient(110% 90% at var(--lab-lamp-x) var(--lab-lamp-y), oklch(30% 0.06 35), var(--lab-bench) 55%, var(--lab-bench-deep));
	box-shadow:
		inset 0 0 0 1px oklch(40% 0.03 40 / 0.4),
		0 30px 60px -30px rgb(0 0 0 / 0.8);
}

.z-fridge {
	grid-area: fridge;
}
.z-cameras {
	grid-area: cameras;
}
.z-shot {
	grid-area: shot;
}
.z-today {
	grid-area: today;
}
.z-post {
	grid-area: post;
}
.z-table {
	grid-area: table;
}
.z-binder {
	grid-area: binder;
}

/* ---------- a station on the mat ---------- */
.zone {
	position: relative;
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	gap: 0.45rem;
	min-width: 0;
	min-height: 0;
	border-radius: 0.8rem;
	transition:
		box-shadow 0.2s ease,
		background-color 0.2s ease;
}

.z-head {
	display: flex;
	align-items: baseline;
	gap: 0.6rem;
	min-width: 0;
}

.z-head h2 {
	display: flex;
	align-items: baseline;
	gap: 0.45rem;
	font-family: var(--font-mono);
	font-size: 0.72rem;
	font-weight: 500;
	letter-spacing: 0.16em;
	font-variant-caps: all-small-caps;
	font-size: 0.86rem;
	color: var(--lab-bench-ink);
	white-space: nowrap;
}

.z-head h2 b {
	display: grid;
	place-items: center;
	width: 1.15rem;
	height: 1.15rem;
	border-radius: 50%;
	background: var(--lab-bench-ink);
	color: var(--lab-bench);
	font-size: 0.6rem;
	font-weight: 600;
	letter-spacing: 0;
}

.z-count {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--lab-edge-text);
	white-space: nowrap;
}

.z-open {
	margin-left: auto;
	font-family: var(--font-mono);
	font-size: 0.68rem;
	letter-spacing: 0.08em;
	color: var(--lab-bench-ink);
	text-decoration: none;
	white-space: nowrap;
	padding: 0.25rem 0.1rem;
}

.z-open:hover {
	color: var(--gray-0);
	text-decoration: underline;
}

.z-body {
	position: relative;
	min-height: 0;
	min-width: 0;
	overflow: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
}

.z-empty {
	display: grid;
	place-items: center;
	align-content: center;
	gap: 0.3rem;
	min-height: 5rem;
	padding: 0.75rem;
	border: 1.5px dashed color-mix(in oklch, var(--lab-bench-ink) 35%, transparent);
	border-radius: 0.6rem;
	color: var(--lab-bench-ink);
	font-size: var(--text-sm);
	text-align: center;
	text-wrap: balance;
}

/* Where something held can go: the place lifts its edge and glows. */
.zone[data-drop-ready],
[data-drop-ready].obj {
	box-shadow: 0 0 0 2px color-mix(in oklch, var(--lab-note) 45%, transparent);
	background-color: color-mix(in oklch, var(--lab-note) 5%, transparent);
}

.zone[data-drop-over],
[data-drop-over].obj {
	box-shadow:
		0 0 0 2px var(--lab-note),
		0 0 28px -6px color-mix(in oklch, var(--lab-note) 60%, transparent);
	background-color: color-mix(in oklch, var(--lab-note) 10%, transparent);
}

/* ---------- objects: lift when touched, pick up when dragged ---------- */
.obj {
	position: relative;
	display: block;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: inherit;
	cursor: grab;
	touch-action: auto;
	-webkit-touch-callout: none;
	-webkit-user-select: none;
	user-select: none;
	transition:
		translate 0.3s cubic-bezier(0.22, 1, 0.36, 1),
		filter 0.3s ease,
		opacity 0.2s ease;
}

.obj:disabled {
	cursor: default;
}

@media (hover: hover) {
	.obj:not(:disabled):hover {
		translate: 1px -3px;
		filter: drop-shadow(-4px 6px 6px oklch(20% 0.02 60 / 0.18));
	}
}

.obj:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 4px;
	border-radius: 0.4rem;
}

.obj.is-lifted {
	opacity: 0.3;
	filter: grayscale(0.4);
}

:global(html.lab-dragging),
:global(html.lab-dragging *) {
	cursor: grabbing !important;
}

/* A guest can pick nothing up: objects open their menu (to the roll's page), no more. */
.read-only .obj {
	cursor: pointer;
}

.read-only .cam-empty {
	cursor: default;
	opacity: 1;
}

/* ---------- 1 · fridge: cold, lit from the top ---------- */
.fridge {
	display: grid;
	align-content: start;
	padding: 0.9rem 0.7rem 0.6rem;
	border-radius: 0.6rem;
	background:
		linear-gradient(180deg, oklch(98% 0.012 230), oklch(93% 0.02 230) 70%, oklch(90% 0.022 230));
	box-shadow:
		inset 0 0 0 1px oklch(85% 0.02 230),
		inset 0 10px 22px -12px oklch(100% 0 0),
		var(--lab-lift-0);
	overflow: hidden;
}

:root.theme-dark .fridge {
	background: linear-gradient(180deg, oklch(30% 0.03 230), oklch(22% 0.025 230) 70%, oklch(19% 0.02 230));
	box-shadow:
		inset 0 0 0 1px oklch(38% 0.03 230),
		inset 0 10px 22px -12px oklch(60% 0.05 230 / 0.6),
		var(--lab-lift-0);
}

.frost {
	position: absolute;
	inset: 0 0 auto;
	height: 2.4rem;
	background: radial-gradient(70% 100% at 50% 0%, oklch(100% 0 0 / 0.8), transparent 70%);
	pointer-events: none;
}

:root.theme-dark .frost {
	background: radial-gradient(70% 100% at 50% 0%, oklch(80% 0.05 230 / 0.35), transparent 70%);
}

.shelf {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(3.8rem, 1fr));
	align-items: end;
	gap: 0.8rem 0;
	margin: 0;
	padding: 0;
	list-style: none;
}

/* Each canister stands on a wire shelf; side by side, the wires join up. */
.can-slot {
	display: grid;
	justify-items: center;
	padding: 0 0.15rem 0.25rem;
	border-bottom: 2px solid oklch(72% 0.012 230 / 0.75);
	box-shadow: 0 3px 0 -1px oklch(60% 0.01 230 / 0.25);
}

:root.theme-dark .can-slot {
	border-bottom-color: oklch(50% 0.015 230 / 0.8);
}

.can-btn {
	display: grid;
	justify-items: center;
	padding: 0.2rem;
}

.can-btn .n {
	position: absolute;
	top: 0;
	right: 0.15rem;
	font-family: var(--font-mono);
	font-size: 0.66rem;
	font-weight: 600;
	color: oklch(35% 0.04 240);
}

:root.theme-dark .can-btn .n {
	color: oklch(85% 0.04 240);
}

.more {
	display: grid;
	place-items: center;
	min-height: 5rem;
	font-family: var(--font-mono);
	font-size: 0.7rem;
}

.more a {
	color: var(--gray-200);
}

/* ---------- 2 · cameras ---------- */
.cameras {
	display: grid;
	align-content: start;
	gap: 0.9rem;
}

.cam-row {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(12.5rem, 1fr);
	gap: 1rem;
	overflow-x: auto;
	padding: 0.35rem 0.35rem 0.2rem;
	margin: -0.35rem -0.35rem 0;
	scrollbar-width: thin;
}

.cam-slot {
	display: grid;
	gap: 0.35rem;
	min-width: 0;
}

.cam-btn {
	width: 100%;
}

.cam-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.3rem 0.6rem;
	padding-inline: 0.2rem;
}

.pace {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--lab-edge-text);
}

.mini {
	display: inline-flex;
	align-items: center;
	min-height: 2rem;
	padding: 0.15rem 0.7rem;
	border: 1px solid var(--gray-700);
	border-radius: 999px;
	background: color-mix(in oklch, var(--lab-bench) 70%, transparent);
	color: var(--gray-0);
	font: inherit;
	font-size: 0.78rem;
	text-decoration: none;
	cursor: pointer;
}

.mini:hover {
	background: var(--gray-0);
	color: var(--gray-999);
}

.mini:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.mini.push {
	justify-self: end;
}

.empties ul {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	margin: 0;
	padding: 0.15rem 0.1rem 0.3rem;
	list-style: none;
	overflow-x: auto;
	scrollbar-width: thin;
}

.empties.alone ul {
	flex-wrap: wrap;
}

.empties-label {
	flex: none;
	font-family: var(--font-mono);
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	font-size: 0.76rem;
	color: var(--lab-bench-ink);
	white-space: nowrap;
}

.empties li {
	flex: none;
}

/* An empty camera: a small body with its back open, waiting for film. */
.cam-empty {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-height: 2.3rem;
	padding: 0.2rem 0.6rem 0.2rem 0.3rem;
	border-radius: 0.55rem;
	background: linear-gradient(180deg, oklch(26% 0.006 60), oklch(19% 0.006 60));
	color: oklch(90% 0.01 80);
	box-shadow: var(--lab-lift-0);
	cursor: pointer;
}

.cam-empty:disabled {
	opacity: 0.6;
}

.glyph {
	position: relative;
	width: 1.6rem;
	height: 1.15rem;
	border-radius: 0.25rem;
	background: linear-gradient(180deg, oklch(80% 0.004 80), oklch(62% 0.006 80));
}

.glyph i {
	position: absolute;
	inset: 0.24rem 0.35rem;
	border-radius: 2px;
	background: oklch(14% 0.004 60);
	box-shadow: inset 0 0 0 1px oklch(40% 0.006 60);
}

.nm {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.04em;
	white-space: nowrap;
}

.desk-share {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	margin-left: auto;
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--lab-bench-ink);
	white-space: nowrap;
}

.desk-share + .z-open {
	margin-left: 0.4rem;
}

.switch {
	position: relative;
	flex: none;
	width: 2.3rem;
	height: 1.35rem;
	border: 0;
	border-radius: 999px;
	background: var(--gray-700);
	cursor: pointer;
}

.switch::after {
	content: '';
	position: absolute;
	top: 0.2rem;
	left: 0.2rem;
	width: 0.95rem;
	height: 0.95rem;
	border-radius: 50%;
	background: var(--gray-999);
	transition: translate 0.15s ease;
}

.switch[aria-checked='true'] {
	background: var(--accent-regular);
}

.switch[aria-checked='true']::after {
	translate: 0.95rem 0;
	background: var(--accent-text-over);
}

.switch:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

/* ---------- 3 · shot: a shallow tray of loose canisters ---------- */
.tray {
	display: grid;
	align-content: start;
	gap: 0.6rem;
	padding: 0.7rem;
	border-radius: 0.6rem;
	background:
		radial-gradient(90% 70% at 50% 40%, color-mix(in oklch, var(--lab-bench-deep) 60%, transparent), transparent),
		var(--lab-bench-deep);
	box-shadow:
		inset 2px -3px 6px oklch(100% 0 0 / 0.25),
		inset -3px 5px 10px oklch(20% 0.02 60 / 0.22);
}

:root.theme-dark .tray {
	box-shadow:
		inset 2px -3px 6px oklch(100% 0 0 / 0.05),
		inset -3px 5px 12px rgb(0 0 0 / 0.6);
}

.loose {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem 0.9rem;
	margin: 0;
	padding: 0.4rem 0.2rem;
	list-style: none;
}

.loose-btn {
	padding: 0.35rem 0.5rem;
}

/* ---------- 4 · post: envelopes in a rack ---------- */
.post {
	display: grid;
	align-content: start;
	gap: 0.85rem;
}

.rack,
.outgoing {
	display: grid;
	gap: 0.55rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.outgoing {
	grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
	padding-top: 0.7rem;
	border-top: 1px dashed color-mix(in oklch, var(--lab-bench-ink) 30%, transparent);
}

.env-btn,
.out-btn {
	width: 100%;
}

.out-btn {
	cursor: pointer;
	opacity: 0.85;
}

/* ---------- 5 · light table ---------- */
.table {
	display: grid;
	align-content: start;
	padding: 1.3rem 1.1rem 1rem;
	overflow: auto;
}

.strips {
	display: grid;
	gap: 1.5rem;
	margin: 0;
	padding: 0.4rem 0 0;
	list-style: none;
}

.strip-btn {
	display: grid;
	gap: 0.35rem;
	width: 100%;
}

.strip-title {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--gray-200);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* ---------- 6 · binder ---------- */
.binder-body {
	display: grid;
	align-content: start;
	justify-items: center;
	gap: 0.6rem;
}

.binder-link {
	display: block;
	width: 100%;
	max-width: 13rem;
	text-decoration: none;
	color: inherit;
}

.binder-link:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 4px;
	border-radius: 0.4rem;
}

.last {
	font-size: var(--text-sm);
	color: var(--gray-200);
	text-align: center;
	text-wrap: balance;
}

/* ---------- today ---------- */
.z-today {
	display: grid;
	gap: 1rem;
	width: 100%;
	z-index: 2;
	min-height: 0;
}

/* Under the card: prints from the archive, dropped on the mat. */
.rewind-prints {
	position: relative;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 0.6rem;
	max-width: 30rem;
	margin: 0;
	padding: 0.4rem 0.4rem 0;
	list-style: none;
}

.rewind-prints li {
	padding: 0.3rem 0.3rem 0.9rem;
	background: oklch(98.5% 0.006 85);
	box-shadow: var(--lab-lift-0);
	rotate: calc((var(--i) - 1.5) * 1.8deg);
}

.rewind-prints img {
	display: block;
	width: 100%;
	height: auto;
	aspect-ratio: 3 / 2;
	object-fit: cover;
}

.first-run {
	display: grid;
	gap: 0.6rem;
	padding: 0.9rem 1rem;
	border-radius: 0.6rem;
	background: var(--lab-card);
	box-shadow: var(--lab-lift-0);
}

/* ---------- the verbs between stations ---------- */
.link {
	position: absolute;
	z-index: 1;
	translate: -50% -50%;
	display: grid;
	place-items: center;
	pointer-events: none;
}

.link i {
	font-family: var(--font-mono);
	font-size: 0.6rem;
	font-style: normal;
	letter-spacing: 0.18em;
	font-variant-caps: all-small-caps;
	font-size: 0.74rem;
	color: color-mix(in oklch, var(--lab-bench-ink) 75%, transparent);
	white-space: nowrap;
}

.link::after {
	content: '';
	display: block;
	width: 1.4rem;
	height: 0.55rem;
	background:
		linear-gradient(currentColor, currentColor) 0 50% / calc(100% - 0.35rem) 1px no-repeat,
		conic-gradient(from -135deg at 100% 50%, currentColor 90deg, transparent 0) 100% 50% / 0.4rem 0.55rem no-repeat;
	color: color-mix(in oklch, var(--lab-bench-ink) 60%, transparent);
}

.link.to-r i,
.link.to-l i {
	writing-mode: vertical-rl;
	padding-bottom: 0.3rem;
}

.link.to-l::after {
	rotate: 180deg;
}

.link.to-d::after {
	rotate: 90deg;
	margin-top: 0.4rem;
}

.link.to-d {
	grid-auto-flow: column;
	gap: 0.3rem;
}

.link.to-d::after {
	margin: 0;
}

/* ---------- annotations ---------- */
.balloon {
	position: absolute;
	top: -0.55rem;
	right: -0.55rem;
	z-index: 3;
	display: grid;
	place-items: center;
	width: 1.35rem;
	height: 1.35rem;
	border: 1.5px solid var(--lab-note);
	border-radius: 50%;
	background: var(--lab-card);
	color: var(--lab-note);
	font-family: var(--font-mono);
	font-size: 0.64rem;
	font-weight: 600;
	pointer-events: none;
}

.spec {
	display: grid;
	align-content: start;
	gap: 0.3rem;
	max-height: min(10.5rem, 52%);
	overflow: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
	padding: 0.55rem 0.7rem 0.6rem;
	border: 1px solid color-mix(in oklch, var(--lab-note) 35%, transparent);
	border-radius: 0.45rem;
	background: color-mix(in oklch, var(--lab-card) 88%, transparent);
	color: var(--lab-note);
	font-family: var(--font-mono);
	font-size: 0.66rem;
	line-height: 1.45;
}

.spec ol {
	display: grid;
	gap: 0.15rem;
	margin: 0;
	padding-left: 1.35rem;
}

.spec li::marker {
	font-weight: 600;
}

.spec li.warn {
	color: var(--lab-warn);
}

.spec-note {
	font-style: italic;
	color: color-mix(in oklch, var(--lab-note) 80%, var(--gray-0));
}

@media (prefers-reduced-motion: no-preference) {
	.annotate .balloon {
		animation: balloon-in 0.35s cubic-bezier(0.3, 1.4, 0.5, 1) both;
	}

	.annotate .spec {
		animation: spec-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
		transform-origin: top;
	}

	.annotate .spec li {
		animation: spec-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.annotate .spec li:nth-child(2) {
		animation-delay: 0.05s;
	}

	.annotate .spec li:nth-child(3) {
		animation-delay: 0.1s;
	}

	.annotate .spec li:nth-child(n + 4) {
		animation-delay: 0.15s;
	}

	@keyframes balloon-in {
		from {
			scale: 0.2;
			opacity: 0;
		}
	}

	@keyframes spec-in {
		from {
			opacity: 0;
			translate: 0 -6px;
		}
	}
}

/* ---------- the menu a tapped object opens ---------- */
.obj-menu {
	position: absolute;
	z-index: 30;
	translate: -50% 0.5rem;
	display: grid;
	min-width: 14rem;
	max-width: 18rem;
	padding: 0.35rem;
	border-radius: 0.6rem;
	background: var(--lab-card);
	box-shadow:
		0 0 0 1px var(--gray-800),
		var(--lab-lift-2);
}

.obj-menu.up {
	translate: -50% calc(-100% - 0.5rem);
}

.m-head {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
	padding: 0.45rem 0.6rem 0.3rem;
	font-size: var(--text-sm);
	color: var(--gray-200);
	overflow: hidden;
}

.m-head span:last-child {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.obj-menu [role='menuitem'] {
	display: flex;
	align-items: center;
	min-height: 2.6rem;
	padding: 0.3rem 0.6rem;
	border: 0;
	border-radius: 0.4rem;
	background: none;
	color: var(--gray-0);
	font: inherit;
	font-size: var(--text-base);
	text-align: left;
	text-decoration: none;
	cursor: pointer;
}

.obj-menu [role='menuitem']:hover,
.obj-menu [role='menuitem']:focus-visible {
	background: var(--gray-900);
	outline: none;
}

.obj-menu .quiet {
	color: var(--gray-200);
	font-size: var(--text-sm);
}

@media (prefers-reduced-motion: no-preference) {
	.obj-menu {
		animation: menu-in 0.18s ease-out both;
	}

	@keyframes menu-in {
		from {
			opacity: 0;
			scale: 0.96;
		}
	}
}

/* ---------- toast ---------- */
.toast {
	position: fixed;
	left: 50%;
	bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px));
	z-index: 50;
	translate: -50% 0;
	display: flex;
	align-items: center;
	gap: 1rem;
	max-width: calc(100vw - 2rem);
	padding: 0.7rem 1.1rem;
	border-radius: 999px;
	background: var(--gray-0);
	color: var(--gray-999);
	box-shadow: var(--lab-lift-2);
	font-size: var(--text-sm);
}

.toast .lab-link {
	color: inherit;
	text-decoration-color: currentColor;
}

/* ---------- arrivals: what each station does when a roll lands ---------- */
@media (prefers-reduced-motion: no-preference) {
	/* Loaded: the back shuts with a little bounce. */
	:global(.arrive-load) {
		animation: arrive-load 0.6s cubic-bezier(0.3, 1.5, 0.5, 1);
	}

	@keyframes arrive-load {
		0% {
			scale: 1.04;
		}
		35% {
			scale: 0.985;
		}
	}

	/* Dropped in the tray: it rolls to a stop. */
	:global(.arrive-drop) {
		animation: arrive-drop 0.7s cubic-bezier(0.3, 1.4, 0.5, 1);
	}

	@keyframes arrive-drop {
		0% {
			translate: 0 -10px;
		}
		40% {
			translate: 0 2px;
		}
	}

	/* Posted: the postmark strikes. */
	:global(.arrive-post .postmark) {
		animation: strike 0.5s 0.05s cubic-bezier(0.2, 1.6, 0.4, 1) both;
	}

	@keyframes strike {
		from {
			scale: 2.2;
			opacity: 0;
		}
	}

	/* Scans in: the strip lights up on the table. */
	:global(.arrive-lit) {
		animation: arrive-lit 1.2s ease-out;
	}

	@keyframes arrive-lit {
		0% {
			filter: brightness(2.2) saturate(0.4);
		}
		25% {
			filter: brightness(1.6);
		}
	}

	/* Filed: the sleeve slides down into the binder. */
	:global(.arrive-file) {
		animation: arrive-file 0.7s cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes arrive-file {
		from {
			translate: 0 -1.2rem;
		}
	}

	/* The bench settling as you come in: each station in the order a roll visits them. */
	:root.lab-bench-enter .zone,
	:root.lab-bench-enter .z-today {
		animation: settle 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	:root.lab-bench-enter .bench {
		animation: lamp 1.2s ease-out both;
	}

	:root.lab-bench-enter .z-fridge {
		animation-delay: 0.1s;
	}
	:root.lab-bench-enter .z-cameras {
		animation-delay: 0.18s;
	}
	:root.lab-bench-enter .z-shot {
		animation-delay: 0.26s;
	}
	:root.lab-bench-enter .z-post {
		animation-delay: 0.34s;
	}
	:root.lab-bench-enter .z-table {
		animation-delay: 0.42s;
	}
	:root.lab-bench-enter .z-binder {
		animation-delay: 0.5s;
	}
	:root.lab-bench-enter .z-today {
		animation-delay: 0.62s;
	}

	@keyframes settle {
		from {
			opacity: 0.001;
			translate: -6px 14px;
			scale: 0.985;
		}
	}

	@keyframes lamp {
		from {
			filter: brightness(0.6);
		}
		30% {
			filter: brightness(1.04);
		}
	}
}

/* ---------- tablets: two columns ---------- */
@media (min-width: 40em) {
	.bench {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-areas:
			'head head'
			'today today'
			'cameras cameras'
			'shot post'
			'table table'
			'fridge binder';
		padding: 1.25rem 1.4rem 1.6rem;
	}
}

/*
 * Wide screens: the whole loop on one screen, the way it really sits.
 *
 *   fridge → cameras → shot  │ today
 *   binder ← table   ← post  │
 */
@media (min-width: 75em) and (min-height: 42em) {
	.bench {
		--bench-flow: grid;
		grid-template-columns: minmax(12rem, 1fr) minmax(0, 2.05fr) minmax(12rem, 1fr) minmax(15rem, 1.05fr);
		grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas:
			'head head head head'
			'fridge cameras shot today'
			'binder table post today';
		gap: calc(var(--gap) * 0.75) var(--gap);
		/* One screen: from where the mat starts to the bottom edge (measured on mount), above the dock. */
		height: max(36rem, calc(100dvh - var(--bench-top, 15rem) - 0.9rem));
		padding: calc(var(--gap) * 0.75) calc(var(--gap) * 0.8) calc(var(--gap) * 0.5 + 4.4rem);
	}

	.rewind-prints {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.z-today {
		align-self: stretch;
		align-content: start;
		width: auto;
		/* Pinned to the side of the mat, a little apart. */
		padding-left: calc(var(--gap) * 0.6);
		border-left: 1px dashed color-mix(in oklch, var(--lab-bench-ink) 25%, transparent);
		overflow: auto;
		scrollbar-width: thin;
	}
}

@media (max-width: 30em) {
	.bench {
		margin-inline: -0.75rem;
		border-radius: 0.8rem;
	}
}
</style>
