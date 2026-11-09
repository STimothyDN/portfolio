<template>
	<section class="light" :class="{ open }" aria-label="Light">
		<button type="button" class="summary" :aria-expanded="open" aria-controls="light-drawer" @click="toggle">
			<svg v-if="daylight" class="glyph" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="4.2" />
				<path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" />
			</svg>
			<svg v-else class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" /></svg>
			<span class="sum">
				<span class="sum-a">{{ conditionLabel }} · {{ report.line }}</span>
				<span class="sum-b">{{ summaryB }}</span>
			</span>
			<span class="chev" aria-hidden="true"></span>
		</button>

		<div v-if="open" id="light-drawer" class="drawer">
			<div class="tabs" role="group" aria-label="Light tools">
				<button v-for="t in tabs" :key="t.key" type="button" class="tab" :data-tab="t.key" :aria-label="t.label" :aria-pressed="tab === t.key" @click="tab = t.key">
					<span class="t-long" aria-hidden="true">{{ t.label }}</span><span class="t-short" aria-hidden="true">{{ t.short }}</span>
					<span v-if="t.key === 'long' && isLong && tab !== 'long'" class="tab-dot"></span>
				</button>
			</div>

			<template v-if="tab === 'meter'">
			<!-- The sky: the meter's guess, or the one you see -->
			<div class="chips" role="group" aria-label="The light where you are">
				<button type="button" class="chip" :aria-pressed="choice === 'auto'" @click="choice = 'auto'">Auto · {{ reading.label }}</button>
				<button v-for="c in chipOrder" :key="c.key" type="button" class="chip" :aria-pressed="choice === c.key" @click="choice = c.key">
					{{ c.label }}
				</button>
			</div>
			<p class="why">{{ whyLine }}</p>

			<!-- The meter -->
			<div class="meter">
				<p class="ev">
					<b>EV {{ formatEv(ev100) }}</b>
					<span>{{ rule ? `Sunny 16: ${rule} at 1/${iso}` : `at ISO 100` }} · ISO {{ iso }}{{ isoGuessed ? ' (guessed)' : '' }}</span>
				</p>
				<ul v-if="manual && picks.picks.length" class="picks">
					<li v-for="p in picks.picks" :key="p.label">
						<button type="button" class="pick" :aria-pressed="aperture === p.setting.aperture && shutter === p.setting.shutter" @click="emit('set', p.setting.aperture, p.setting.shutter)">
							<span class="pl">{{ p.label }}</span>
							<span class="pv">{{ formatAperture(p.setting.aperture) }} · {{ p.setting.shutter }}<small v-if="formatOff(p.setting.off)" :title="`${formatOff(p.setting.off)} stop from the reading`">{{ formatOff(p.setting.off) }}</small></span>
						</button>
					</li>
				</ul>
				<p v-if="manual && picks.slow" class="note warn">
					{{
						picks.slow.seconds > 0.5
							? `Even ${formatAperture(picks.slow.aperture)} needs ${formatSeconds(picks.slow.seconds)}: tripod time.`
							: `Needs ${formatAperture(picks.slow.aperture)} at ${formatSeconds(picks.slow.seconds)}: brace it, or use flash.`
					}}
				</p>
				<p v-if="!manual" class="note" :class="autoNote.tone">{{ autoNote.text }}</p>
				<p v-if="manual && picks.over > 0.5" class="note">
					Even {{ formatAperture(Math.max(...apertures)) }} at 1/4000 is {{ formatEv(picks.over) }} {{ picks.over > 1.2 ? 'stops' : 'stop' }} over. Negative film takes about three; slide film won’t.
				</p>
				<p v-if="manual && check" class="check" :class="check.tone">
					Your {{ formatAperture(aperture) }} · {{ shutter }}: {{ check.text }}
				</p>
				<p v-if="caveat" class="note">{{ caveat }}</p>
				<button v-if="manual && isLong" type="button" class="link" @click="tab = 'long'">Reciprocity and the bulb timer</button>
			</div>
			</template>

			<!-- Long exposure: reciprocity and a bulb timer -->
			<div v-else-if="tab === 'long'" class="long">
				<div class="stepper" role="group" aria-label="Metered time">
					<span class="lbl">Metered</span>
					<button type="button" class="step" aria-label="Shorter metered time" :disabled="meteredIndex === 0" @click="meteredIndex--">−</button>
					<b>{{ formatSeconds(metered) }}</b>
					<button type="button" class="step" aria-label="Longer metered time" :disabled="meteredIndex === METERED.length - 1" @click="meteredIndex++">+</button>
				</div>
				<p class="long-text">
					<template v-if="corrected > metered + 0.05">
						Expose for <b>{{ formatSeconds(corrected) }}</b> on {{ stock.name }}, {{ formatEv(Math.log2(corrected / metered)) }} {{ Math.log2(corrected / metered) > 1.2 ? 'stops' : 'stop' }} more for reciprocity
					</template>
					<template v-else>No reciprocity correction needed on {{ stock.name }} yet</template>
					({{ recip.source }}). Bracket a stop either side.
				</p>
				<div class="timer">
					<output class="clock" :class="{ running }">{{ timerText }}</output>
					<div class="timer-acts">
						<button type="button" class="start" @click="running ? stopTimer() : startTimer(corrected)">
							{{ running ? 'Stop' : `Start ${formatSeconds(corrected)}` }}
						</button>
						<button v-if="!running" type="button" class="chip" @click="startTimer(null)">Count up</button>
					</div>
				</div>
				<p class="sr-only" aria-live="assertive">{{ timerDone }}</p>
			</div>

			<!-- Zone focusing for the lens on the camera -->
			<div v-else-if="tab === 'focus' && focus" class="focus">
				<h3>{{ focal }}mm at {{ formatAperture(focus.aperture) }}{{ aperture == null ? ' (set the aperture dial)' : '' }}</h3>
				<p>
					Focus at <b>{{ formatDistance(focus.hyperfocal) }}</b> and everything from {{ formatDistance(focus.hyperfocal / 2) }} to ∞ is sharp.
				</p>
				<table class="zones">
					<caption class="sr-only">Sharp zone by focus distance</caption>
					<thead>
						<tr>
							<th scope="col">Focus at</th>
							<th scope="col">Sharp from</th>
							<th scope="col">to</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="z in focus.zones" :key="z.at">
							<th scope="row">{{ metres(z.at) }}<small>{{ feet(z.at) }}</small></th>
							<td>{{ metres(z.near) }}<small>{{ feet(z.near) }}</small></td>
							<td>{{ metres(z.far) }}<small>{{ feet(z.far) }}</small></td>
						</tr>
					</tbody>
				</table>
			</div>

			<!-- Today's light -->
			<ol v-else class="day" aria-label="Today's light">
				<li v-for="m in report.moments" :key="`${m.label}${m.at}`" :class="{ past: m.at < now }">
					<span>{{ m.label }}</span>
					<time>{{ clock(m.at) }}</time>
				</li>
			</ol>
			<p class="fine">Sun for {{ coords ? 'where you are' : 'Durham (turn on location for your spot)' }} · weather by Open-Meteo</p>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { shutterSeconds } from '../../lib/lab/almanac';
