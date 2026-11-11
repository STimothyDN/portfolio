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
			<!-- The scene: what you're shooting, or Auto for the sky's reading -->
			<div class="scene-row">
				<button type="button" class="scene-btn" :aria-expanded="pickingScene" aria-controls="scene-grid" @click="pickingScene = !pickingScene">
					<span class="lbl">Scene</span>
					<b>{{ sceneKey === 'auto' ? `Auto · ${autoLabel}` : scene.label }}</b>
					<span class="chev" aria-hidden="true"></span>
				</button>
				<button v-if="sceneKey !== 'auto'" type="button" class="chip" @click="pickScene('auto')">Auto</button>
			</div>
			<div v-if="pickingScene" id="scene-grid" class="scene-grid">
				<button type="button" class="tile" :aria-pressed="sceneKey === 'auto'" @click="pickScene('auto')">Auto · {{ autoLabel }}</button>
				<section v-for="g in groupOrder" :key="g.key" :aria-label="g.label">
					<h4>{{ g.label }}</h4>
					<div class="tiles">
						<button v-for="s in g.scenes" :key="s.key" type="button" class="tile" :data-scene="s.key" :aria-pressed="sceneKey === s.key" @click="pickScene(s.key)">{{ s.label }}</button>
					</div>
				</section>
			</div>

			<!-- Take a reading: the phone's camera, then tap what to meter -->
			<div v-if="!scene.rule" class="take">
				<label class="take-btn" :class="{ busy: readingPhoto }">
					<input id="meter-camera" type="file" accept="image/*" capture="environment" class="file" :disabled="readingPhoto" @change="onPhoto" />
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" /><circle cx="12" cy="13" r="3.4" /></svg>
					<span class="take-text">
						<b>{{ readingPhoto ? 'Reading the photo…' : photo ? 'New reading' : 'Take a reading' }}</b>
						<small>{{ photo ? 'Photograph the scene again' : 'Photograph the scene, then tap what to meter' }}</small>
					</span>
				</label>
				<label class="take-alt">
					<input id="meter-library" type="file" accept="image/*" class="file" :disabled="readingPhoto" @change="onPhoto" />
					From photos
				</label>
			</div>
			<p v-else class="why">{{ scene.rule === 'moon' ? 'A phone can’t read the moon (a small bright disc in black): the Looney 11 rule is more reliable.' : 'Fireworks follow a rule, not a meter.' }}</p>
			<p v-if="photoError" class="note bad" role="alert">{{ photoError }}</p>

			<!-- The reading photo -->
			<div v-if="photo && !scene.rule" class="reading">
				<p class="prompt">
					<template v-if="region.kind === 'frame'">Tap what you want to meter, or drag across an area. In this scene, meter {{ scene.meter }}.</template>
					<template v-else>Metering {{ region.kind === 'spot' ? 'a spot' : 'an area' }}: say what it is below. Tap elsewhere to move it.</template>
				</p>
				<PhotoMeter ref="pm" :photo="photo" :region="region" :frame="lensFrame" :zones="showZones ? zones : null" :tag="tag" @region="setRegion" />
				<div class="finders" role="group" aria-label="Where to meter">
					<button type="button" class="chip" :aria-pressed="region.kind === 'frame'" @click="setRegion({ kind: 'frame' })">Whole frame</button>
					<button type="button" class="chip" @click="pm?.find('brightest')">Brightest detail</button>
					<button type="button" class="chip" @click="pm?.find('darkest')">Darkest detail</button>
					<button type="button" class="chip" :aria-pressed="showZones" @click="showZones = !showZones">Zones</button>
				</div>
				<div v-if="region.kind !== 'frame'" class="tones" role="group" aria-label="What you metered">
					<span class="lbl">It’s</span>
					<button v-for="t in TONES" :key="t.key" type="button" class="chip" :data-tone="t.key" :aria-pressed="tone === t.key" :title="t.like" @click="toneOverride = t.key">{{ t.label }}</button>
				</div>
				<p class="why">{{ sourceLine }}</p>
				<ZoneStrip :marks="advice.marks" :toe="advice.film.toe" :shoulder="advice.film.shoulder" :film="stock.name" />
			</div>
			<p v-else-if="!scene.rule" class="why">{{ whyLine }}</p>

			<!-- The meter -->
			<div class="meter">
				<p class="ev">
					<b>EV {{ formatEv(advice.base.ev) }}</b>
					<span>{{ evLine }}</span>
				</p>
				<p class="call">{{ advice.call }}</p>
				<ul v-if="manual && advice.fixed" class="picks">
					<li>
						<button type="button" class="pick" :aria-pressed="aperture === advice.fixed.aperture && shutter === 'B'" @click="emit('set', advice.fixed.aperture, 'B')">
							<span class="pl">{{ advice.fixed.label }}</span>
							<span class="pv"><span>{{ formatAperture(advice.fixed.aperture) }} ·</span> <span>B</span></span>
						</button>
					</li>
				</ul>
				<ul v-else-if="manual && picks.picks.length" class="picks">
					<li v-for="p in picks.picks" :key="p.label">
						<button type="button" class="pick" :aria-pressed="aperture === p.setting.aperture && shutter === p.setting.shutter" @click="emit('set', p.setting.aperture, p.setting.shutter)">
							<span class="pl">{{ p.label }}</span>
							<span class="pv"><span>{{ formatAperture(p.setting.aperture) }} ·</span> <span>{{ p.setting.shutter }}<small v-if="formatOff(p.setting.off)" :title="`${formatOff(p.setting.off)} stop from the reading`">{{ formatOff(p.setting.off) }}</small></span></span>
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

				<ul v-if="advice.notes.length" class="notes" aria-label="From the meter">
					<li v-for="n in advice.notes" :key="n.text" :class="n.tone">
						<span>{{ n.text }}</span>
						<button v-if="n.nudge" type="button" class="fix" @click="addNudge(n.nudge)">Give {{ signed(n.nudge) }}</button>
						<button v-if="n.filter" type="button" class="fix" @click="filter = n.filter">Use the {{ filterBy(n.filter).label.replace(/ \(.*\)/, '') }}</button>
					</li>
				</ul>

				<div v-if="advice.bracket" class="bracket" role="group" aria-label="Bracket">
					<span class="lbl">Bracket</span>
					<template v-for="b in advice.bracket" :key="b.label">
						<button v-if="b.aperture && b.shutter" type="button" class="chip" @click="emit('set', b.aperture, b.shutter)"><b>{{ b.label }}</b> {{ b.text }}</button>
						<span v-else class="chip static"><b>{{ b.label }}</b> {{ b.text }}</span>
					</template>
				</div>

				<details class="chain">
					<summary>How it adds up</summary>
					<ol>
						<li><span>{{ advice.base.label }} <small>{{ advice.base.from }}</small></span><b>EV {{ formatEv(advice.base.ev) }}</b></li>
						<li v-for="s in advice.steps" :key="s.label"><span>{{ s.label }}</span><b>{{ signed(s.stops) }}</b></li>
						<li class="total"><span>Expose for</span><b>EV {{ formatEv(advice.e100) }} at ISO 100 · EV {{ formatEv(advice.evIso) }} at ISO {{ iso }}</b></li>
					</ol>
				</details>

				<div class="adjust">
					<div class="stepper" role="group" aria-label="Adjust the exposure">
						<span class="lbl">Adjust</span>
						<button type="button" class="step" aria-label="A third of a stop less" :disabled="nudge <= -3" @click="addNudge(-1 / 3)">−</button>
						<b>{{ nudge ? signed(nudge) : '±0' }}</b>
						<button type="button" class="step" aria-label="A third of a stop more" :disabled="nudge >= 3" @click="addNudge(1 / 3)">+</button>
					</div>
					<label class="filter">
						<span class="lbl">Filter</span>
						<select id="light-filter" v-model="filter" class="sel">
							<option v-for="f in FILTERS" :key="f.key" :value="f.key">{{ f.label }}</option>
						</select>
					</label>
				</div>

				<details v-if="photo" class="cal">
					<summary>Calibrate this phone · {{ calibration ? signed(calibration) : '±0' }}</summary>
					<p>Phones differ by up to half a stop. If negatives from these readings come back thin, add a third; dense, take one off. One reading beside a handheld meter tells you exactly.</p>
					<div class="stepper" role="group" aria-label="Phone calibration">
						<button type="button" class="step" aria-label="Read a third darker" :disabled="calibration <= -1" @click="calibrate(-1 / 3)">−</button>
						<b>{{ calibration ? signed(calibration) : '±0' }}</b>
						<button type="button" class="step" aria-label="Read a third brighter" :disabled="calibration >= 1" @click="calibrate(1 / 3)">+</button>
					</div>
				</details>
				<div class="links">
					<button type="button" class="link" @click="noteIt">{{ noted ? 'Added to the frame note' : 'Add to the frame note' }}</button>
					<button v-if="photo" type="button" class="link" @click="clearPhoto">Clear the reading</button>
					<button v-if="manual && isLong" type="button" class="link" @click="tab = 'long'">Reciprocity and the bulb timer</button>
				</div>
			</div>

			<!-- How to shoot it -->
			<section v-if="tipScene" class="tips" :aria-label="`Shooting ${tipScene.label.toLowerCase()}`">
				<h3>Shooting {{ tipScene.label.toLowerCase() }}</h3>
				<ul>
					<li v-for="t in tipScene.tips" :key="t">{{ t }}</li>
				</ul>
			</section>
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
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { shutterSeconds } from '../../lib/lab/almanac';
import { formatAperture, formatComp } from '../../lib/lab/inventory';
import {
	autoExposureNote,
	circleOfConfusion,
	clock,
	correctedSeconds,
	depthOfField,
	formatDistance,
	formatEv,
	formatOff,
	formatSeconds,
	formatWait,
	hyperfocal,
	moonAt,
	readSky,
	reciprocityFor,
	sunReport,
} from '../../lib/lab/light';
import { advise, dialCheck, measure, signed, zoneName } from '../../lib/lab/meter/advise';
import { equivalent35, filmGate, FULL, lensBox, METER_OFFSET, readRegion, type Region } from '../../lib/lab/meter/luma';
import { readPhoto, type Photo } from '../../lib/lab/meter/photo';
import { autoScene, FILTERS, filterBy, GROUPS, sceneBy, SCENES, TONES, type LightContext, type ToneKey } from '../../lib/lab/meter/scenes';
import { skyAt, type SkyFetch } from '../../lib/lab/sky-weather';
import PhotoMeter from './meter/PhotoMeter.vue';
import ZoneStrip from './meter/ZoneStrip.vue';

