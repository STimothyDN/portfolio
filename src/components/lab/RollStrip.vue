<template>
	<section class="strip-wrap" :class="[mode, { 'no-scans': !scans }]" :style="baseVars" aria-label="The roll as a strip of film">
		<header class="strip-head">
			<span class="lab-edge-print">{{ headline }}</span>
			<!-- Line the logbook up with the lab's scans -->
			<div v-if="scans && frames.length" class="align" role="group" aria-label="Line up frames with scans">
				<span>Scan 1 is frame</span>
				<button type="button" aria-label="Earlier frame" :disabled="firstScanFrame <= -1" @click="emit('shift', firstScanFrame - 1)">‹</button>
				<b>{{ firstScanFrame === -1 ? '00' : firstScanFrame }}</b>
				<button type="button" aria-label="Later frame" :disabled="firstScanFrame >= 10" @click="emit('shift', firstScanFrame + 1)">›</button>
				<span class="matched">{{ matchedCount }} of {{ frames.length }} logged frames line up</span>
			</div>
			<div v-if="scans" class="mode" role="group" aria-label="Show the frames as">
				<button type="button" :aria-pressed="mode === 'negative'" @click="mode = 'negative'">Negative</button>
				<button type="button" :aria-pressed="mode === 'positive'" @click="mode = 'positive'">Positive</button>
			</div>
		</header>

		<!-- The Negative look: one filter per exposure, from the film desk's own model (negative.ts). -->
		<svg v-if="scans && profile" class="filters" aria-hidden="true" focusable="false">
			<filter v-for="f in filters" :id="f.id" :key="f.id" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
				<feColorMatrix v-if="f.mono" type="saturate" values="0" />
				<feComponentTransfer>
					<feFuncR type="table" :tableValues="f.density[0]" />
					<feFuncG type="table" :tableValues="f.density[1]" />
					<feFuncB type="table" :tableValues="f.density[2]" />
				</feComponentTransfer>
				<feColorMatrix type="matrix" :values="f.matrix" />
				<feComponentTransfer>
					<feFuncR type="table" :tableValues="f.transmit[0]" />
					<feFuncG type="table" :tableValues="f.transmit[1]" />
					<feFuncB type="table" :tableValues="f.transmit[2]" />
				</feComponentTransfer>
			</filter>
		</svg>

		<!-- A sleeve page: the roll cut into strips of six, as the lab hands them back. Tap a frame to look closer. -->
		<div class="sleeve-page" :aria-label="scans ? `${scans.length} scans, in strips of six` : 'Frames on this roll'">
			<template v-if="scans">
				<div v-for="(row, ri) in rows" :key="ri" class="strip" :style="{ '--ri': ri, '--n': row.length }">
					<button
						v-for="s in row"
						:key="s.frame"
						type="button"
						class="frame"
						:class="{ matched: aligned.has(s.file), keeper: isKeeper(s), reject: isReject(s) }"
						:style="{ '--ar': s.w && s.h ? `${s.w} / ${s.h}` : '3 / 2' }"
						:aria-label="`Frame ${edgeNo(s.file, s.frame - 1)}${aligned.has(s.file) ? `, ${formatExposure(aligned.get(s.file)!)}` : ''}: look closer`"
						@click="focus = s"
					>
						<span class="edge" aria-hidden="true">{{ edgeNo(s.file, s.frame - 1) }} <span class="arrow">▸</span> {{ edgeNo(s.file, s.frame - 1) }}A</span>
						<span class="img">
							<img :src="s.src" alt="" loading="lazy" decoding="async" :width="s.w" :height="s.h" />
							<img
								v-if="profile"
								class="neg"
								:src="s.src"
								alt=""
								loading="lazy"
								decoding="async"
								:width="s.w"
								:height="s.h"
								:style="{ filter: `url(#${negativeFilterId(profile, s.exposure)})` }"
							/>
							<span v-if="isKeeper(s)" class="mark" aria-hidden="true"></span>
							<span v-else-if="isReject(s)" class="cross" aria-hidden="true"></span>
						</span>
						<span v-if="frames.length" class="exp" aria-hidden="true"><template v-for="(part, i) in expParts(aligned.has(s.file) ? formatExposure(aligned.get(s.file)!) : '')" :key="i"><span v-if="i" class="sr-only"> · </span><span>{{ part }}</span></template></span>
					</button>
				</div>
			</template>
			<template v-else>
				<div v-for="(row, ri) in latentRows" :key="ri" class="strip latent-strip" :style="{ '--ri': ri, '--n': row.length }">
					<div v-for="n in row" :key="n" class="frame" :class="{ shot: logged.has(n) }">
						<span class="edge">{{ n }} <span class="arrow">▸</span> {{ n }}A</span>
						<span class="img"><span class="latent-img"></span></span>
						<span class="exp"><template v-for="(part, i) in expParts(logged.get(n) ?? '')" :key="i"><span v-if="i" class="sr-only"> · </span><span>{{ part }}</span></template></span>
					</div>
				</div>
			</template>
		</div>

		<!-- One frame, close: the scan, what it was shot at, when, and how dense the negative came back. -->
		<LabDialog :open="!!focus" :title="focus ? `Frame ${edgeNo(focus.file, focus.frame - 1)} · ${code}` : ''" wide @close="focus = null">
			<div v-if="focus" class="focus">
				<a class="focus-img" :href="focus.full" target="_blank" rel="noopener" :style="{ '--ar': focus.w && focus.h ? `${focus.w} / ${focus.h}` : '3 / 2' }">
					<img :src="focus.full" :srcset="`${focus.src} 360w, ${focus.full} 2400w`" sizes="(max-width: 50em) 92vw, 46rem" alt="" decoding="async" />
				</a>
				<dl class="focus-facts">
					<div v-if="focusFrame">
						<dt>Shot at</dt>
						<dd>{{ formatExposure(focusFrame) }}</dd>
					</div>
					<div v-if="focusFrame && focusFrame.shotAt">
						<dt>When</dt>
						<dd>{{ frameTime(focusFrame, true) }}</dd>
					</div>
					<div v-if="focusFrame?.note">
						<dt>Note</dt>
						<dd>{{ focusFrame.note }}</dd>
					</div>
					<div v-if="focus.tone" class="gauge-row">
						<dt>Negative</dt>
						<dd>
							<span class="gauge" :title="`Black point ${focus.tone[0].toFixed(2)}, white point ${focus.tone[2].toFixed(2)}`">
								<i :style="{ left: `${focus.tone[0] * 100}%`, right: `${100 - focus.tone[2] * 100}%` }"></i>
								<b :style="{ left: `${focus.tone[1] * 100}%` }"></b>
							</span>
							<small>{{ focus.tone[0] >= 0.15 ? 'flat scan: a thin negative, likely underexposed' : focus.tone[0] <= 0.03 ? 'deep blacks: a dense negative' : 'a healthy range' }}</small>
						</dd>
					</div>
					<div>
						<dt>Scan</dt>
						<dd>{{ focus.frame }} of {{ scans?.length }}<template v-if="isKeeper(focus)"> · a keeper</template></dd>
					</div>
				</dl>
				<div v-if="rollId" class="pencil" role="group" aria-label="Mark this frame (keys 1–5, X, 0)">
					<span class="pencil-label">Mark</span>
					<button type="button" class="reject" :aria-pressed="marks[focus.file] === -1" title="Reject (X)" @click="mark(focus, marks[focus.file] === -1 ? null : -1)">✕</button>
					<button v-for="n in 5" :key="n" type="button" :aria-pressed="(marks[focus.file] ?? 0) >= n" :title="`${n} (${n >= 4 ? 'a keeper' : 'not a keeper'})`" @click="mark(focus, marks[focus.file] === n ? null : n)">{{ n }}</button>
					<span class="pencil-note">{{ marks[focus.file] == null ? `uploaded as ${focus.priority ?? 3}★` : marks[focus.file] === -1 ? 'rejected' : `${marks[focus.file]}★${(marks[focus.file] ?? 0) >= 4 ? ' · a keeper' : ''}` }}</span>
					<p v-if="markError" class="lab-error" role="alert">{{ markError }}</p>
				</div>
				<div class="focus-nav">
					<button type="button" class="lab-btn lab-btn--quiet" :disabled="focusIndex <= 0" @click="step(-1)">← Previous</button>
					<a class="lab-link" :href="focus.full" target="_blank" rel="noopener">Full size</a>
					<button type="button" class="lab-btn lab-btn--quiet" :disabled="focusIndex >= (scans?.length ?? 0) - 1" @click="step(1)">Next →</button>
				</div>
			</div>
		</LabDialog>
	</section>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { alignScans } from '../../lib/lab/alignment';