import { formatAperture } from '../../lib/lab/inventory';
import {
	autoExposureNote,
	circleOfConfusion,
	clock,
	conditionBy,
	CONDITIONS,
	correctedSeconds,
	depthOfField,
	evAtIso,
	formatDistance,
	formatEv,
	formatOff,
	formatSeconds,
	formatWait,
	hyperfocal,
	pickSettings,
	readSky,
	reciprocityFor,
	sunReport,
	type LightKey,
} from '../../lib/lab/light';
import { skyAt, type SkyFetch } from '../../lib/lab/sky-weather';

const props = defineProps<{
	/** The speed the roll is rated at. */
	iso: number | null;
	stock: { name: string; brand: string | null; token: string | null; process: string; format: string };
	/** False for cameras that set exposure themselves. */
	manual: boolean;
	cameraKind: string | null;
	apertures: number[];
	widest: number | null;
	focal: number | null;
	aperture: number | null;
	shutter: string | null;
	coords: { lat: number; lng: number } | null;
}>();
const emit = defineEmits<{ set: [aperture: number, shutter: string] }>();

const DURHAM = { lat: 35.99, lng: -78.9 };
const OPEN_KEY = 'lab-light-open';

const open = ref(false);
function toggle() {
	open.value = !open.value;
	try {
		localStorage.setItem(OPEN_KEY, open.value ? '1' : '0');
	} catch {
		// Remembering is a nicety.
	}
}

