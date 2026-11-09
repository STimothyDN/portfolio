<template>
	<div class="shoot" :class="{ safelight }">
		<header class="top">
			<a class="back" href="/photography/lab/">← Film Lab</a>
			<span class="sync" :class="syncTone" role="status">{{ syncText }}</span>
			<button type="button" class="icon-btn" :aria-pressed="safelight" title="Safelight: red on black, for shooting at night" @click="toggleSafelight">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3ZM9.5 20h5" /></svg>
				<span class="sr-only">Safelight</span>
			</button>
		</header>

		<template v-if="roll">
			<div v-if="rolls.length > 1" class="switcher" role="group" aria-label="Loaded cameras">
				<button v-for="r in rolls" :key="r.id" type="button" class="chip" :aria-pressed="r.id === roll.id" @click="select(r.id)">
					{{ r.camera?.name ?? r.code }}
				</button>
			</div>

			<section class="head">
				<div>
					<span class="edge">Shooting</span>
					<h1>{{ roll.camera?.name ?? 'Camera not recorded' }}</h1>
					<p class="sub">{{ [roll.stock.name, isoText].filter(Boolean).join(' · ') }}</p>
				</div>
				<a class="sticker" :href="`/photography/lab/rolls/${roll.code}/`">{{ roll.code }}</a>
			</section>

			<!-- The frame counter, like the window on the camera's top plate -->
			<section class="counter" aria-label="Frame counter">
				<button type="button" class="adj" aria-label="One frame back" @click="adjust(-1)">−</button>
				<div class="window" aria-live="polite">
					<!-- The counter rolls on like a mechanical one; logging a frame blinks the shutter. -->
					<Transition :name="rollDir">
						<div :key="next" class="digits">
							<span v-for="n in [next - 2, next - 1]" :key="`p${n}`" :class="{ far: n === next - 2 }">{{ n >= 0 ? n : '' }}</span>
							<b>{{ next }}</b>
							<span v-for="n in [next + 1, next + 2]" :key="`n${n}`" :class="{ far: n === next + 2 }">{{ n }}</span>
						</div>
					</Transition>
					<span v-if="shutterKey" :key="shutterKey" class="shutter" aria-hidden="true"></span>
					<span class="of">{{ next > roll.exposures ? `past ${roll.exposures}: still going?` : `next frame · of ${roll.exposures}` }}</span>
				</div>
				<button type="button" class="adj" aria-label="Skip a frame" @click="adjust(1)">+</button>
			</section>

			<p v-if="rewindHint" class="hint">{{ rewindHint }}</p>

			<!-- Light: a Sunny 16 meter from the sky, long exposures, zone focus, today's sun -->
			<ShootLight
				:iso="roll.shotAtIso ?? roll.stock.iso"
				:comp="roll.exposureComp"
				:stock="roll.stock"
				:manual="camera?.kind !== 'point-and-shoot'"
				:camera-kind="camera?.kind ?? null"
				:apertures="aperturesFor(widest)"
				:widest="widest"
				:focal="focalForLight"
				:aperture="aperture"
				:shutter="shutter"
				:coords="lightCoords"
				@set="setFromLight"
			/>

			<!-- Exposure -->
			<section class="exposure" aria-label="Exposure">
				<template v-if="manual">
					<ShootDial v-model="aperture" label="Aperture" :hint="lensMaxText" :options="apertureOptions" />
					<ShootDial v-model="shutter" label="Shutter" hint="seconds" :options="shutterOptions" />
				</template>
				<button v-else type="button" class="auto-row" @click="manual = true">
					<span>Exposure set by the camera</span>
					<span class="link">Note it yourself</span>
				</button>
				<div class="row">
					<label v-if="mountLenses.length" class="lens">
						<span class="sr-only">Lens</span>
						<select id="shoot-lens" v-model="lensId" class="field">
							<option :value="null">Lens not noted</option>
							<option v-for="l in mountLenses" :key="l.id" :value="l.id">{{ l.name }}</option>
						</select>
					</label>
					<label v-if="isZoom" class="focal">
						<span class="sr-only">Focal length (mm)</span>
						<input id="shoot-focal" v-model.number="focal" class="field" type="number" inputmode="numeric" :min="lens?.focalMin ?? 1" :max="lens?.focalMax ?? 2000" placeholder="mm" />
					</label>
					<button type="button" class="chip flash" :aria-pressed="flash" @click="flash = !flash">Flash</button>
				</div>
			</section>

			<section class="loc">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
				<span class="loc-text">{{ locText }}</span>
				<button type="button" class="switch" role="switch" :aria-checked="locOn" aria-label="Record rough location" @click="toggleLoc"></button>
			</section>

			<label class="note">
				<span class="sr-only">Note for this frame</span>
				<input id="shoot-note" v-model="note" class="field" type="text" maxlength="500" placeholder="Add a note…" enterkeyhint="done" @keydown.enter.prevent="logFrame" />
			</label>

			<button type="button" class="log" :disabled="busy" @click="logFrame">Log frame {{ next }}</button>

			<!-- Recent frames -->
			<section v-if="frames.length" class="recent" aria-label="Frames on this roll">
				<h2>{{ frames.length }} {{ frames.length === 1 ? 'frame' : 'frames' }} logged</h2>
				<ul>
					<li v-for="f in recentFrames" :key="f.clientId">
						<button type="button" class="frame-row" :aria-expanded="editing === f.clientId" @click="toggleEdit(f)">
							<span class="fn">{{ f.number }}</span>
							<span class="fx">{{ formatExposure(f) }}</span>
							<span class="ft">{{ frameTime(f) }}</span>
							<span v-if="f.note" class="fnote">{{ f.note }}</span>
							<span v-if="isPending(f)" class="dot" title="Not synced yet" aria-label="Not synced yet"></span>
						</button>
						<form v-if="editing === f.clientId" class="frame-edit" @submit.prevent="saveEdit(f)">
							<input :id="`edit-note-${f.clientId}`" v-model="editNote" class="field" type="text" maxlength="500" placeholder="Note" aria-label="Note" />
							<input :id="`edit-num-${f.clientId}`" v-model.number="editNumber" class="field num" type="number" min="-1" max="200" aria-label="Frame number" />
							<button type="submit" class="small-btn">Save</button>
							<button type="button" class="small-btn danger" @click="removeFrame(f)">Delete</button>
						</form>
					</li>
				</ul>
				<a v-if="frames.length > recentFrames.length" class="link" :href="`/photography/lab/rolls/${roll.code}/#frames`">All {{ frames.length }} on the roll page</a>
			</section>

			<!-- End of roll -->
			<section class="end">
				<template v-if="ending === 'finish'">
					<p>Mark {{ roll.code }} finished after frame {{ lastNumber }}? It moves to “Shot”, ready for a lab.</p>
					<div class="end-actions">
						<button type="button" class="small-btn strong" :disabled="busy" @click="finishRoll">Roll finished</button>
						<button type="button" class="small-btn" @click="ending = null">Cancel</button>
					</div>
				</template>
				<form v-else-if="ending === 'rewind'" class="rewind" @submit.prevent="rewindRoll">
					<p>Rewound part-way? It goes back to storage. Reloading it later winds past the last frame (plus one spare).</p>
					<label>Last frame shot <input id="rewind-after" v-model.number="rewindAfter" class="field num" type="number" min="0" :max="roll.exposures" /></label>
					<label>Kept in <input id="rewind-spot" v-model="rewindSpot" class="field" type="text" maxlength="60" list="shoot-spots" /></label>
					<datalist id="shoot-spots"><option v-for="s in spots" :key="s" :value="s" /></datalist>
					<div class="end-actions">
						<button type="submit" class="small-btn strong" :disabled="busy">Rewound after frame {{ rewindAfter }}</button>
						<button type="button" class="small-btn" @click="ending = null">Cancel</button>
					</div>
				</form>
				<div v-else class="end-actions">
					<button type="button" class="small-btn" @click="ending = 'finish'">Roll finished</button>
					<button type="button" class="small-btn" @click="startRewind">Rewound early</button>
				</div>
			</section>
		</template>

		<section v-else class="empty">
			<h1>Nothing’s loaded</h1>
			<p>Load a roll on the light table and it shows up here, ready to log frames.</p>
			<a class="log as-link" href="/photography/lab/">Open the light table</a>
		</section>

		<footer class="foot">
			<span v-if="awake">Screen stays on while this is open.</span>
			<button v-if="installPrompt" type="button" class="link" @click="install">Install Film Lab on this phone</button>
			<span v-else-if="iosHint">Share → Add to Home Screen to use this offline.</span>
		</footer>

		<div v-if="toast" class="toast" role="status">
			<span>{{ toast.text }}</span>
			<button v-if="toast.undo" type="button" @click="toast.undo()">Undo</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
	aperturesFor,
	formatAperture,
	formatExposure,
	frameTime,
	nextFrameNumber,
	ratingLine,
	roughCoord,
	SHUTTERS,
	widestFromText,
	type FrameInput,
	type FrameView,
	type LensView,
	type RollView,
} from '../../lib/lab/inventory';
import { flush, pending, queueCall, queueFrame } from '../../lib/lab/offline';
import ShootDial from './ShootDial.vue';
import ShootLight from './ShootLight.vue';