import LabDialog from './LabDialog.vue';
import { formatExposure, frameTime } from '../../lib/lab/inventory';
import { negativeBaseVars, negativeFilter, negativeFilterId, type NegativeProfileKey } from '../film/negative';

interface Scan {
	file: string;
	src: string;
	full: string;
	frame: number;
	w?: number;
	h?: number;
	exposure: number;
	tone?: [number, number, number] | null;
	keeper?: boolean;
	mark?: number | null;
	priority?: number;
}

const props = defineProps<{
	code: string;
	stockName: string;
	profile: NegativeProfileKey | null;
	scans: Scan[] | null;
	frames: { number: number; aperture: number | null; shutter: string | null; flash: boolean; scanFilename?: string | null; shotAt?: number; tzOffset?: number; note?: string | null }[];
	exposures: number;
	firstScanFrame: number;
	rollId?: string;
}>();
const emit = defineEmits<{ shift: [firstScanFrame: number]; marked: [keepers: number] }>();

const aligned = computed(() => (props.scans ? alignScans(props.scans.map((s) => s.file), props.frames, props.firstScanFrame) : new Map()));
const matchedCount = computed(() => aligned.value.size);
/** Edge numbers are frame numbers: the lab's first scan is frame `firstScanFrame` (00 prints as 00). */
const edgeNo = (file: string, i: number) => {
	const n = aligned.value.get(file)?.number ?? props.firstScanFrame + i;
	return n === -1 ? '00' : String(n);
};