const props = defineProps<{
	/** The speed the roll is rated at. */
	iso: number | null;
	/** The film's box speed. */
	boxIso?: number | null;
	/** Exposure compensation for the roll, in stops (+1 gives a stop more light). */
	comp?: number | null;
	stock: { name: string; brand: string | null; token: string | null; process: string; format: string };
	/** "2019-06": when the roll's film expires. */
	expires?: string | null;
	/** False for cameras that set exposure themselves. */
	manual: boolean;
	cameraKind: string | null;
	cameraName?: string | null;
	apertures: number[];
	widest: number | null;
	focal: number | null;
	aperture: number | null;
	shutter: string | null;
	coords: { lat: number; lng: number } | null;
	today?: string;
	/** How this camera's negatives come back against the same film elsewhere (+ thin). */
	lift?: number | null;
}>();
const emit = defineEmits<{ set: [aperture: number, shutter: string]; note: [text: string] }>();

const DURHAM = { lat: 35.99, lng: -78.9 };
const OPEN_KEY = 'lab-light-open';
const CAL_KEY = 'lab-meter-cal';

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

async function refreshSky() {
	sky.value = await skyAt(here.value.lat, here.value.lng);
	skyTried.value = true;
}
watch(() => `${here.value.lat},${here.value.lng}`, refreshSky);