interface CameraInfo {
	name: string;
	kind: string;
	mount: string | null;
	fixedLens: string | null;
}

const props = defineProps<{
	userId: string;
	rolls: RollView[];
	cameras: Record<string, CameraInfo>;
	lenses: LensView[];
	frames: FrameView[];
	initialCode: string | null;
	spots: string[];
	today: string;
}>();

/* ---------- rolls and frames ---------- */

const rolls = ref<RollView[]>([...props.rolls]);
const serverFrames = ref<FrameView[]>([...props.frames]);
/** Queued on this phone, by client id (a deleted frame stays here until it syncs). */
const local = ref<Map<string, FrameInput>>(new Map());
const pendingCalls = ref(0);

const byLoadDate = [...props.rolls].sort((a, b) => b.statusOn.localeCompare(a.statusOn));
const currentId = ref<string | null>(
	props.rolls.find((r) => r.code === props.initialCode?.toUpperCase())?.id ?? byLoadDate[0]?.id ?? null
);
const roll = computed(() => rolls.value.find((r) => r.id === currentId.value) ?? null);
const camera = computed(() => (roll.value?.camera ? props.cameras[roll.value.camera.id] ?? null : null));

const frames = computed(() => {
	if (!roll.value) return [];
	const id = roll.value.id;
	const list: (FrameView | FrameInput)[] = serverFrames.value.filter((f) => f.rollId === id && !local.value.has(f.clientId));
	for (const f of local.value.values()) if (f.rollId === id && !f.deleted) list.push(f);
	return list.sort((a, b) => a.number - b.number || a.shotAt - b.shotAt);
});
const recentFrames = computed(() => [...frames.value].reverse().slice(0, 6));
const lastNumber = computed(() => frames.value.at(-1)?.number ?? 0);
const isPending = (f: { clientId: string }) => local.value.has(f.clientId);