/* Scans open as negatives and print through to positives once (developing); then it's your call. */
const mode = ref<'negative' | 'positive'>(props.scans ? 'negative' : 'positive');
/** Strips of six, as a lab cuts a roll for its sleeve. */
const rows = computed(() => {
	const list = props.scans ?? [];
	return Array.from({ length: Math.ceil(list.length / 6) }, (_, i) => list.slice(i * 6, i * 6 + 6));
});
// Before scans, the frames are smaller: twelve to a strip (two of six), just enough to show what's been shot.
const latentRows = computed(() => Array.from({ length: Math.ceil(props.exposures / 12) }, (_, i) => Array.from({ length: Math.min(12, props.exposures - i * 12) }, (_, k) => i * 12 + k + 1)));

const focus = ref<Scan | null>(null);
const focusIndex = computed(() => (focus.value && props.scans ? props.scans.findIndex((s) => s.file === focus.value!.file) : -1));
const focusFrame = computed(() => (focus.value ? (aligned.value.get(focus.value.file) as (typeof props.frames)[number] | undefined) ?? null : null));
/*
 * Grease pencil: marks you make on the contact sheet (1–5, ✕ for a reject)
 * override the rating a scan was uploaded with. Keys in the close-up: 1–5, X,
 * 0 to rub out, ← → to move along the roll.
 */