/* ---------- the sky ---------- */

const now = ref(Date.now());
const here = computed(() => props.coords ?? DURHAM);
const sky = ref<SkyFetch | null>(null);
const skyTried = ref(false);
const report = computed(() => sunReport(now.value, here.value.lat, here.value.lng));
const reading = computed(() => readSky(report.value.altitude, sky.value));
const daylight = computed(() => reading.value.daylight || report.value.altitude > -0.8);

const choice = ref<LightKey | 'auto'>('auto');
const chosen = computed(() => (choice.value === 'auto' ? null : conditionBy(choice.value)));
const ev100 = computed(() => chosen.value?.ev ?? reading.value.ev);
const conditionLabel = computed(() => chosen.value?.label ?? reading.value.label);
const rule = computed(() => chosen.value?.rule ?? (choice.value === 'auto' && reading.value.key ? conditionBy(reading.value.key).rule : undefined));
const caveat = computed(() => (choice.value === 'auto' ? reading.value.caveat : null));
const chipOrder = computed(() => {
	const day = CONDITIONS.filter((c) => !c.night);
	const night = CONDITIONS.filter((c) => c.night);
	return reading.value.daylight ? [...day, ...night] : [...night, ...day];
});
const whyLine = computed(() => {
	if (choice.value !== 'auto') return `Metering for ${conditionLabel.value.toLowerCase()}. Auto goes back to the sky’s reading.`;
	const age = sky.value ? Math.round((Date.now() - sky.value.at) / 60_000) : null;
	const weather = sky.value
		? age && age > 1
			? `weather from ${formatWait(age * 60_000)} ago`
			: 'live weather'
		: skyTried.value
			? 'no weather reading (offline?)'
			: 'checking the weather…';
	return `${reading.value.why} · ${weather}`;
});

async function refreshSky() {
	sky.value = await skyAt(here.value.lat, here.value.lng);
	skyTried.value = true;
}
watch(() => `${here.value.lat},${here.value.lng}`, refreshSky);

/* ---------- the meter ---------- */

const isoGuessed = computed(() => !props.iso);
const iso = computed(() => props.iso ?? 400);
const ev = computed(() => evAtIso(ev100.value, iso.value));
const picks = computed(() => pickSettings(ev.value, props.apertures));
const autoNote = computed(() => autoExposureNote(ev.value, iso.value, props.widest ?? 3.5));
const summaryB = computed(() => {
	if (!props.manual) return autoNote.value.text;
	const first = picks.value.picks[0];
	if (first) return `EV ${formatEv(ev100.value)} · ${formatAperture(first.setting.aperture)} at ${first.setting.shutter} for ISO ${iso.value}`;
	if (picks.value.slow) return `EV ${formatEv(ev100.value)} · ${formatAperture(picks.value.slow.aperture)} needs ${formatSeconds(picks.value.slow.seconds)}`;
	return `EV ${formatEv(ev100.value)} for ISO ${iso.value}`;
});

/** How the dials as set compare with the reading. */
const check = computed(() => {
	const t = shutterSeconds(props.shutter);
	if (props.aperture == null || t == null) return null;
	const over = Math.round((ev.value - Math.log2((props.aperture * props.aperture) / t)) * 3) / 3;
	if (Math.abs(over) < 0.34) return { tone: 'ok', text: 'right on the reading.' };
	const stops = `${formatEv(Math.abs(over))} ${Math.abs(over) > 1.2 ? 'stops' : 'stop'}`;
	if (over > 0) return over <= 2.4 ? { tone: 'ok', text: `${stops} over, fine on negative film.` } : { tone: 'warn', text: `${stops} over: close down or speed up.` };
	return { tone: over >= -0.7 ? 'warn' : 'bad', text: `${stops} under: open up or slow down.` };
});

/* ---------- long exposure ---------- */

