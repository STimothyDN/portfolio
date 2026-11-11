<script setup lang="ts">
/**
 * The trip planner. Where (a place name, looked up on Open-Meteo's geocoder),
 * when, and which cameras; then: each day's light (the forecast within 16
 * days, the sun's times every day), how much film at the pace you really
 * shoot, the speed mix that light asks for, which rolls in the fridge to pack
 * (one tap moves them to a "Trip" shelf), and what to check before leaving.
 */
import { actions } from 'astro:actions';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { cameraBatteries, type BatteryStockRow } from '../../../lib/lab/batteries';
import { run } from '../../../lib/lab/client';
import { formatExpiry, type CameraView, type RollView } from '../../../lib/lab/inventory';
import type { TripView } from '../../../lib/lab/server/darkroom';
import {
	BAND_LABEL,
	bandOf,
	filmNeed,
	INTENSITY,
	lightOf,
	packingList,
	parsePlan,
	pickRolls,
	speedMix,
	tripDates,
	weatherWord,
	type DayWeather,
	type Intensity,
	type SpeedBand,
} from '../../../lib/lab/trip';
import { sunDay } from '../../../scripts/sky/astro';

const props = defineProps<{
	fridge: RollView[];
	loaded: RollView[];
	cameras: CameraView[];
	batteries: BatteryStockRow[];
	perDay: number | null;
	trips: TripView[];
	today: string;
}>();

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const trips = ref<TripView[]>([...props.trips]);
const tripId = ref<string | null>(null);
const f = reactive({
	name: '',
	place: '',
	lat: null as number | null,
	lng: null as number | null,
	startOn: addDays(props.today, 7),
	endOn: addDays(props.today, 10),
	cameras: props.loaded.map((r) => r.camera?.id).filter((x): x is string => !!x).slice(0, 2),
	intensity: 'usual' as Intensity,
	evenings: true,
	flying: false,
});
const excluded = ref<string[]>([]);
const error = ref('');
const busy = ref(false);
const note = ref('');

/* ---------- where: a place name, looked up ---------- */