const override = ref<number | null>(null);
const shutterKey = ref(0);
/** Up when the counter advances, down when it goes back (undo, −). */
const rollDir = ref<'roll-up' | 'roll-down'>('roll-up');
const next = computed(() => override.value ?? nextFrameNumber(frames.value, roll.value?.rewoundAtFrame ?? null));
watch(next, (to, from) => (rollDir.value = to >= from ? 'roll-up' : 'roll-down'));
function adjust(step: number) {
	override.value = Math.max(0, next.value + step);
}

const rewindHint = computed(() => {
	const r = roll.value;
	if (!r?.rewoundAtFrame || lastNumber.value > r.rewoundAtFrame) return '';
	return `Partly shot before: with the lens cap on, wind on to frame ${r.rewoundAtFrame + 2} first.`;
});

/* ---------- exposure, lens, flash: remembered from the roll's last frame ---------- */

const manual = ref(true);
const aperture = ref<number | null>(null);
const shutter = ref<string | null>(null);
const lensId = ref<string | null>(null);
const focal = ref<number | ''>('');
const flash = ref(false);
const note = ref('');

const mountLenses = computed(() => {
	const mount = camera.value?.mount?.trim().toLowerCase();
	return mount ? props.lenses.filter((l) => l.mount.trim().toLowerCase() === mount) : [];
});
const lens = computed(() => props.lenses.find((l) => l.id === lensId.value) ?? null);
const isZoom = computed(() => !!lens.value?.focalMax && lens.value.focalMax !== lens.value.focalMin);
const widest = computed(() => lens.value?.maxAperture ?? widestFromText(camera.value?.fixedLens));
const lensMaxText = computed(() => (widest.value ? `widest ${formatAperture(widest.value)}` : ''));
/** The focal length on the camera now, for zone focusing. */
const focalForLight = computed(() => {
	if (isZoom.value && typeof focal.value === 'number') return focal.value;
	if (lens.value?.focalMin) return lens.value.focalMin;
	const m = camera.value?.fixedLens?.match(/(\d+(?:\.\d+)?)\s*mm/i);
	return m ? Number(m[1]) : null;
});
/** Where the sun is worked out from: stable between renders, so the drawer doesn't redo it on every dial turn. */
const lightCoords = computed(() => (locOn.value && fix.value ? { lat: fix.value.lat, lng: fix.value.lng } : null));
function setFromLight(a: number, s: string) {
	manual.value = true;
	aperture.value = a;
	shutter.value = s;
}
const apertureOptions = computed(() => [
	{ value: null, label: 'A' },
	...aperturesFor(widest.value).map((a) => ({ value: a, label: formatAperture(a)!.slice(2) })),
]);
const shutterOptions = computed(() => [{ value: null, label: 'A' }, ...SHUTTERS.map((s) => ({ value: s, label: s }))]);
const isoText = computed(() => (roll.value ? ratingLine(roll.value) : ''));

function restoreSettings() {
	const last = frames.value.at(-1);
	const auto = camera.value?.kind === 'point-and-shoot';
	aperture.value = last?.aperture ?? null;
	shutter.value = last?.shutter ?? null;
	manual.value = !auto || last?.aperture != null || last?.shutter != null;
	lensId.value = last?.lensId ?? (mountLenses.value.length === 1 ? mountLenses.value[0].id : null);
	focal.value = last?.focalLength ?? '';
	flash.value = last?.flash ?? false;
	override.value = null;
	note.value = '';
}

function select(id: string) {
	currentId.value = id;
	const r = rolls.value.find((x) => x.id === id);
	if (r) history.replaceState(history.state, '', `?roll=${r.code}`);
}
watch(currentId, restoreSettings);

/* ---------- location (rough, ~100 m) ---------- */