const METERED = [1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 960];
const isLong = computed(() => props.shutter === 'B' || (shutterSeconds(props.shutter) ?? 0) >= 1 || (picks.value.slow?.seconds ?? 0) > 0.5);
const meteredIndex = ref(3);
const metered = computed(() => METERED[meteredIndex.value]);
const recip = computed(() => reciprocityFor(props.stock));
const corrected = computed(() => correctedSeconds(metered.value, recip.value));
// Start from what the light asks for.
watch(
	() => picks.value.slow?.seconds,
	(s) => {
		if (s && s >= 0.75) meteredIndex.value = METERED.reduce((best, m, i) => (Math.abs(Math.log2(m / s)) < Math.abs(Math.log2(METERED[best] / s)) ? i : best), 0);
	},
	{ immediate: true }
);

const running = ref(false);
const startedAt = ref(0);
const target = ref<number | null>(null);
const elapsed = ref(0);
const timerDone = ref('');
let tick: ReturnType<typeof setInterval> | undefined;
let audio: AudioContext | undefined;
let lastWhole = -1;

const timerText = computed(() => {
	const s = running.value ? (target.value != null ? Math.max(0, target.value - elapsed.value) : elapsed.value) : (target.value ?? corrected.value);
	const whole = Math.ceil(s - 1e-6);
	const m = Math.floor(whole / 60);
	return `${m}:${String(whole % 60).padStart(2, '0')}`;
});

function beep(freq: number, ms: number) {
	if (!audio) return;
	const osc = audio.createOscillator();
	const gain = audio.createGain();
	osc.frequency.value = freq;
	gain.gain.value = 0.08;
	osc.connect(gain).connect(audio.destination);
	osc.start();
	osc.stop(audio.currentTime + ms / 1000);
}

function startTimer(seconds: number | null) {
	try {
		audio ??= new AudioContext();
		// Phones start audio suspended until a tap; this is one.
		if (audio.state === 'suspended') void audio.resume();
	} catch {
		audio = undefined;
	}
	target.value = seconds;
	startedAt.value = performance.now();
	elapsed.value = 0;
	lastWhole = -1;
	timerDone.value = '';
	running.value = true;
	clearInterval(tick);
	tick = setInterval(() => {
		elapsed.value = (performance.now() - startedAt.value) / 1000;
		if (target.value == null) return;
		const left = target.value - elapsed.value;
		const whole = Math.ceil(left);
		if (whole !== lastWhole && whole <= 3 && whole > 0) {
			navigator.vibrate?.(30);
			beep(660, 60);
		}
		lastWhole = whole;
		if (left <= 0) {
			navigator.vibrate?.([200, 100, 200]);
			beep(880, 180);
			setTimeout(() => beep(880, 180), 260);
			timerDone.value = 'Time: close the shutter.';
			stopTimer();
		}
	}, 100);
}

function stopTimer() {
	clearInterval(tick);
	if (running.value && target.value == null) timerDone.value = `Stopped at ${formatSeconds(elapsed.value)}.`;
	running.value = false;
}

/* ---------- focus ---------- */

const focus = computed(() => {
	if (!props.focal || props.cameraKind === 'point-and-shoot') return null;
	const aperture = props.aperture ?? picks.value.picks[0]?.setting.aperture ?? 8;
	const coc = circleOfConfusion(props.stock.format);
	const H = hyperfocal(props.focal, aperture, coc);
	const zones = [1.5, 3, 5].filter((d) => d < H).map((at) => ({ at, ...depthOfField(props.focal!, aperture, coc, at) }));
	return { aperture, hyperfocal: H, zones };
});

const metres = (m: number) => (Number.isFinite(m) ? `${m < 10 ? Math.round(m * 10) / 10 : Math.round(m)} m` : '∞');
const feet = (m: number) => (Number.isFinite(m) ? `${Math.round(m * 3.28084)} ft` : '');

/* ---------- tabs ---------- */

type Tab = 'meter' | 'long' | 'focus' | 'sun';
const tab = ref<Tab>('meter');
const tabs = computed(() =>
	(
		[
			{ key: 'meter', label: 'Meter', short: 'Meter' },
			props.manual ? { key: 'long', label: 'Long exposure', short: 'Long exp.' } : null,
			focus.value ? { key: 'focus', label: 'Focus', short: 'Focus' } : null,
			{ key: 'sun', label: 'Sun', short: 'Sun' },
		] as ({ key: Tab; label: string; short: string } | null)[]
	).filter((t): t is { key: Tab; label: string; short: string } => !!t)
);
// A tab that no longer applies (another camera) falls back to the meter.
watch(tabs, (list) => {
	if (!list.some((t) => t.key === tab.value)) tab.value = 'meter';
});