interface Place {
	name: string;
	admin1?: string;
	country?: string;
	latitude: number;
	longitude: number;
}
const results = ref<Place[]>([]);
const searching = ref(false);
async function findPlace() {
	const q = f.place.trim();
	if (q.length < 2) return;
	searching.value = true;
	error.value = '';
	try {
		const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`, { signal: AbortSignal.timeout(6000) });
		const json = (await res.json()) as { results?: Place[] };
		results.value = json.results ?? [];
		if (!results.value.length) error.value = 'No place by that name. Try the nearest town.';
	} catch {
		error.value = 'Couldn’t look that up (no signal?). The plan still works; the forecast needs the place.';
	} finally {
		searching.value = false;
	}
}
function pickPlace(p: Place) {
	f.place = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
	f.lat = Math.round(p.latitude * 100) / 100;
	f.lng = Math.round(p.longitude * 100) / 100;
	results.value = [];
	if (!f.name) f.name = p.name;
}

/* ---------- the forecast ---------- */

const weather = ref<DayWeather[]>([]);
const offset = ref<number | null>(null);
async function fetchForecast() {
	if (f.lat == null || f.lng == null) return;
	try {
		const params = new URLSearchParams({
			latitude: String(f.lat),
			longitude: String(f.lng),
			daily: 'weather_code,cloud_cover_mean,precipitation_probability_max,temperature_2m_max,temperature_2m_min',
			timezone: 'auto',
			forecast_days: '16',
		});
		const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
		const j = (await res.json()) as {
			utc_offset_seconds: number;
			daily: { time: string[]; weather_code: number[]; cloud_cover_mean: number[]; precipitation_probability_max: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
		};
		offset.value = j.utc_offset_seconds;
		weather.value = j.daily.time.map((date, i) => ({
			date,
			code: j.daily.weather_code[i] ?? null,
			cloud: j.daily.cloud_cover_mean?.[i] ?? null,
			rain: j.daily.precipitation_probability_max?.[i] ?? null,
			tMax: j.daily.temperature_2m_max?.[i] ?? null,
			tMin: j.daily.temperature_2m_min?.[i] ?? null,
		}));
	} catch {
		weather.value = [];
	}
}
watch(() => [f.lat, f.lng], fetchForecast);

/* ---------- the days ---------- */

const dates = computed(() => (f.endOn >= f.startOn ? tripDates(f.startOn, f.endOn) : []));
/** Destination time: the forecast's own offset, else one worked out from the longitude. */
const tz = computed(() => offset.value ?? Math.round(((f.lng ?? -79) / 15) * 2) / 2 * 3600);
const hm = (ms: number | null | undefined) => (ms == null ? '—' : new Date(ms + tz.value * 1000).toISOString().slice(11, 16));
const days = computed(() =>
	dates.value.map((date) => {
		const w = weather.value.find((x) => x.date === date) ?? null;
		const sun = f.lat != null && f.lng != null ? sunDay(Date.parse(`${date}T12:00:00Z`) - tz.value * 1000, f.lat, f.lng) : null;
		return {
			date,
			weekday: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
			day: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
			w,
			light: lightOf(w),
			sun,
		};
	})
);
const forecastFrom = computed(() => weather.value.at(-1)?.date ?? null);

/* ---------- film ---------- */

const going = computed(() => props.cameras.filter((c) => f.cameras.includes(c.id)));
const loadedIn = (camId: string) => props.loaded.find((r) => r.camera?.id === camId) ?? null;
const inCameras = computed(() => going.value.reduce((s, c) => s + Math.max(0, (loadedIn(c.id)?.exposures ?? 0) - (loadedIn(c.id)?.frameCount ?? 0)), 0));
const pace = computed(() => props.perDay ?? 12);
const perDay = computed(() => Math.max(1, Math.round(pace.value * INTENSITY[f.intensity] * Math.max(1, going.value.length * 0.75))));
const need = computed(() => filmNeed(dates.value.length, perDay.value, 36, inCameras.value));
const mix = computed(() => speedMix(days.value.map((d) => d.light), need.value.rolls, f.evenings));
const picks = computed(() => pickRolls(props.fridge, mix.value));
const packing = computed(() => picks.value.picked.filter((p) => !excluded.value.includes(p.roll.id)));
const box = computed(() => cameraBatteries(props.cameras, props.today));
const checks = computed(() =>
	packingList({
		cameras: going.value.map((c) => {
			const r = loadedIn(c.id);
			return { id: c.id, name: c.name, loaded: !!r, framesLeft: r ? r.exposures - r.frameCount : null };
		}),
		batteries: box.value,
		box: props.batteries,
		flying: f.flying,
		fastRolls: packing.value.filter((p) => (p.roll.shotAtIso ?? p.roll.stock.iso ?? 0) >= 800).length,
		days: dates.value.length,
	})
);
const BANDS: SpeedBand[] = ['slow', 'mid', 'fast'];
const shortText = computed(() =>
	BANDS.filter((b) => picks.value.short[b])
		.map((b) => `${picks.value.short[b]} × ${BAND_LABEL[b]}`)
		.join(', ')
);

/* ---------- saving and packing ---------- */

const planOut = () => ({ cameras: f.cameras, intensity: f.intensity, evenings: f.evenings, flying: f.flying, rolls: packing.value.map((p) => p.roll.id) });
async function save() {
	busy.value = true;
	error.value = '';
	try {
		const res = await run(
			actions.lab.saveTrip({ ...(tripId.value ? { id: tripId.value } : {}), name: f.name || f.place || 'Trip', place: f.place, lat: f.lat, lng: f.lng, startOn: f.startOn, endOn: f.endOn, plan: planOut() })
		);
		trips.value = res.trips;
		tripId.value = res.id;
		note.value = 'Saved.';
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
const bagName = computed(() => `Trip: ${(f.name || f.place || 'bag').slice(0, 50)}`);
async function pack() {
	if (!packing.value.length) return;
	busy.value = true;
	error.value = '';
	try {
		await run(actions.lab.moveRolls({ rollIds: packing.value.map((p) => p.roll.id), storageSpot: bagName.value }));
		note.value = `${packing.value.length} ${packing.value.length === 1 ? 'roll' : 'rolls'} moved to the “${bagName.value}” shelf in the fridge.`;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
function open(t: TripView) {
	const p = parsePlan(t.plan);
	tripId.value = t.id;
	Object.assign(f, { name: t.name, place: t.place ?? '', lat: t.lat, lng: t.lng, startOn: t.startOn, endOn: t.endOn });
	if (p) Object.assign(f, { cameras: p.cameras, intensity: p.intensity, evenings: p.evenings, flying: p.flying });
	note.value = '';
}
function fresh() {
	tripId.value = null;
	Object.assign(f, { name: '', place: '', lat: null, lng: null });
	weather.value = [];
	offset.value = null;
}
async function remove(t: TripView) {
	trips.value = await run(actions.lab.deleteTrip({ id: t.id }));
	if (tripId.value === t.id) fresh();
}
onMounted(() => {
	const upcoming = trips.value.find((t) => t.endOn >= props.today);
	if (upcoming) open(upcoming);
	void fetchForecast();
});
const LIGHT_WORD = { bright: 'Bright', mixed: 'Mixed', dim: 'Dim' } as const;
</script>

<template>
	<div class="trip">
		<nav v-if="trips.length" class="saved" aria-label="Saved trips">
			<button v-for="t in trips" :key="t.id" type="button" class="lab-btn lab-btn--quiet chip" :aria-pressed="tripId === t.id" @click="open(t)">
				{{ t.name }} <span class="lab-meta">{{ t.startOn.slice(5) }}</span>
			</button>
			<button type="button" class="lab-link" @click="fresh">New trip</button>
		</nav>

		<form class="where" @submit.prevent="findPlace">
			<label class="lab-field place">
				<span>Where</span>
				<span class="place-row">
					<input id="trip-place" v-model="f.place" class="lab-input" type="text" maxlength="160" placeholder="Kyoto, Big Sur, Asheville…" autocomplete="off" />
					<button type="submit" class="lab-btn lab-btn--quiet" :disabled="searching">{{ searching ? 'Looking…' : 'Find' }}</button>
				</span>
				<small v-if="f.lat != null" class="lab-hint">{{ f.lat.toFixed(2) }}, {{ f.lng?.toFixed(2) }} · only the place name is sent, to look it up</small>
			</label>
			<ul v-if="results.length" class="results">
				<li v-for="p in results" :key="`${p.latitude},${p.longitude}`">
					<button type="button" class="lab-link" @click="pickPlace(p)">{{ [p.name, p.admin1, p.country].filter(Boolean).join(', ') }}</button>
				</li>
			</ul>
			<label class="lab-field"><span>From</span><input id="trip-start" v-model="f.startOn" class="lab-input" type="date" required /></label>
			<label class="lab-field"><span>To</span><input id="trip-end" v-model="f.endOn" class="lab-input" type="date" required /></label>
			<label class="lab-field"><span>Call it</span><input id="trip-name" v-model="f.name" class="lab-input" type="text" maxlength="120" placeholder="Name (optional)" /></label>
		</form>

		<fieldset class="how">
			<legend>Bringing</legend>
			<label v-for="c in cameras" :key="c.id" class="cam-chip">
				<input :id="`trip-cam-${c.id}`" v-model="f.cameras" type="checkbox" :value="c.id" />
				<span>{{ c.name }}<small v-if="loadedIn(c.id)" class="lab-meta"> · {{ loadedIn(c.id)!.code }}, {{ loadedIn(c.id)!.exposures - loadedIn(c.id)!.frameCount }} left</small></span>
			</label>
			<div class="toggles">
				<span class="seg" role="group" aria-label="How much you'll shoot">
					<button v-for="k in (['light', 'usual', 'heavy'] as Intensity[])" :key="k" type="button" :aria-pressed="f.intensity === k" @click="f.intensity = k">
						{{ k === 'light' ? 'A little' : k === 'usual' ? 'As usual' : 'A lot' }}
					</button>
				</span>
				<label><input id="trip-evenings" v-model="f.evenings" type="checkbox" /> Shooting after dark</label>
				<label><input id="trip-flying" v-model="f.flying" type="checkbox" /> Flying</label>
			</div>
		</fieldset>

		<!-- The days: each one's light, from the forecast and the sun -->
		<section class="lab-section" aria-labelledby="days-h">
			<header class="sec-head">
				<h2 id="days-h" class="lab-h2">The days</h2>
				<span class="lab-meta">{{ dates.length }} {{ dates.length === 1 ? 'day' : 'days' }}{{ forecastFrom && f.endOn > forecastFrom ? ` · forecast up to ${forecastFrom.slice(5)}, sun times for every day` : '' }}</span>
			</header>
			<ol class="days">
				<li v-for="d in days" :key="d.date" class="day" :class="`l-${d.light}`">
					<span class="d-date"><b>{{ d.weekday }}</b> {{ d.day }}</span>
					<span class="d-sky">{{ d.w ? weatherWord(d.w.code) : 'No forecast yet' }}<template v-if="d.w?.tMax != null"> · {{ Math.round(d.w.tMin ?? 0) }}–{{ Math.round(d.w.tMax) }}°</template></span>
					<span class="d-light">{{ LIGHT_WORD[d.light] }}<template v-if="d.w?.rain != null && d.w.rain >= 30"> · {{ d.w.rain }}% rain</template></span>
					<span v-if="d.sun" class="d-sun lab-mono">
						<span title="Sunrise">↑ {{ hm(d.sun.sunrise) }}</span>
						<span title="Golden hour">✦ {{ hm(d.sun.goldenEvening?.[0]) }}</span>
						<span title="Sunset">↓ {{ hm(d.sun.sunset) }}</span>
					</span>
				</li>
			</ol>
			<p v-if="f.lat == null" class="lab-hint">Find the place to get its forecast and sun times.</p>
		</section>

		<!-- Film: how much, which speeds, which rolls -->
		<section class="lab-section film" aria-labelledby="film-h">
			<header class="sec-head">
				<h2 id="film-h" class="lab-h2">Film</h2>
			</header>
			<div class="need">
				<p class="big"><b>{{ need.rolls }}</b> {{ need.rolls === 1 ? 'roll' : 'rolls' }} to bring</p>
				<p class="lab-meta">
					About {{ perDay }} frames a day ({{ perDay > 0 && props.perDay ? `you shoot ~${props.perDay} on a day out` : 'a guess until you’ve logged a few days' }}{{ going.length > 1 ? `, ${going.length} cameras` : '' }}) × {{ dates.length }} days = {{ need.frames }} frames<template v-if="need.inCameras">, less {{ need.inCameras }} left in the cameras</template>, plus a spare roll.
				</p>
				<div class="mix" role="img" :aria-label="BANDS.map((b) => `${mix[b]} ${BAND_LABEL[b]}`).join(', ')">
					<span v-for="b in BANDS" v-show="mix[b]" :key="b" class="band" :class="`b-${b}`" :style="{ flexGrow: mix[b] }">
						<b>{{ mix[b] }}</b> {{ BAND_LABEL[b] }}
					</span>
				</div>
			</div>
			<ul v-if="picks.picked.length" class="picked">
				<li v-for="p in picks.picked" :key="p.roll.id">
					<label>
						<input :id="`trip-roll-${p.roll.code}`" type="checkbox" :checked="!excluded.includes(p.roll.id)" @change="excluded = excluded.includes(p.roll.id) ? excluded.filter((x) => x !== p.roll.id) : [...excluded, p.roll.id]" />
						<span class="lab-code">{{ p.roll.code }}</span>
						<span>{{ p.roll.stock.name }}</span>
						<span class="lab-meta">{{ [p.roll.expires ? `exp ${formatExpiry(p.roll.expires)}` : null, p.standIn ? `for ${BAND_LABEL[p.band]}` : null, p.roll.storageSpot].filter(Boolean).join(' · ') }}</span>
					</label>
				</li>
			</ul>
			<p v-if="shortText" class="lab-notice">The fridge is short: buy {{ shortText }}.</p>
			<div class="lab-actions">
				<button id="trip-pack" type="button" class="lab-btn" :disabled="busy || !packing.length" @click="pack">Pack these {{ packing.length }} into a “Trip” shelf</button>
				<button id="trip-save" type="button" class="lab-btn lab-btn--quiet" :disabled="busy || !dates.length" @click="save">{{ tripId ? 'Save changes' : 'Save the trip' }}</button>
				<button v-if="tripId" type="button" class="lab-link" @click="remove(trips.find((t) => t.id === tripId)!)">Delete trip</button>
			</div>
			<p v-if="note" class="lab-meta" role="status">{{ note }}</p>
			<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		</section>

		<!-- Before you go -->
		<section class="lab-section" aria-labelledby="pack-h">
			<header class="sec-head">
				<h2 id="pack-h" class="lab-h2">Before you go</h2>
			</header>
			<ul class="checks">
				<li v-for="c in checks" :key="c.key" :class="c.tone">
					<input :id="`trip-check-${c.key}`" type="checkbox" />
					<label :for="`trip-check-${c.key}`">{{ c.text }}</label>
				</li>
			</ul>
		</section>
	</div>
</template>

<style scoped>
.trip {
	display: grid;
	gap: clamp(1.5rem, 4vw, 2.5rem);
}

.saved {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
}

.chip[aria-pressed='true'] {
	box-shadow: 0 0 0 1.5px var(--gray-0);
}

.where {
	display: grid;
	grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
	gap: 0.75rem;
	align-items: start;
}

@media (max-width: 56em) {
	.where {
		grid-template-columns: 1fr 1fr;
	}

	.where .place,
	.results {
		grid-column: 1 / -1;
	}
}

.place-row {
	display: flex;
	gap: 0.4rem;
}

.place-row .lab-input {
	flex: 1;
	min-width: 0;
}

.results {
	grid-column: 1 / -1;
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 1rem;
	margin: -0.25rem 0 0;
	padding: 0;
	list-style: none;
}

.how {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 0.9rem;
	margin: 0;
	padding: 0.9rem 1rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.7rem;
}

legend {
	padding: 0 0.4rem;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.cam-chip {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	cursor: pointer;
}

.toggles {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 1rem;
	margin-left: auto;
	font-size: var(--text-sm);
}

.seg {
	display: inline-flex;
	padding: 2px;
	border: 1px solid var(--gray-700);
	border-radius: 999px;
}

.seg button {
	padding: 0.3rem 0.75rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	cursor: pointer;
}

.seg button[aria-pressed='true'] {
	background: var(--gray-0);
	color: var(--gray-999);
}

.sec-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.4rem 1rem;
}

/* The days: a contact strip of the trip, each frame lit by its forecast. */
.days {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(9.5rem, 1fr);
	gap: 4px;
	margin: 0;
	padding: 8px;
	overflow-x: auto;
	list-style: none;
	border-radius: 6px;
	background: oklch(16% 0.01 40);
	scrollbar-width: thin;
}

.day {
	--glow: oklch(80% 0.05 80);
	display: grid;
	gap: 0.2rem;
	padding: 0.65rem 0.7rem;
	border-radius: 3px;
	background: linear-gradient(180deg, color-mix(in oklch, var(--glow) 90%, white), var(--glow));
	color: oklch(20% 0.02 50);
	font-size: var(--text-sm);
}

.day.l-bright {
	--glow: oklch(91% 0.09 85);
}

.day.l-mixed {
	--glow: oklch(84% 0.03 230);
}

.day.l-dim {
	--glow: oklch(66% 0.03 250);
}

.d-light {
	font-size: 0.72rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.d-sun {
	display: flex;
	flex-wrap: wrap;
	gap: 0.2rem 0.55rem;
	font-size: 0.7rem;
}

.need {
	display: grid;
	gap: 0.5rem;
}

.big {
	margin: 0;
	font-size: var(--text-xl);
}

.big b {
	font-family: var(--font-mono);
	font-size: 2.2rem;
	font-weight: 500;
}

.mix {
	display: flex;
	gap: 2px;
	min-height: 2.4rem;
	border-radius: 4px;
	overflow: hidden;
}

.band {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	min-width: 5.5rem;
	padding: 0.3rem 0.7rem;
	font-size: var(--text-sm);
	color: oklch(18% 0.02 50);
	white-space: nowrap;
}

.band b {
	font-family: var(--font-mono);
}

.b-slow {
	background: oklch(88% 0.1 85);
}

.b-mid {
	background: oklch(84% 0.05 230);
}

.b-fast {
	background: oklch(72% 0.08 280);
}

.picked {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	gap: 0.35rem 1rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.picked label {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.5rem;
	cursor: pointer;
}

.checks {
	display: grid;
	gap: 0.45rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.checks li {
	display: flex;
	align-items: baseline;
	gap: 0.6rem;
}

.checks li.warn label {
	font-weight: 600;
}

.checks input:checked + label {
	text-decoration: line-through;
	opacity: 0.6;
}
</style>