const marks = ref<Record<string, number | null>>(Object.fromEntries((props.scans ?? []).map((s) => [s.file, s.mark ?? null])));
const markError = ref('');
const standingOf = (s: Scan) => {
	const m = marks.value[s.file];
	return m == null ? (s.priority ?? (s.keeper ? 4 : 3)) : m < 0 ? 0 : m;
};
const isKeeper = (s: Scan) => standingOf(s) >= 4;
const isReject = (s: Scan) => marks.value[s.file] === -1;
async function mark(s: Scan, value: number | null) {
	if (!props.rollId) return;
	const before = marks.value[s.file];
	marks.value = { ...marks.value, [s.file]: value };
	markError.value = '';
	try {
		const { error } = await actions.lab.markScan({ rollId: props.rollId, filename: s.file, mark: value });
		if (error) throw new Error(error.message);
		emit('marked', (props.scans ?? []).filter(isKeeper).length);
	} catch (e) {
		marks.value = { ...marks.value, [s.file]: before ?? null };
		markError.value = (e as Error).message || 'Couldn’t save that mark.';
	}
}
function onFocusKey(e: KeyboardEvent) {
	if (!focus.value || (e.target as HTMLElement).closest('input, textarea, select')) return;
	if (e.key === 'ArrowRight') step(1);
	else if (e.key === 'ArrowLeft') step(-1);
	else if (/^[1-5]$/.test(e.key)) mark(focus.value, Number(e.key));
	else if (e.key === 'x' || e.key === 'X') mark(focus.value, -1);
	else if (e.key === '0' || e.key === 'Backspace') mark(focus.value, null);
	else return;
	e.preventDefault();
}
onBeforeUnmount(() => removeEventListener('keydown', onFocusKey));
watch(focus, (f, was) => {
	if (f && !was) addEventListener('keydown', onFocusKey);
	if (!f && was) removeEventListener('keydown', onFocusKey);
});

function step(d: number) {
	const list = props.scans ?? [];
	const i = focusIndex.value + d;
	if (i >= 0 && i < list.length) focus.value = list[i];
}

const filters = computed(() => {
	if (!props.scans || !props.profile) return [];
	const seen = new Set<number>();
	return props.scans.filter((s) => !seen.has(s.exposure) && seen.add(s.exposure)).map((s) => negativeFilter(props.profile!, s.exposure));
});
const baseVars = computed(() => (props.profile ? negativeBaseVars(props.profile) : {}));
const logged = computed(() => new Map(props.frames.map((f) => [f.number, formatExposure(f)])));
/** "f/8 · 1/125" → ["f/8", "1/125"], so a narrow frame can wrap between them. */
const expParts = (line: string) => (line ? line.split(' · ') : []);
const headline = computed(() =>
	props.scans
		? `${props.code} · ${props.stockName} · ${props.scans.length} scans`
		: `${props.code} · ${props.stockName} · ${logged.value.size} of ${props.exposures} frames logged`
);

onMounted(() => {
	if (!props.scans) return;
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		mode.value = 'positive';
		return;
	}
	setTimeout(() => (mode.value = 'positive'), 1400);
});
</script>

<style scoped>
.strip-wrap {
	--base: var(--lab-film);
	--rail: var(--lab-film);
	--ink: var(--lab-edge-ink);
	display: grid;
	gap: 0.6rem;
	min-width: 0;
}

/* As negatives, the strip takes on the stock's own base: orange for color film, gray for black-and-white. */
.strip-wrap.negative {
	--base: var(--stock-frame, var(--lab-film));
	--rail: var(--stock-rail, var(--lab-film));
	--ink: var(--stock-ink, var(--lab-edge-ink));
}

.strip-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem 1rem;
}

.align {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.align button {
	width: 1.9rem;
	height: 1.9rem;
	border: 1px solid var(--gray-700);
	border-radius: 50%;
	background: none;
	color: var(--gray-0);
	cursor: pointer;
}

.align button:disabled {
	opacity: 0.35;
	cursor: default;
}

.align button:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.align b {
	min-width: 1.6rem;
	font-family: var(--font-mono);
	color: var(--gray-0);
	text-align: center;
}

.matched {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--lab-edge-text);
}

.mode {
	display: inline-flex;
	padding: 0.2rem;
	border-radius: 999px;
	box-shadow: inset 0 0 0 1px var(--gray-700);
}

.mode button {
	min-height: 2rem;
	padding: 0 0.85rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-300);
	font: inherit;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	cursor: pointer;
}