/* ---------- lifecycle ---------- */

let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
	try {
		open.value = localStorage.getItem(OPEN_KEY) === '1';
	} catch {
		// Closed by default.
	}
	refreshSky();
	clockTimer = setInterval(() => (now.value = Date.now()), 30_000);
	window.addEventListener('online', refreshSky);
});
onBeforeUnmount(() => {
	clearInterval(clockTimer);
	clearInterval(tick);
	window.removeEventListener('online', refreshSky);
	audio?.close();
});
</script>

<style scoped>
.light {
	border: 1px solid var(--shoot-line);
	border-radius: 0.9rem;
	background: var(--shoot-panel);
	overflow: hidden;
}

.summary {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	min-height: 3.4rem;
	padding: 0.6rem 0.9rem;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.summary:focus-visible {
	outline: 2px solid var(--shoot-mark);
	outline-offset: -2px;
}

.glyph {
	flex: none;
	width: 1.4rem;
	height: 1.4rem;
	fill: none;
	stroke: var(--lab-edge-text, currentColor);
	stroke-width: 1.6;
}

.sum {
	display: grid;
	gap: 0.1rem;
	min-width: 0;
	flex: 1;
}

.sum-a {
	color: var(--shoot-ink);
	font-size: var(--text-sm);
	line-height: 1.3;
}

.sum-b {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--shoot-meta);
}

.chev {
	flex: none;
	width: 0.55rem;
	height: 0.55rem;
	border-right: 1.5px solid var(--shoot-meta);
	border-bottom: 1.5px solid var(--shoot-meta);
	rotate: 45deg;
	translate: 0 -0.15rem;
	transition: rotate 0.2s ease;
}

.open .chev {
	rotate: 225deg;
	translate: 0 0.1rem;
}

.drawer {
	display: grid;
	gap: 1rem;
	padding: 0.25rem 0.9rem 1rem;
	border-top: 1px solid var(--shoot-line);
	padding-top: 0.9rem;
}

.chips {
	display: flex;
	gap: 0.4rem;
	overflow-x: auto;
	scrollbar-width: none;
	margin-inline: -0.9rem;
	padding-inline: 0.9rem;
}

.chip {
	flex: none;
	min-height: 2.4rem;
	padding: 0.3rem 0.85rem;
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

.why,
.fine {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--shoot-meta);
}

.meter {
	display: grid;
	gap: 0.6rem;
}

.ev {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.75rem;
}

.ev b {
	font-family: var(--font-mono);
	font-size: 1.5rem;
	font-weight: 500;
	color: var(--shoot-ink);
	font-variant-numeric: tabular-nums;
}

.ev span {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--shoot-meta);
}

.picks {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
	gap: 0.4rem;
	list-style: none;
	padding: 0;
}

.pick {
	display: grid;
	gap: 0.15rem;
	width: 100%;
	min-height: 3.2rem;
	padding: 0.45rem 0.6rem;
	border: 1px solid var(--shoot-line);
	border-radius: 0.6rem;
	background: var(--shoot-bg);
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.pick[aria-pressed='true'] {
	border-color: var(--shoot-mark);
	box-shadow: inset 0 -2px 0 var(--shoot-mark);
}

.pl {
	font-size: 0.72rem;
	color: var(--shoot-meta);
}

.pv {
	font-family: var(--font-mono);
	font-size: 0.95rem;
	color: var(--shoot-ink);
	white-space: nowrap;
}

.pv small {
	margin-left: 0.35em;
	font-size: 0.7rem;
	color: var(--shoot-meta);
}

.note,
.check,
.long-text,
.focus p {
	font-size: var(--text-sm);
	line-height: 1.45;
}

.note.warn,
.check.warn {
	color: var(--lab-edge-text, var(--shoot-ink));
}

.note.bad,
.check.bad {
	color: var(--shoot-mark);
}

.check {
	font-family: var(--font-mono);
	font-size: 0.78rem;
}

h3 {
	font-family: var(--font-mono);
	font-size: 0.68rem;
	font-weight: 400;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--shoot-meta);
}