const locOn = ref(true);
const fix = ref<{ lat: number; lng: number; acc: number; at: number } | null>(null);
const locError = ref('');
const locText = computed(() => {
	if (!locOn.value) return 'Location off for these frames';
	if (locError.value) return locError.value;
	if (!fix.value) return 'Finding your rough location…';
	return `Rough location saved with each frame (±${Math.max(100, fix.value.acc)}\u00a0m)`;
});

function refreshFix() {
	if (!locOn.value || !('geolocation' in navigator)) return;
	navigator.geolocation.getCurrentPosition(
		(p) => {
			locError.value = '';
			fix.value = { lat: roughCoord(p.coords.latitude), lng: roughCoord(p.coords.longitude), acc: Math.round(p.coords.accuracy), at: Date.now() };
		},
		(err) => {
			locError.value = err.code === 1 ? 'Location blocked: allow it in your browser’s settings' : 'No location fix yet';
		},
		{ enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 }
	);
}

function toggleLoc() {
	locOn.value = !locOn.value;
	if (locOn.value) refreshFix();
}

/* ---------- logging ---------- */

const busy = ref(false);
const editing = ref<string | null>(null);
const editNote = ref('');
const editNumber = ref<number>(0);
const toast = ref<{ text: string; undo?: () => void } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string, undo?: () => void) {
	toast.value = { text, undo };
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toast.value = null), 6000);
}

async function put(f: FrameInput) {
	const copy = new Map(local.value);
	copy.set(f.clientId, f);
	local.value = copy;
	await queueFrame(props.userId, f);
	void sync();
}

async function logFrame() {
	const r = roll.value;
	if (!r || busy.value) return;
	const freshFix = locOn.value && fix.value && Date.now() - fix.value.at < 5 * 60_000 ? fix.value : null;
	const f: FrameInput = {
		clientId: crypto.randomUUID(),
		rollId: r.id,
		number: next.value,
		shotAt: Date.now(),
		tzOffset: -new Date().getTimezoneOffset(),
		cameraId: r.camera?.id ?? null,
		lensId: lensId.value,
		focalLength: isZoom.value && focal.value !== '' ? Number(focal.value) : (lens.value?.focalMin ?? null),
		aperture: manual.value ? aperture.value : null,
		shutter: manual.value ? shutter.value : null,
		flash: flash.value,
		lat: freshFix?.lat ?? null,
		lng: freshFix?.lng ?? null,
		accuracy: freshFix?.acc ?? null,
		note: note.value.trim() || null,
	};
	override.value = null;
	note.value = '';
	shutterKey.value++;
	navigator.vibrate?.(12);
	await put(f);
	showToast(`Frame ${f.number} logged`, () => {
		toast.value = null;
		void put({ ...f, deleted: true });
	});
	refreshFix();
}

function toggleEdit(f: FrameView | FrameInput) {
	if (editing.value === f.clientId) {
		editing.value = null;
		return;
	}
	editing.value = f.clientId;
	editNote.value = f.note ?? '';
	editNumber.value = f.number;
}

async function saveEdit(f: FrameView | FrameInput) {
	const { id: _id, ...rest } = f as FrameView;
	await put({ ...rest, note: editNote.value.trim() || null, number: Number(editNumber.value) || f.number });
	editing.value = null;
}

async function removeFrame(f: FrameView | FrameInput) {
	const { id: _id, ...rest } = f as FrameView;
	editing.value = null;
	await put({ ...rest, deleted: true });
	showToast(`Frame ${f.number} deleted`, () => {
		toast.value = null;
		void put({ ...rest, deleted: false });
	});
}

/* ---------- end of roll ---------- */

const ending = ref<'finish' | 'rewind' | null>(null);
const rewindAfter = ref(0);
const rewindSpot = ref('');

function startRewind() {
	rewindAfter.value = lastNumber.value;
	rewindSpot.value = roll.value?.storageSpot ?? props.spots[0] ?? '';
	ending.value = 'rewind';
}

async function endRoll(action: 'advanceRoll' | 'rewindRoll', payload: Record<string, unknown>, message: string) {
	const r = roll.value;
	if (!r) return;
	busy.value = true;
	await queueCall(props.userId, action, { rollId: r.id, on: props.today, ...payload });
	rolls.value = rolls.value.filter((x) => x.id !== r.id);
	currentId.value = rolls.value[0]?.id ?? null;
	ending.value = null;
	busy.value = false;
	showToast(message);
	void sync();
}

const finishRoll = () => endRoll('advanceRoll', { to: 'shot' }, `${roll.value?.code} is finished.`);
const rewindRoll = () =>
	endRoll('rewindRoll', { afterFrame: Number(rewindAfter.value) || 0, storageSpot: rewindSpot.value }, `${roll.value?.code} is back in storage.`);

/* ---------- sync ---------- */

const syncing = ref(false);
const offline = ref(false);
const refused = ref('');
const waiting = computed(() => local.value.size + pendingCalls.value);
const syncText = computed(() => {
	if (refused.value) return refused.value;
	if (offline.value && waiting.value) return `Offline · ${waiting.value} waiting`;
	if (syncing.value || waiting.value) return 'Saving…';
	return 'Synced';
});
const syncTone = computed(() => (refused.value ? 'bad' : offline.value && waiting.value ? 'warn' : waiting.value ? '' : 'ok'));