/* ---------- the scene ---------- */

const sceneKey = ref('auto');
const pickingScene = ref(false);
const scene = computed(() => (sceneKey.value === 'auto' ? autoScene(reading.value, photoLight.value) : (sceneBy(sceneKey.value) ?? autoScene(reading.value, photoLight.value))));
/** What Auto is going by: the sky, or the photo's own light. */
const autoLabel = computed(() => (photoLight.value == null ? reading.value.label : photoLight.value < 10 ? 'low light in the photo' : 'daylight in the photo'));
const ctx = computed<LightContext>(() => ({ sky: reading.value, altitude: report.value.altitude, moon: moonAt(now.value, here.value.lat, here.value.lng) }));
const sceneLight = computed(() => scene.value.light(ctx.value));
function pickScene(key: string) {
	sceneKey.value = key;
	pickingScene.value = false;
	toneOverride.value = null;
}
/** Groups in the order the light suggests: night and indoors first after dark. */
const groupOrder = computed(() => {
	const order = reading.value.daylight ? GROUPS : [...GROUPS].sort((a, b) => Number(a.key === 'day' || a.key === 'low') - Number(b.key === 'day' || b.key === 'low'));
	return order.map((g) => ({ ...g, scenes: SCENES.filter((s) => s.group === g.key) }));
});
/** Auto has no tips of its own: borrow the scene the sky is closest to. */
const tipScene = computed(() => {
	if (sceneKey.value !== 'auto') return scene.value;
	const lit = photoLight.value;
	if (lit != null) return sceneBy(lit >= 14.5 ? 'sun' : lit >= 13.5 ? 'hazy' : lit >= 12.5 ? 'cloudy' : lit >= 11 ? 'overcast' : lit >= 8 ? 'interior' : lit >= 6 ? 'home' : 'citynight');
	const r = reading.value;
	const key = r.label === 'Golden hour' ? 'golden' : !r.daylight ? (r.label === 'Night' ? 'citynight' : 'blue') : r.ev >= 14.5 ? 'sun' : r.ev >= 13.5 ? 'hazy' : r.ev >= 12.5 ? 'cloudy' : 'overcast';
	return sceneBy(key);
});