.mode button[aria-pressed='true'] {
	background: var(--accent-regular);
	color: var(--accent-text-over);
}

.mode button:focus-visible,
.strip:focus-visible,
.frame:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.filters {
	position: absolute;
	width: 0;
	height: 0;
}

/* The sleeve: glassine, with each strip of six in its own pocket. */
.sleeve-page {
	display: grid;
	gap: 0.7rem;
	padding: 0.8rem;
	border-radius: 4px;
	background:
		repeating-linear-gradient(160deg, oklch(100% 0 0 / 0.05) 0 3px, transparent 3px 9px),
		oklch(97% 0.008 85 / 0.9);
	box-shadow:
		0 0 0 1px oklch(80% 0.01 80 / 0.5),
		var(--lab-lift-0);
}

:root.theme-dark .sleeve-page {
	background:
		repeating-linear-gradient(160deg, oklch(100% 0 0 / 0.03) 0 3px, transparent 3px 9px),
		oklch(22% 0.01 60 / 0.92);
	box-shadow: 0 0 0 1px oklch(35% 0.01 60 / 0.6);
}

.strip {
	position: relative;
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	align-items: start;
	gap: 0.35rem;
	padding: 1.1rem 0.5rem;
	border-radius: 2px;
	background: var(--rail);
	transition: background-color 0.9s ease;
}

/* The last strip is only as long as its frames. */
@media (min-width: 40.01em) {
	.strip {
		grid-template-columns: repeat(var(--n, 6), minmax(0, 1fr));
		width: calc(var(--n, 6) / 6 * 100%);
	}

	.strip.latent-strip {
		width: calc(var(--n, 12) / 12 * 100%);
	}
}

@media (max-width: 40em) {
	.strip {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.strip.latent-strip {
		grid-template-columns: repeat(6, minmax(0, 1fr));
	}
}

.latent-strip .exp {
	font-size: 0.52rem;
}

.latent-strip .edge {
	font-size: 0.54rem;
}

/* Sprocket holes run the length of the strip, top and bottom, and scroll with it. */
.strip-wrap .strip {
	background-image:
		repeating-linear-gradient(90deg, var(--sprocket-hole) 0 0.5rem, transparent 0.5rem 1.05rem),
		repeating-linear-gradient(90deg, var(--sprocket-hole) 0 0.5rem, transparent 0.5rem 1.05rem);
	background-size:
		100% 0.38rem,
		100% 0.38rem;
	background-position:
		0 0.32rem,
		0 calc(100% - 0.32rem);
	background-repeat: repeat-x;
	background-attachment: local;
	--sprocket-hole: color-mix(in oklch, var(--gray-999) 88%, transparent);
}

.frame {
	position: relative;
	display: grid;
	gap: 0.25rem;
	min-width: 0;
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	text-decoration: none;
	cursor: zoom-in;
}

div.frame {
	cursor: default;
}

.edge {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.1em;
	color: var(--ink);
	transition: color 0.9s ease;
}

.arrow {
	font-size: 0.8em;
}

.img {
	position: relative;
	display: block;
	width: 100%;
	aspect-ratio: 3 / 2;
	border-radius: 1px;
	overflow: hidden;
	background: var(--base);
	transition: background-color 0.9s ease;
}

.img img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

/* The negative sits over the positive; printing fades it away. */
.img img.neg {
	transition: opacity 0.9s ease;
}

.positive .img img.neg {
	opacity: 0;
}

.frame:hover .img {
	box-shadow: 0 0 0 2px var(--lab-lit);
}

/* No scans yet: frames as latent images, exposed ones with their settings. */
.latent-img {
	position: absolute;
	inset: 0;
	background: var(--lab-film-frame);
}

/* A grease-pencil ring on the frames rated four stars or more. */
.mark {
	position: absolute;
	inset: 7% 9%;
	border: 2px solid oklch(62% 0.2 28 / 0.85);
	border-radius: 45% 55% 48% 52%;
	rotate: -4deg;
	transition: border-color 0.9s ease;
}

.positive .mark {
	border-color: oklch(86% 0.16 90 / 0.9);
}

/* A rejected frame: crossed through in grease pencil. */
.cross {
	position: absolute;
	inset: 12% 14%;
	background:
		linear-gradient(to top right, transparent calc(50% - 1.5px), oklch(62% 0.2 28 / 0.85) calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px)),
		linear-gradient(to bottom right, transparent calc(50% - 1.5px), oklch(62% 0.2 28 / 0.85) calc(50% - 1.5px) calc(50% + 1.5px), transparent calc(50% + 1.5px));
}