async function loadPending() {
	const items = await pending(props.userId);
	const map = new Map<string, FrameInput>();
	let calls = 0;
	for (const i of items) {
		if (i.kind === 'frame') map.set(i.payload.clientId, i.payload);
		else {
			calls++;
			// A finish or rewind queued offline: that roll is no longer in a camera.
			rolls.value = rolls.value.filter((r) => r.id !== i.payload.rollId);
		}
	}
	local.value = map;
	pendingCalls.value = calls;
	if (!rolls.value.some((r) => r.id === currentId.value)) currentId.value = rolls.value[0]?.id ?? null;
}

async function sync() {
	syncing.value = true;
	try {
		const r = await flush(props.userId);
		offline.value = r.offline;
		refused.value = r.refused.length ? `Not saved: ${r.refused[0]}` : '';
		if (r.syncedRolls.length) {
			// The server's list is now the whole truth for these rolls, even when it's empty.
			const synced = new Set(r.syncedRolls);
			serverFrames.value = [...serverFrames.value.filter((f) => !synced.has(f.rollId)), ...r.frames];
		}
		await loadPending();
		// Keep this phone's saved copy of the page current, for opening it offline.
		if (r.sent && !r.offline) {
			for (const url of [location.pathname + location.search, '/photography/lab/shoot/']) void fetch(url, { cache: 'no-store' }).catch(() => {});
		}
	} catch {
		offline.value = true;
	} finally {
		syncing.value = false;
	}
}

/* ---------- phone niceties: wake lock, safelight, install ---------- */

const awake = ref(false);
let lock: { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void } | null = null;
async function keepAwake() {
	try {
		const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof lock> } }).wakeLock;
		if (!wl || document.visibilityState !== 'visible') return;
		lock = await wl.request('screen');
		awake.value = true;
		lock?.addEventListener('release', () => (awake.value = false));
	} catch {
		awake.value = false;
	}
}

const safelight = ref(false);
function toggleSafelight() {
	safelight.value = !safelight.value;
	document.documentElement.toggleAttribute('data-safelight', safelight.value);
}

const installPrompt = ref<(Event & { prompt: () => Promise<void> }) | null>(null);
const iosHint = ref(false);
function onInstallable(e: Event) {
	e.preventDefault();
	installPrompt.value = e as Event & { prompt: () => Promise<void> };
}
async function install() {
	await installPrompt.value?.prompt();
	installPrompt.value = null;
}

let timer: ReturnType<typeof setInterval> | undefined;
let locTimer: ReturnType<typeof setInterval> | undefined;
function onVisible() {
	if (document.visibilityState !== 'visible') return;
	void keepAwake();
	void sync();
	refreshFix();
}
const onOnline = () => void sync();

onMounted(async () => {
	await loadPending();
	restoreSettings();
	void sync();
	refreshFix();
	void keepAwake();
	timer = setInterval(() => waiting.value && void sync(), 20_000);
	locTimer = setInterval(() => document.visibilityState === 'visible' && refreshFix(), 120_000);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('online', onOnline);
	window.addEventListener('beforeinstallprompt', onInstallable);
	const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
	iosHint.value = /iPhone|iPad/.test(navigator.userAgent) && !standalone;
});

onBeforeUnmount(() => {
	clearInterval(timer);
	clearInterval(locTimer);
	document.removeEventListener('visibilitychange', onVisible);
	window.removeEventListener('online', onOnline);
	window.removeEventListener('beforeinstallprompt', onInstallable);
	void lock?.release();
	document.documentElement.removeAttribute('data-safelight');
});
</script>

<style scoped>
.shoot {
	--shoot-bg: var(--gray-999);
	--shoot-ink: var(--gray-0);
	--shoot-body: var(--gray-200);
	--shoot-meta: var(--gray-300);
	--shoot-line: var(--gray-800);
	--shoot-panel: var(--gray-900);
	--shoot-mark: oklch(58% 0.19 28);
	--shoot-window: oklch(16% 0.004 50);
	--shoot-window-ink: oklch(96% 0.004 85);
	--shoot-btn: var(--accent-regular);
	--shoot-btn-ink: var(--accent-text-over);
	display: grid;
	gap: 1rem;
	max-width: 32rem;
	margin-inline: auto;
	padding: calc(0.75rem + env(safe-area-inset-top, 0px)) max(1rem, env(safe-area-inset-right, 0px)) calc(2rem + env(safe-area-inset-bottom, 0px))
		max(1rem, env(safe-area-inset-left, 0px));
	color: var(--shoot-body);
}

/* Safelight: red on black, so your eyes stay adjusted to the dark. */
.shoot.safelight {
	--shoot-bg: #000;
	--shoot-ink: oklch(62% 0.2 28);
	--shoot-body: oklch(52% 0.17 28);
	--shoot-meta: oklch(44% 0.14 28);
	--shoot-line: oklch(26% 0.08 28);
	--shoot-panel: oklch(14% 0.04 28);
	--shoot-mark: oklch(60% 0.2 28);
	--shoot-window: #000;
	--shoot-window-ink: oklch(62% 0.2 28);
	--shoot-btn: oklch(38% 0.15 28);
	--shoot-btn-ink: #000;
	background: var(--shoot-bg);
}