/* ---------- a photo reading ---------- */

const photo = shallowRef<Photo | null>(null);
const readingPhoto = ref(false);
const photoError = ref('');
const region = ref<Region>({ kind: 'frame' });
const toneOverride = ref<ToneKey | null>(null);
const tone = computed<ToneKey>(() => toneOverride.value ?? scene.value.tone);
const showZones = ref(false);
const pm = ref<InstanceType<typeof PhotoMeter> | null>(null);
const calibration = ref(0);

async function onPhoto(e: Event) {
	const input = e.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) return;
	readingPhoto.value = true;
	photoError.value = '';
	try {
		const next = await readPhoto(file);
		if (photo.value) URL.revokeObjectURL(photo.value.url);
		photo.value = next;
		region.value = { kind: 'frame' };
		toneOverride.value = null;
	} catch (err) {
		photoError.value = (err as Error).message;
	} finally {
		readingPhoto.value = false;
	}
}
function setRegion(r: Region) {
	region.value = r;
}
function clearPhoto() {
	if (photo.value) URL.revokeObjectURL(photo.value.url);
	photo.value = null;
	region.value = { kind: 'frame' };
	showZones.value = false;
}
function calibrate(step: number) {
	calibration.value = Math.round(Math.max(-1, Math.min(1, calibration.value + step)) * 3) / 3;
	try {
		localStorage.setItem(CAL_KEY, String(calibration.value));
	} catch {
		// It holds for this visit.
	}
}

/** What the film camera sees, drawn on the phone's wider picture. */
const gate = computed(() => filmGate(props.stock.format, props.cameraName));
const lens35 = computed(() => (props.focal ? equivalent35(props.focal, gate.value) : null));
const lensFrame = computed(() => {
	const p = photo.value;
	if (!p?.exif?.focal35 || !lens35.value || !props.focal) return null;
	const f = lensBox(p.w, p.h, p.exif.focal35, lens35.value, gate.value);
	return { ...f, label: `${props.focal}mm` };
});
/** The photo's whole-frame light, when it carries the phone's exposure. */
const photoLight = computed(() => {
	const p = photo.value;
	if (!p?.camera) return null;
	return p.camera.ev + METER_OFFSET + calibration.value + readRegion(p.map, { kind: 'frame' }, lensFrame.value?.box ?? FULL).stops;
});
const measurement = computed(() => {
	const p = photo.value;
	if (!p || scene.value.rule) return null;
	return measure(p.map, region.value, lensFrame.value?.box ?? FULL, p.camera, sceneLight.value.ev, calibration.value);
});

/* ---------- the meter ---------- */