.pencil {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
}

.pencil-label {
	font-family: var(--font-mono);
	font-size: 0.64rem;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
	margin-right: 0.3rem;
}

.pencil button {
	width: 2.5rem;
	height: 2.5rem;
	border: 1.5px solid var(--gray-700);
	border-radius: 50%;
	background: none;
	color: var(--gray-0);
	font-family: var(--font-mono);
	font-size: 0.85rem;
	cursor: pointer;
}

.pencil button[aria-pressed='true'] {
	border-color: oklch(62% 0.2 28);
	background: color-mix(in oklch, oklch(62% 0.2 28) 16%, transparent);
	color: oklch(55% 0.2 28);
}

:root.theme-dark .pencil button[aria-pressed='true'] {
	color: oklch(78% 0.15 28);
}

.pencil button:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.pencil-note {
	margin-left: 0.4rem;
	font-size: var(--text-sm);
	color: var(--gray-300);
}

/* ---- one frame, close ---- */
.focus {
	display: grid;
	gap: 1rem;
}

/* Full width, as tall as the frame's shape allows (up to most of the screen); portrait frames sit centred in it. */
.focus-img {
	display: block;
	width: 100%;
	max-height: 64vh;
	aspect-ratio: var(--ar);
	background: oklch(14% 0.005 60);
	cursor: zoom-in;
}

.focus-img img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.focus-facts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	gap: 0.6rem 1.2rem;
	margin: 0;
}

.focus-facts dt {
	font-family: var(--font-mono);
	font-size: 0.64rem;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.focus-facts dd {
	margin: 0.1rem 0 0;
}

.gauge-row {
	grid-column: span 2;
}

/* The scan's tonal range on a step wedge: black point to white point, the dot its middle. */
.gauge {
	position: relative;
	display: block;
	height: 0.9rem;
	margin: 0.25rem 0 0.3rem;
	border-radius: 2px;
	background: linear-gradient(90deg, #000, #fff);
	box-shadow: inset 0 0 0 1px var(--gray-700);
}

.gauge i {
	position: absolute;
	top: -3px;
	bottom: -3px;
	border: 2px solid var(--lab-note);
	border-radius: 3px;
}

.gauge b {
	position: absolute;
	top: 50%;
	width: 0.5rem;
	height: 0.5rem;
	translate: -50% -50%;
	border-radius: 50%;
	background: var(--lab-note);
	box-shadow: 0 0 0 2px var(--gray-999);
}

.gauge-row small {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.focus-nav {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.frame.shot .latent-img {
	background:
		radial-gradient(80% 70% at 40% 45%, oklch(70% 0.12 60 / 0.9), transparent 70%),
		linear-gradient(180deg, oklch(60% 0.12 55), oklch(50% 0.11 48));
}

/* Settings under the frame: as wide as the frame (never wider), wrapping
   between aperture and shutter under narrow portrait scans. */
.exp {
	display: flex;
	flex-wrap: wrap;
	column-gap: 1ch;
	width: 0;
	min-width: 100%;
	min-height: 1em;
	font-family: var(--font-mono);
	font-size: 0.6rem;
	line-height: 1.35;
	color: var(--ink);
	transition: color 0.9s ease;
}

.exp > span {
	white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
	/* The strip pulls out from the left as the page opens. */
	.strip {
		animation: pull 1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.12s + var(--ri, 0) * 0.08s);
	}

	@keyframes pull {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.strip,
	.edge,
	.img,
	.img img.neg {
		transition: none;
	}
}
</style>