.long,
.focus {
	display: grid;
	gap: 0.6rem;
}

.tabs {
	display: flex;
	gap: 0.25rem;
	padding: 0.2rem;
	border-radius: 999px;
	background: var(--shoot-bg);
	overflow-x: auto;
	scrollbar-width: none;
}

.tab {
	position: relative;
	flex: 1 0 auto;
	min-height: 2.4rem;
	padding: 0.3rem 0.8rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--shoot-meta);
	font: inherit;
	font-size: var(--text-sm);
	white-space: nowrap;
	cursor: pointer;
}

.t-short {
	display: none;
}

/* A phone held narrow: shorter names, so all four tabs fit. */
@media (max-width: 25em) {
	.tab {
		padding-inline: 0.55rem;
	}

	.t-long {
		display: none;
	}

	.t-short {
		display: inline;
	}
}

.tab[aria-pressed='true'] {
	background: var(--shoot-btn);
	color: var(--shoot-btn-ink);
}

.tab-dot {
	position: absolute;
	top: 0.45rem;
	right: 0.4rem;
	width: 0.4rem;
	height: 0.4rem;
	border-radius: 50%;
	background: var(--shoot-mark);
}

.stepper {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.stepper .lbl {
	font-size: var(--text-sm);
	color: var(--shoot-meta);
}

.stepper b {
	min-width: 5.5rem;
	text-align: center;
	font-family: var(--font-mono);
	font-size: 1.05rem;
	color: var(--shoot-ink);
}

.step {
	width: 2.75rem;
	height: 2.75rem;
	border: 1px solid var(--shoot-line);
	border-radius: 50%;
	background: none;
	color: var(--shoot-ink);
	font: inherit;
	font-size: 1.2rem;
	cursor: pointer;
}

.step:disabled {
	opacity: 0.35;
}

.timer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.75rem 0.9rem;
	border-radius: 0.75rem;
	background: var(--shoot-window);
}

.clock {
	font-family: var(--font-mono);
	font-size: 2.4rem;
	line-height: 1;
	color: var(--shoot-window-ink);
	font-variant-numeric: tabular-nums;
}

.clock.running {
	color: var(--shoot-mark);
}

.timer-acts {
	display: flex;
	gap: 0.5rem;
}

.start {
	min-height: 2.75rem;
	padding: 0.4rem 1.1rem;
	border: 0;
	border-radius: 999px;
	background: var(--shoot-window-ink);
	color: var(--shoot-window);
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}

.timer .chip {
	border-color: oklch(40% 0.01 60);
	color: var(--shoot-window-ink);
}

.link {
	justify-self: start;
	min-height: 2.4rem;
	padding: 0;
	border: 0;
	background: none;
	color: var(--shoot-ink);
	font: inherit;
	font-size: var(--text-sm);
	text-decoration: underline;
	text-underline-offset: 0.2em;
	cursor: pointer;
}

.zones {
	border-collapse: collapse;
	font-family: var(--font-mono);
	font-size: 0.76rem;
}

.zones {
	width: 100%;
}

.zones th,
.zones td {
	padding: 0.4rem 0.75rem 0.4rem 0;
	text-align: left;
	font-weight: 400;
	vertical-align: top;
	border-bottom: 1px solid var(--shoot-line);
	white-space: nowrap;
}

.zones thead th {
	font-size: 0.66rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--shoot-meta);
}

.zones tbody th {
	color: var(--shoot-ink);
}

.zones small {
	display: block;
	font-size: 0.68rem;
	color: var(--shoot-meta);
}

.day {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
	gap: 0.5rem 1rem;
	list-style: none;
	padding: 0;
}

.day li {
	display: grid;
	font-size: 0.72rem;
	color: var(--shoot-meta);
}

.day time {
	font-family: var(--font-mono);
	font-size: 0.85rem;
	color: var(--shoot-ink);
}

.day li.past {
	opacity: 0.45;
}

@media (prefers-reduced-motion: reduce) {
	.chev {
		transition: none;
	}
}
</style>