const isoGuessed = computed(() => !props.iso);
const iso = computed(() => props.iso ?? 400);
const filter = ref('none');
const nudge = ref(0);
function addNudge(n: number) {
	nudge.value = Math.round(Math.max(-3, Math.min(3, nudge.value + n)) * 3) / 3;
}
// A different roll starts from its own reading.
watch(
	() => props.stock.name,
	() => {
		nudge.value = 0;
		filter.value = 'none';
	}
);

const advice = computed(() =>
	advise({
		scene: scene.value,
		ctx: ctx.value,
		measured: measurement.value,
		tone: tone.value,
		stock: props.stock,
		boxIso: props.boxIso ?? null,
		iso: iso.value,
		comp: props.comp ?? 0,
		filter: filter.value,
		nudge: nudge.value,
		apertures: props.apertures,
		widest: props.widest,
		focal35: lens35.value,
		manual: props.manual,
		expires: props.expires ?? null,
		today: props.today ?? new Date().toISOString().slice(0, 10),
		focal: props.focal,
		lift: props.lift ?? null,
		age: photo.value ? (now.value - photo.value.at) / 60_000 : null,
	})
);
/** The reading in a few words, for the frame's note. */
const noteText = computed(() => {
	const a = advice.value;
	const first = a.fixed ?? a.picks.picks[0]?.setting;
	return `${a.base.label}, EV ${formatEv(a.base.ev)}${first ? ` → ${formatAperture(first.aperture)} ${first.shutter}` : ''}`;
});
const noted = ref(false);
function noteIt() {
	emit('note', noteText.value);
	noted.value = true;
	setTimeout(() => (noted.value = false), 2500);
}
const picks = computed(() => advice.value.picks);
const autoNote = computed(() => autoExposureNote(advice.value.evIso, iso.value, props.widest ?? 3.5));
const check = computed(() => dialCheck(advice.value.evIso, props.aperture, props.shutter, advice.value.film.kind === 'slide'));
const caveat = computed(() => (sceneKey.value === 'auto' && !photo.value ? reading.value.caveat : null));