.top {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.back {
	color: var(--shoot-meta);
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	text-decoration: none;
}

.sync {
	margin-left: auto;
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--shoot-meta);
	text-align: right;
}

.sync.ok {
	color: var(--lab-ok);
}

.sync.warn,
.sync.bad {
	color: var(--lab-warn);
}

.safelight .sync {
	color: var(--shoot-meta);
}

.icon-btn {
	display: grid;
	place-items: center;
	width: 2.5rem;
	height: 2.5rem;
	border: 1px solid var(--shoot-line);
	border-radius: 50%;
	background: none;
	color: var(--shoot-ink);
	cursor: pointer;
}

.icon-btn[aria-pressed='true'] {
	background: var(--shoot-mark);
	color: #000;
	border-color: var(--shoot-mark);
}

.icon-btn svg,
.loc svg {
	width: 1.15rem;
	height: 1.15rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.switcher {
	display: flex;
	gap: 0.4rem;
	overflow-x: auto;
	scrollbar-width: none;
}

.chip {
	flex: none;
	min-height: 2.4rem;
	padding: 0.3rem 0.9rem;
	border: 1px solid var(--shoot-line);
	border-radius: 999px;
	background: none;
	color: var(--shoot-body);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.chip[aria-pressed='true'] {
	background: var(--shoot-btn);
	border-color: var(--shoot-btn);
	color: var(--shoot-btn-ink);
}

.head {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 0.75rem;
}

.edge {
	font-size: var(--text-sm);
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--shoot-meta);
}

.head h1,
.empty h1 {
	margin-top: 0.1rem;
	font-family: var(--font-brand);
	font-style: italic;
	font-weight: 420;
	font-variation-settings: 'opsz' 144, 'SOFT' 60, 'WONK' 1;
	font-size: clamp(1.8rem, 7vw, 2.3rem);
	line-height: 1.02;
	color: var(--shoot-ink);
}

.sub {
	margin-top: 0.3rem;
	font-family: var(--font-mono);
	font-size: 0.75rem;
	color: var(--shoot-meta);
}

.sticker {
	flex: none;
	padding: 0.4rem 0.6rem 0.25rem;
	border-radius: 3px;
	background: var(--shoot-panel);
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 1.05rem;
	color: var(--shoot-ink);
	text-decoration: none;
	rotate: 4deg;
}

.counter {
	display: grid;
	grid-template-columns: 3rem 1fr 3rem;
	align-items: center;
	gap: 0.5rem;
}

.adj {
	height: 3rem;
	border: 1px solid var(--shoot-line);
	border-radius: 50%;
	background: none;
	color: var(--shoot-ink);
	font-size: 1.4rem;
	cursor: pointer;
}

.window {
	position: relative;
	display: grid;
	justify-items: center;
	gap: 0.15rem;
	padding: 0.7rem 0 0.75rem;
	border-radius: 1rem;
	background: var(--shoot-window);
	overflow: hidden;
}

.safelight .window {
	box-shadow: inset 0 0 0 1px var(--shoot-line);
}

.window::before {
	content: '';
	border-left: 6px solid transparent;
	border-right: 6px solid transparent;
	border-top: 8px solid var(--shoot-mark);
}

.window {
	min-height: 6.4rem;
}

.digits {
	display: flex;
	align-items: baseline;
	gap: 1.1rem;
	font-family: var(--font-mono);
	color: var(--shoot-window-ink);
	font-variant-numeric: tabular-nums;
}

.digits span {
	min-width: 1.6ch;
	text-align: center;
	font-size: 1.5rem;
	opacity: 0.55;
}

.digits span.far {
	font-size: 1.15rem;
	opacity: 0.3;
}

.digits b {
	font-size: 3.4rem;
	font-weight: 500;
	line-height: 1;
}

/* Counter roll: the old row slides out as the new one slides in. */
.roll-up-enter-active,
.roll-up-leave-active,
.roll-down-enter-active,
.roll-down-leave-active {
	transition:
		translate 0.28s cubic-bezier(0.22, 1, 0.36, 1),
		opacity 0.28s ease;
}

.roll-up-leave-active,
.roll-down-leave-active {
	position: absolute;
	top: 1.25rem;
	left: 0;
	right: 0;
	justify-content: center;
}

.roll-up-enter-from,
.roll-down-leave-to {
	translate: 0 60%;
	opacity: 0;
}

.roll-up-leave-to,
.roll-down-enter-from {
	translate: 0 -60%;
	opacity: 0;
}

/* The shutter: an iris closing to a pinhole and opening again. */
.shutter {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 170%;
	aspect-ratio: 1;
	translate: -50% -50%;
	border-radius: 50%;
	box-shadow: 0 0 0 40rem #000;
	pointer-events: none;
	animation: blink 0.34s cubic-bezier(0.5, 0, 0.3, 1) both;
}

@keyframes blink {
	0% {
		width: 170%;
		opacity: 0;
	}
	40% {
		width: 6%;
		opacity: 1;
	}
	100% {
		width: 170%;
		opacity: 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.roll-up-enter-active,
	.roll-up-leave-active,
	.roll-down-enter-active,
	.roll-down-leave-active {
		transition: none;
	}

	.shutter {
		display: none;
	}
}

.of {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: color-mix(in oklch, var(--shoot-window-ink) 60%, transparent);
}

.hint {
	padding: 0.6rem 0.8rem;
	border-radius: 0.6rem;
	background: var(--shoot-panel);
	font-size: var(--text-sm);
	color: var(--shoot-ink);
}

.exposure {
	display: grid;
	gap: 0.75rem;
}

.auto-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	min-height: 3rem;
	padding: 0 0.9rem;
	border: 1px solid var(--shoot-line);
	border-radius: 0.75rem;
	background: none;
	color: var(--shoot-body);
	font: inherit;
	cursor: pointer;
}

.row {
	display: flex;
	gap: 0.5rem;
	align-items: center;
}

.lens {
	flex: 1;
	min-width: 0;
}

.focal {
	width: 5.5rem;
}

.field {
	width: 100%;
	min-width: 0;
	min-height: 2.75rem;
	padding: 0.45rem 0.75rem;
	border: 1px solid var(--shoot-line);
	border-radius: 0.6rem;
	background: var(--shoot-bg);
	color: var(--shoot-ink);
	font: inherit;
	font-size: 1rem;
}

.field.num {
	width: 5rem;
}

.field:focus-visible,
.chip:focus-visible,
.adj:focus-visible,
.log:focus-visible,
.small-btn:focus-visible,
.icon-btn:focus-visible,
.frame-row:focus-visible,
.switch:focus-visible,
.auto-row:focus-visible {
	outline: 2px solid var(--shoot-mark);
	outline-offset: 2px;
}

.flash {
	flex: none;
}

.loc {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	font-size: var(--text-sm);
	color: var(--shoot-body);
}

.loc-text {
	flex: 1;
}

.switch {
	position: relative;
	flex: none;
	width: 2.6rem;
	height: 1.5rem;
	border: 0;
	border-radius: 999px;
	background: var(--shoot-line);
	cursor: pointer;
}

.switch::after {
	content: '';
	position: absolute;
	top: 0.2rem;
	left: 0.2rem;
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 50%;
	background: var(--shoot-bg);
	transition: translate 0.15s ease;
}

.switch[aria-checked='true'] {
	background: var(--shoot-btn);
}

.switch[aria-checked='true']::after {
	translate: 1.1rem 0;
	background: var(--shoot-btn-ink);
}

.log {
	display: grid;
	place-items: center;
	width: 100%;
	min-height: 3.6rem;
	border: 0;
	border-radius: 1rem;
	background: var(--shoot-btn);
	color: var(--shoot-btn-ink);
	font-family: var(--font-brand);
	font-size: 1.3rem;
	font-weight: 520;
	text-decoration: none;
	cursor: pointer;
	touch-action: manipulation;
}

.log:active {
	scale: 0.98;
}

/*
 * Out of the safelight, the counter sits in the camera's top plate: brushed
 * chrome by day, black paint at night, with knurled wind knobs either side;
 * and logging a frame is the shutter release.
 */
.shoot:not(.safelight) .counter {
	padding: 0.7rem 0.65rem;
	border-radius: 1.4rem;
	background:
		repeating-linear-gradient(90deg, oklch(100% 0 0 / 0.05) 0 1px, transparent 1px 3px),
		linear-gradient(180deg, oklch(93% 0.004 80), oklch(82% 0.006 80) 48%, oklch(88% 0.005 80) 52%, oklch(76% 0.008 75));
	box-shadow:
		inset 0 1px 0 oklch(100% 0 0 / 0.7),
		inset 0 -2px 0 rgb(0 0 0 / 0.2),
		0 10px 22px -14px rgb(0 0 0 / 0.55);
}

:root.theme-dark .shoot:not(.safelight) .counter {
	background:
		repeating-linear-gradient(90deg, oklch(100% 0 0 / 0.04) 0 1px, transparent 1px 3px),
		linear-gradient(180deg, oklch(29% 0.004 60), oklch(18% 0.004 60) 50%, oklch(22% 0.004 60));
	box-shadow:
		inset 0 1px 0 oklch(100% 0 0 / 0.12),
		0 0 0 1px oklch(100% 0 0 / 0.05),
		0 12px 24px -14px rgb(0 0 0 / 0.9);
}

.shoot:not(.safelight) .counter .adj {
	border: 0;
	background:
		radial-gradient(circle, oklch(30% 0.004 60) 0 54%, transparent 55%),
		repeating-conic-gradient(oklch(22% 0.004 60) 0 6deg, oklch(42% 0.004 60) 6deg 12deg);
	color: oklch(95% 0.006 85);
	box-shadow:
		0 2px 4px rgb(0 0 0 / 0.45),
		inset 0 0 0 1px rgb(0 0 0 / 0.5);
	transition: rotate 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.shoot:not(.safelight) .counter .adj:active {
	rotate: 24deg;
}

.shoot:not(.safelight) .counter .window {
	box-shadow:
		inset 0 3px 8px rgb(0 0 0 / 0.75),
		0 1px 0 oklch(100% 0 0 / 0.45);
}

.shoot:not(.safelight) .log:not(.as-link) {
	position: relative;
	gap: 0.6rem;
	grid-auto-flow: column;
	justify-content: center;
	background:
		radial-gradient(120% 140% at 50% 0%, oklch(100% 0 0 / 0.14), transparent 60%),
		var(--shoot-btn);
	box-shadow:
		inset 0 1px 0 oklch(100% 0 0 / 0.18),
		inset 0 -3px 0 rgb(0 0 0 / 0.25),
		0 10px 22px -12px rgb(0 0 0 / 0.6);
	transition:
		scale 0.12s ease,
		box-shadow 0.12s ease;
}

/* The release: a chrome button with a red dot. */
.shoot:not(.safelight) .log:not(.as-link)::before {
	content: '';
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 50%;
	background:
		radial-gradient(circle, oklch(58% 0.21 28) 0 22%, transparent 24%),
		radial-gradient(circle at 40% 35%, oklch(98% 0.003 80), oklch(70% 0.005 80) 70%);
	box-shadow:
		0 0 0 2px oklch(25% 0.004 60),
		0 1px 2px rgb(0 0 0 / 0.5);
}

.shoot:not(.safelight) .log:not(.as-link):active {
	scale: 0.975;
	box-shadow:
		inset 0 3px 8px rgb(0 0 0 / 0.4),
		0 4px 10px -8px rgb(0 0 0 / 0.6);
}

.recent {
	display: grid;
	gap: 0.4rem;
}

.recent h2 {
	font-family: var(--font-body);
	font-size: var(--text-sm);
	font-weight: 400;
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--shoot-meta);
}

.recent ul {
	list-style: none;
	padding: 0;
	display: grid;
}

.frame-row {
	position: relative;
	display: grid;
	grid-template-columns: 2.2rem 1fr auto;
	align-items: baseline;
	gap: 0.2rem 0.6rem;
	width: 100%;
	padding: 0.55rem 0.2rem;
	border: 0;
	border-bottom: 1px solid var(--shoot-line);
	background: none;
	color: var(--shoot-body);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.fn {
	font-family: var(--font-mono);
	font-size: 0.85rem;
	color: var(--lab-edge-ink);
}

.safelight .fn {
	color: var(--shoot-ink);
}

.fx {
	font-family: var(--font-mono);
	font-size: 0.85rem;
	color: var(--shoot-ink);
}

.ft {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--shoot-meta);
}

.fnote {
	grid-column: 2 / -1;
	font-size: var(--text-sm);
	font-style: italic;
	color: var(--shoot-meta);
}

/* Not synced yet: a dot in the margin beside the frame number. */
.dot {
	position: absolute;
	left: -0.7rem;
	top: 1rem;
	width: 0.45rem;
	height: 0.45rem;
	border-radius: 50%;
	background: var(--lab-warn);
}

.frame-edit {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
	padding: 0.5rem 0 0.75rem;
}

.frame-edit .field:first-child {
	flex: 1 1 10rem;
}

.small-btn {
	min-height: 2.5rem;
	padding: 0.3rem 0.9rem;
	border: 1px solid var(--shoot-line);
	border-radius: 999px;
	background: none;
	color: var(--shoot-ink);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}

.small-btn.strong {
	background: var(--shoot-btn);
	border-color: var(--shoot-btn);
	color: var(--shoot-btn-ink);
}

.small-btn.danger {
	color: var(--lab-warn);
}

.end {
	display: grid;
	gap: 0.6rem;
	padding-top: 0.75rem;
	border-top: 1px solid var(--shoot-line);
	font-size: var(--text-sm);
}

.end-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.rewind {
	display: grid;
	gap: 0.6rem;
}

.rewind label {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.rewind label .field:not(.num) {
	max-width: 12rem;
}

.link {
	border: 0;
	padding: 0;
	background: none;
	color: var(--shoot-ink);
	font: inherit;
	font-size: var(--text-sm);
	text-decoration: underline;
	text-underline-offset: 0.2em;
	cursor: pointer;
}

.auto-row .link {
	font-size: var(--text-sm);
}

.empty {
	display: grid;
	gap: 0.9rem;
	padding-top: 2rem;
}

.foot {
	display: grid;
	gap: 0.3rem;
	justify-items: center;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--shoot-meta);
	text-align: center;
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
	background: var(--shoot-btn);
	color: var(--shoot-btn-ink);
	box-shadow: var(--shadow-md);
}

.toast button {
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-decoration: underline;
	cursor: pointer;
}
</style>