const conditionLabel = computed(() => (photo.value && !scene.value.rule ? 'Photo reading' : sceneKey.value === 'auto' ? reading.value.label : scene.value.label));
const evLine = computed(() => {
	const how = advice.value.rule ? `Sunny 16: ${advice.value.rule} at 1/${iso.value}` : measurement.value ? (measurement.value.kind === 'frame' ? 'whole frame' : 'metered') : 'at ISO 100';
	return `${how} · ISO ${iso.value}${isoGuessed.value ? ' (guessed)' : ''}${props.comp ? ` · settings include your ${formatComp(props.comp)}` : ''}`;
});
const whyLine = computed(() => {
	if (sceneKey.value !== 'auto') return `${scene.value.label}: from the ${sceneLight.value.from}. Auto goes back to the sky’s reading.`;
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
const sourceLine = computed(() => {
	const p = photo.value;
	const m = measurement.value;
	if (!p || !m) return '';
	const x = p.exif;
	const parts: string[] = [];
	if (m.from === 'settings' && x?.exposureTime && x.fNumber && x.iso)
		parts.push(`Phone at ${x.exposureTime < 0.4 ? `1/${Math.round(1 / x.exposureTime)}` : formatSeconds(x.exposureTime)}, f/${Math.round(x.fNumber * 10) / 10}, ISO ${Math.round(x.iso)}`);
	else if (m.from === 'brightness') parts.push('From the phone’s light reading');
	else parts.push(`No exposure data in this photo: pinned to the ${sceneLight.value.from}`);
	if (lensFrame.value) parts.push(lensFrame.value.wider ? `your ${props.focal}mm sees wider than the phone` : `${props.focal}mm frame drawn`);
	if (calibration.value) parts.push(`calibrated ${signed(calibration.value)}`);
	return parts.join(' · ');
});
const tag = computed(() => {
	const m = measurement.value;
	if (!m || m.kind === 'frame') return '';
	const at = advice.value.marks.find((k) => k.key === 'metered')?.at ?? 0;
	return `EV ${formatEv(m.ev)}${m.bound === 'at-least' ? '+' : m.bound === 'at-most' ? '−' : ''} · ${zoneName(at)}`;
});
const zones = computed(() => (measurement.value ? { offset: measurement.value.level - advice.value.e100, lat: { toe: advice.value.film.toe, shoulder: advice.value.film.shoulder } } : null));

const summaryB = computed(() => {
	const ev = formatEv(advice.value.base.ev);
	if (!props.manual) return autoNote.value.text;
	if (advice.value.fixed) return `${formatAperture(advice.value.fixed.aperture)} on bulb, tripod`;
	const first = picks.value.picks[0];
	if (first) return `EV ${ev} · ${formatAperture(first.setting.aperture)} at ${first.setting.shutter} for ISO ${iso.value}`;
	if (picks.value.slow) return `EV ${ev} · ${formatAperture(picks.value.slow.aperture)} needs ${formatSeconds(picks.value.slow.seconds)}`;
	return `EV ${ev} for ISO ${iso.value}`;
});

/* ---------- long exposure ---------- */

const METERED = [1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 960];
const isLong = computed(() => props.shutter === 'B' || (shutterSeconds(props.shutter) ?? 0) >= 1 || (picks.value.slow?.seconds ?? 0) > 0.5 || !!advice.value.fixed);
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
		const cal = Number(localStorage.getItem(CAL_KEY));
		if (Number.isFinite(cal)) calibration.value = Math.max(-1, Math.min(1, cal));
	} catch {
		// Closed by default, uncalibrated.
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
	if (photo.value) URL.revokeObjectURL(photo.value.url);
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
}

/* Aperture and shutter each stay whole; a narrow card puts the shutter under. */
.pv > span {
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

/* ---------- scene ---------- */

.scene-row {
	display: flex;
	gap: 0.4rem;
	align-items: stretch;
}

.scene-btn {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 0.6rem;
	min-width: 0;
	min-height: 2.75rem;
	padding: 0.3rem 0.9rem;
	border: 1px solid var(--shoot-line);
	border-radius: 999px;
	background: var(--shoot-bg);
	color: var(--shoot-ink);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.scene-btn .lbl,
.lbl {
	font-size: 0.72rem;
	letter-spacing: 0.06em;
	font-variant-caps: all-small-caps;
	color: var(--shoot-meta);
}

.scene-btn b {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 500;
}

.scene-btn[aria-expanded='true'] .chev {
	rotate: 225deg;
	translate: 0 0.1rem;
}

.scene-grid {
	display: grid;
	gap: 0.7rem;
	padding: 0.75rem;
	border-radius: 0.75rem;
	background: var(--shoot-bg);
}

.scene-grid h4 {
	margin-bottom: 0.3rem;
	font-size: 0.72rem;
	font-weight: 400;
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--shoot-meta);
}

.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr));
	gap: 0.35rem;
}

.tile {
	min-height: 2.75rem;
	padding: 0.35rem 0.7rem;
	border: 1px solid var(--shoot-line);
	border-radius: 0.55rem;
	background: var(--shoot-panel);
	color: var(--shoot-body);
	font: inherit;
	font-size: var(--text-sm);
	text-align: left;
	cursor: pointer;
}

.tile[aria-pressed='true'] {
	border-color: var(--shoot-btn);
	background: var(--shoot-btn);
	color: var(--shoot-btn-ink);
}

/* ---------- take a reading ---------- */

.take {
	display: flex;
	gap: 0.5rem;
	align-items: stretch;
}

.take-btn,
.take-alt {
	position: relative;
	display: flex;
	align-items: center;
	border-radius: 0.8rem;
	cursor: pointer;
}

.take-btn {
	flex: 1;
	gap: 0.75rem;
	min-height: 3.6rem;
	padding: 0.55rem 0.9rem;
	background: var(--shoot-btn);
	color: var(--shoot-btn-ink);
}

.take-btn svg {
	flex: none;
	width: 1.6rem;
	height: 1.6rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.6;
	stroke-linejoin: round;
}

.take-btn.busy {
	opacity: 0.7;
	cursor: progress;
}

.take-text {
	display: grid;
	gap: 0.05rem;
}

.take-text b {
	font-weight: 600;
}

.take-text small {
	font-size: 0.72rem;
	opacity: 0.85;
}

.take-alt {
	flex: none;
	padding: 0 0.9rem;
	border: 1px solid var(--shoot-line);
	color: var(--shoot-ink);
	font-size: var(--text-sm);
}

.take-btn:focus-within,
.take-alt:focus-within {
	outline: 2px solid var(--shoot-mark);
	outline-offset: 2px;
}

/* The file inputs stay in the page (keyboard, screen readers) but out of sight. */
.file {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	overflow: hidden;
	clip-path: inset(50%);
}

/* ---------- the reading ---------- */

.reading {
	display: grid;
	gap: 0.6rem;
}

.prompt {
	font-size: var(--text-sm);
	line-height: 1.4;
	color: var(--shoot-ink);
}

.finders,
.tones,
.bracket {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
}

.finders .chip {
	min-height: 2.4rem;
}

.tones {
	gap: 0.3rem;
}

.tones .chip {
	min-height: 2.25rem;
	padding: 0.2rem 0.7rem;
	font-size: 0.8rem;
}

.call {
	font-size: var(--text-sm);
	line-height: 1.45;
	color: var(--shoot-ink);
}

.notes {
	display: grid;
	gap: 0.45rem;
	list-style: none;
	padding: 0;
}

.notes li {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.3rem 0.6rem;
	padding-left: 0.75rem;
	border-left: 2px solid var(--shoot-line);
	font-size: var(--text-sm);
	line-height: 1.45;
}

.notes li.ok {
	border-color: var(--shoot-btn);
}

.notes li.warn {
	border-color: var(--lab-edge-text, var(--shoot-ink));
	color: var(--shoot-ink);
}

.notes li.bad {
	border-color: var(--shoot-mark);
	color: var(--shoot-ink);
}

.fix {
	min-height: 2.2rem;
	padding: 0.2rem 0.75rem;
	border: 1px solid var(--shoot-ink);
	border-radius: 999px;
	background: none;
	color: var(--shoot-ink);
	font: inherit;
	font-size: 0.78rem;
	cursor: pointer;
}

.bracket .chip {
	font-family: var(--font-mono);
	font-size: 0.75rem;
}

.bracket .chip b {
	font-weight: 600;
	margin-right: 0.25rem;
}

.chip.static {
	display: inline-flex;
	align-items: center;
	cursor: default;
}

.chain,
.cal {
	font-size: var(--text-sm);
}

.chain summary,
.cal summary {
	min-height: 2.4rem;
	display: flex;
	align-items: center;
	color: var(--shoot-ink);
	cursor: pointer;
}

.chain ol {
	display: grid;
	gap: 0.3rem;
	list-style: none;
	padding: 0.25rem 0 0;
}

.chain li {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	font-size: 0.78rem;
}

.chain li small {
	display: block;
	color: var(--shoot-meta);
	font-size: 0.7rem;
}

.chain li b {
	flex: none;
	font-family: var(--font-mono);
	font-weight: 400;
	color: var(--shoot-ink);
	text-align: right;
}

.chain li.total {
	padding-top: 0.3rem;
	border-top: 1px solid var(--shoot-line);
}

.chain li.total {
	flex-direction: column;
	gap: 0.15rem;
}

.chain li.total b {
	font-weight: 600;
	text-align: left;
}

.adjust {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem 1rem;
}

.adjust .stepper b,
.cal .stepper b {
	min-width: 3rem;
}

.filter {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.sel {
	min-height: 2.6rem;
	max-width: 11rem;
	padding: 0.3rem 0.6rem;
	border: 1px solid var(--shoot-line);
	border-radius: 0.5rem;
	background: var(--shoot-bg);
	color: var(--shoot-ink);
	font: inherit;
	font-size: var(--text-sm);
}

.cal p {
	margin-bottom: 0.4rem;
	color: var(--shoot-body);
	line-height: 1.45;
}

.links {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem 1.25rem;
}

/* ---------- tips ---------- */

.tips {
	display: grid;
	gap: 0.4rem;
	padding: 0.75rem 0.9rem;
	border-radius: 0.75rem;
	background: var(--shoot-bg);
}

.tips h3 {
	font-family: inherit;
	font-size: 0.8rem;
	text-transform: none;
	letter-spacing: 0.06em;
	font-variant-caps: all-small-caps;
}

.tips ul {
	display: grid;
	gap: 0.35rem;
	padding-left: 1.1rem;
	font-size: var(--text-sm);
	line-height: 1.45;
}

@media (prefers-reduced-motion: reduce) {
	.chev {
		transition: none;
	}
}
</style>
