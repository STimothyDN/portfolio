<template>
	<section class="frames-desk" aria-labelledby="sheet-h">
		<header class="search">
			<h2 id="sheet-h" class="lab-h2">Every frame</h2>
			<label class="box">
				<span class="sr-only">Search frames</span>
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
				<input id="frame-search" v-model="q" class="lab-input" type="search" placeholder="f/1.7 portra · peru · 1/500 flash · thin · october" autocomplete="off" enterkeyhint="search" />
			</label>
			<div class="read" aria-live="polite">
				<span class="count">{{ countText }}</span>
				<span v-for="c in chips" :key="c" class="lab-chip">{{ c }}</span>
				<button v-if="pickedIds" type="button" class="lab-chip picked" @click="pickedIds = null">At this spot · {{ pickedIds.length }} ✕</button>
			</div>
			<div v-if="!q && examples.length" class="examples">
				<span class="lab-meta">Try</span>
				<button v-for="e in examples" :key="e" type="button" class="lab-link" @click="q = e">{{ e }}</button>
			</div>
		</header>

		<div class="layout" :class="{ 'no-map': !located.length }">
			<div class="sheet-wrap lab-lightbox">
				<!-- On the light table with a loupe: hover a frame to see it up close. -->
				<div v-if="groups.length" class="sheets" @pointermove="onLoupe" @pointerleave="hideLoupe">
					<section v-for="g in groups" :key="g.rollId" class="sheet-group" :aria-label="`${g.code}, ${g.rows.length} frames`">
						<header class="sg-head">
							<a class="lab-code" :href="`/photography/lab/rolls/${g.code}/`">{{ g.code }}</a>
							<span class="sg-title">{{ g.title ?? g.stock }}</span>
							<span class="sg-meta">{{ [g.title ? g.stock : null, g.camera].filter(Boolean).join(' · ') }}</span>
						</header>
						<ol class="sheet">
							<li v-for="r in g.rows" :key="r.id" class="cell" :class="{ thin: r.thin, unscanned: !r.scan }" :data-frame="r.id">
								<a :href="`/photography/lab/rolls/${r.code}/#frames`" class="cell-link">
									<span class="edge">{{ r.number }} <span aria-hidden="true">▸</span> {{ r.number }}A<template v-if="r.scan"> · scan {{ r.scan.n }}</template></span>
									<span class="img">
										<img v-if="r.scan" :src="r.scan.thumb" :alt="`${r.code} frame ${r.number}`" loading="lazy" decoding="async" />
										<!-- No scan yet: a latent frame, as bright as the light it was exposed for. -->
										<span v-else class="latent" :class="{ auto: r.ev == null }" :style="r.ev != null ? { '--lit': lit(r.ev) } : undefined" aria-hidden="true"></span>
										<span v-if="r.thin" class="flag">thin</span>
									</span>
									<span class="exp">{{ formatExposure(r) }}<template v-if="r.ev != null"> · EV {{ formatEv(r.ev) }}</template></span>
									<span class="sub">{{ frameTime(r, true) }}{{ r.lens ? ` · ${shortLens(r.lens)}` : '' }}</span>
									<span v-if="r.note" class="note">{{ r.note }}</span>
								</a>
							</li>
						</ol>
					</section>
				</div>
				<p v-else class="lab-empty">{{ props.rows.length ? 'No frame matches all of that.' : 'No frames logged yet. Shooting mode logs them as you go.' }}</p>
				<div ref="loupeEl" class="loupe" :class="{ on: loupe.on }" aria-hidden="true">
					<span v-if="loupe.scan" class="loupe-scan" :style="{ backgroundImage: `url('${loupe.scan.big}'), url('${loupe.scan.thumb}')` }"></span>
					<span v-else-if="loupe.latent" class="loupe-latent latent" :class="{ auto: loupe.latent.lit == null }" :style="loupe.latent.lit != null ? { '--lit': loupe.latent.lit } : undefined">
						<i>{{ loupe.latent.edge }}</i>
						<b>{{ loupe.latent.exp }}</b>
					</span>
				</div>
				<button v-if="visible.length > limit" type="button" class="lab-btn lab-btn--quiet more" @click="limit += 48">Show {{ Math.min(48, visible.length - limit) }} more</button>
			</div>
			<aside v-if="located.length" class="side">
				<FrameMap :points="located" :filtered="!!q" :height="mapHeight" @pick="pickedIds = $event" />
				<p class="lab-hint">Rough locations, from shooting mode. Tap a dot to see its frames.</p>
			</aside>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { describe, isEmpty, matches, parseQuery } from '../../lib/lab/frame-search';
import { formatExposure, frameTime } from '../../lib/lab/inventory';
import { formatEv } from '../../lib/lab/light';
import type { FrameRow, RollBrief } from '../../lib/lab/server/frames';
import FrameMap from './FrameMap.vue';

const props = defineProps<{ rows: FrameRow[]; rolls: Record<string, RollBrief>; initialQuery?: string }>();

/** Each frame with its roll's details, joined once: what search and the sheet read. */
type Row = FrameRow & RollBrief;
const rows = computed<Row[]>(() => props.rows.map((r) => ({ ...r, ...props.rolls[r.rollId] })));

const q = ref(props.initialQuery ?? '');
const query = computed(() => parseQuery(q.value));
const chips = computed(() => describe(query.value));
const results = computed(() => (isEmpty(query.value) ? rows.value : rows.value.filter((r) => matches(r, query.value))));
const pickedIds = ref<string[] | null>(null);
const visible = computed(() => (pickedIds.value ? results.value.filter((r) => pickedIds.value!.includes(r.id)) : results.value));
const limit = ref(36);
const shown = computed(() => visible.value.slice(0, limit.value));
/** The shown frames, roll by roll (a contact sheet per roll), most recent roll first. */
const groups = computed(() => {
	const out: { rollId: string; code: string; title: string | null; stock: string; camera: string | null; rows: Row[] }[] = [];
	const at = new Map<string, number>();
	for (const r of shown.value) {
		let i = at.get(r.rollId);
		if (i == null) {
			i = out.push({ rollId: r.rollId, code: r.code, title: r.title, stock: r.stock, camera: r.camera, rows: [] }) - 1;
			at.set(r.rollId, i);
		}
		out[i].rows.push(r);
	}
	for (const g of out) g.rows.sort((a, b) => a.number - b.number);
	return out;
});
/** EV 3 (night) to 16 (snow) as 0–1, for a latent frame's brightness. */
const lit = (ev: number) => Math.round(Math.min(1, Math.max(0, (ev - 3) / 13)) * 100) / 100;
/*
 * The loupe: over a frame on the sheet (with a mouse), a lens follows the
 * pointer and shows the scan about 2.6× larger, or, for a frame not scanned
 * yet, its edge number and exposure written large.
 */
const ZOOM = 2.6;
const loupeEl = ref<HTMLElement | null>(null);
const loupe = reactive<{ on: boolean; id: string; scan: { thumb: string; big: string } | null; latent: { lit: number | null; edge: string; exp: string } | null }>({
	on: false,
	id: '',
	scan: null,
	latent: null,
});
const byId = computed(() => new Map(shown.value.map((r) => [r.id, r])));
let loupeFrame = 0;
function hideLoupe() {
	loupe.on = false;
}
function onLoupe(e: PointerEvent) {
	if (e.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
	const cell = (e.target as Element).closest<HTMLElement>('.cell');
	const img = cell?.querySelector<HTMLElement>('.img');
	const rect = img?.getBoundingClientRect();
	if (!cell || !rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return hideLoupe();
	const row = byId.value.get(cell.dataset.frame ?? '');
	if (!row) return hideLoupe();
	if (loupe.id !== row.id) {
		loupe.id = row.id;
		loupe.scan = row.scan ? { thumb: row.scan.thumb, big: row.scan.thumb.replace(/([?&])width=\d+/, '$1width=900') } : null;
		loupe.latent = row.scan
			? null
			: { lit: row.ev != null ? lit(row.ev) : null, edge: `${row.number} ▸ ${row.number}A`, exp: [formatExposure(row), row.ev != null ? `EV ${formatEv(row.ev)}` : null].filter(Boolean).join(' · ') };
	}
	loupe.on = true;
	const { clientX: x, clientY: y } = e;
	cancelAnimationFrame(loupeFrame);
	loupeFrame = requestAnimationFrame(() => {
		const el = loupeEl.value;
		if (!el) return;
		const half = el.offsetWidth / 2;
		el.style.translate = `${x - half}px ${y - half}px`;
		el.style.setProperty('--w', `${rect.width * ZOOM}px`);
		el.style.setProperty('--h', `${rect.height * ZOOM}px`);
		el.style.setProperty('--x', `${half - (x - rect.left) * ZOOM}px`);
		el.style.setProperty('--y', `${half - (y - rect.top) * ZOOM}px`);
	});
}

const located = computed(() => results.value.filter((r) => r.lat != null && r.lng != null).map((r) => ({ id: r.id, lat: r.lat!, lng: r.lng!, thin: r.thin })));
watch(q, () => (limit.value = 36));

const countText = computed(() => {
	const n = visible.value.length;
	const scans = visible.value.filter((r) => r.scan).length;
	return `${n} ${n === 1 ? 'frame' : 'frames'}${scans ? ` · ${scans} with scans` : ''}`;
});

/** A few searches this logbook can answer. */
const examples = computed(() => {
	const out: string[] = [];
	const count = <T,>(list: T[]) => [...list.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]);
	const wide = rows.value.map((r) => r.aperture).filter((a): a is number => a != null && a <= 2.8);
	if (wide.length) out.push(`f/${count(wide)[0][0]}`);
	const stock = count(rows.value.map((r) => r.stock.split(' ').find((w) => w.length > 3 && !/kodak|fuji|ilford|film/i.test(w)) ?? ''))[0];
	if (stock?.[0]) out.push(stock[0].toLowerCase());
	if (rows.value.some((r) => r.thin)) out.push('thin');
	if (rows.value.some((r) => r.flash)) out.push('flash');
	if (rows.value.some((r) => r.note)) out.push('noted');
	return out.slice(0, 5);
});

const shortLens = (name: string) => name.replace(/^(MD|FD|AI-?S?|SMC)\s+/i, '').replace(/\s+f\/[\d.]+$/, '');

// Keep the search in the address, so a link (or reload) brings it back.
watch(q, (v) => {
	const url = new URL(location.href);
	if (v.trim()) url.searchParams.set('q', v.trim());
	else url.searchParams.delete('q');
	history.replaceState(history.state, '', url);
});

const mapHeight = ref(360);
onMounted(() => {
	mapHeight.value = window.matchMedia('(min-width: 62em)').matches ? 460 : 300;
});
</script>

<style scoped>
.frames-desk {
	display: grid;
	gap: 1.25rem;
}

.search {
	display: grid;
	gap: 0.75rem;
}

.box {
	position: relative;
	display: block;
	max-width: 40rem;
}

.box svg {
	position: absolute;
	left: 0.85rem;
	top: 50%;
	width: 1.1rem;
	height: 1.1rem;
	translate: 0 -50%;
	fill: none;
	stroke: var(--gray-300);
	stroke-width: 1.8;
	pointer-events: none;
}

.box input {
	width: 100%;
	padding-left: 2.6rem;
	font-size: var(--text-md, 1.05rem);
}

.read {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem 0.5rem;
	min-height: 1.6rem;
}

.count {
	font-family: var(--font-mono);
	font-size: var(--text-sm);
	color: var(--gray-200);
	margin-right: 0.25rem;
}

.picked {
	border: 0;
	cursor: pointer;
	font: inherit;
}

.examples {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3rem 0.9rem;
	align-items: baseline;
}

.examples .lab-link {
	font-family: var(--font-mono);
	font-size: var(--text-sm);
}

.layout {
	display: grid;
	gap: 1.25rem;
}

@media (min-width: 62em) {
	.layout {
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem);
		align-items: start;
	}

	.layout.no-map {
		grid-template-columns: minmax(0, 1fr);
	}

	.side {
		position: sticky;
		top: 1.5rem;
	}
}

.side {
	display: grid;
	gap: 0.5rem;
	order: -1;
}

@media (min-width: 62em) {
	.side {
		order: 0;
	}
}

/* A contact sheet per roll: frames on film, edge numbers and all. */
.sheets {
	display: grid;
	gap: 1.25rem;
}

.sheet-group {
	display: grid;
	gap: 0.5rem;
}

.sg-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2rem 0.75rem;
}

.sg-title {
	color: var(--gray-0);
	font-size: var(--text-md, 1.05rem);
}

.sg-meta {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--gray-300);
}

.sheet {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
	gap: 0.9rem 0.6rem;
	list-style: none;
	padding: 1rem 0.75rem;
	border-radius: 0.5rem;
	background: var(--lab-film);
	box-shadow: inset 0 0 0 1px oklch(0% 0 0 / 0.25);
}

@media (max-width: 30em) {
	.sheet {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

.cell-link {
	display: grid;
	gap: 0.25rem;
	color: oklch(88% 0.012 80);
	text-decoration: none;
	border-radius: 0.25rem;
}

.cell-link:focus-visible {
	outline: 2px solid var(--lab-edge-ink);
	outline-offset: 3px;
}

.edge {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.08em;
	color: var(--lab-edge-ink);
}

.img {
	position: relative;
	display: block;
	aspect-ratio: 3 / 2;
	overflow: hidden;
	border-radius: 1px;
	background: var(--lab-film-frame);
}

.img img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	transition: filter 0.2s ease;
}

.cell-link:hover .img img {
	filter: brightness(1.08);
}

.latent {
	--lit: 0.5;
	position: absolute;
	inset: 0;
	background:
		radial-gradient(80% 70% at 40% 45%, oklch(calc(34% + var(--lit) * 44%) 0.11 62 / 0.85), transparent 72%),
		linear-gradient(180deg, oklch(calc(26% + var(--lit) * 22%) 0.07 55), oklch(calc(22% + var(--lit) * 14%) 0.05 48));
}

/* Exposure left to the camera: no light to show, just the frame. */
.latent.auto {
	background: repeating-linear-gradient(135deg, oklch(33% 0.03 50) 0 6px, oklch(30% 0.025 50) 6px 12px);
}

.flag {
	position: absolute;
	top: 0.3rem;
	right: 0.3rem;
	padding: 0.05rem 0.4rem;
	border-radius: 999px;
	background: var(--lab-edge-ink);
	color: oklch(20% 0.02 50);
	font-family: var(--font-mono);
	font-size: 0.6rem;
}

.cell.thin .img {
	outline: 2px solid var(--lab-edge-ink);
	outline-offset: 1px;
}

.exp {
	font-family: var(--font-mono);
	font-size: 0.76rem;
	color: oklch(96% 0.006 85);
}

.sub {
	font-family: var(--font-mono);
	font-size: 0.64rem;
	color: oklch(72% 0.012 75);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.note {
	font-size: 0.8rem;
	font-style: italic;
	line-height: 1.3;
	color: oklch(80% 0.012 75);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.more {
	margin-top: 0.75rem;
}

/* The sheets lie on the light table. */
.sheet-wrap {
	padding: clamp(0.6rem, 2vw, 1.1rem);
}

.sheet-wrap .sg-title {
	color: var(--gray-0);
}

/* A loupe: black barrel, chrome ring, the glass's own vignette and glint. */
.loupe {
	position: fixed;
	left: 0;
	top: 0;
	z-index: 30;
	width: 11rem;
	height: 11rem;
	border-radius: 50%;
	overflow: hidden;
	background: var(--lab-film-frame);
	box-shadow:
		0 0 0 4px oklch(16% 0.004 60),
		0 0 0 6px oklch(70% 0.005 80),
		0 0 0 9px oklch(20% 0.004 60),
		0 20px 34px -8px rgb(0 0 0 / 0.55);
	opacity: 0;
	scale: 0.5;
	pointer-events: none;
	transition:
		opacity 0.15s ease,
		scale 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.loupe.on {
	opacity: 1;
	scale: 1;
}

.loupe::after {
	content: '';
	position: absolute;
	inset: 0;
	border-radius: 50%;
	background: radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.22), transparent 38%);
	box-shadow:
		inset 0 0 22px rgb(0 0 0 / 0.6),
		inset 0 0 0 1px rgb(255 255 255 / 0.25);
}

.loupe-scan {
	position: absolute;
	left: var(--x, 0);
	top: var(--y, 0);
	width: var(--w, 100%);
	height: var(--h, 100%);
	background-size: cover;
	background-position: center;
}

.loupe-latent {
	display: grid;
	place-content: center;
	justify-items: center;
	gap: 0.35rem;
	padding: 1rem;
	text-align: center;
}

.loupe-latent i {
	font-family: var(--font-mono);
	font-size: 0.7rem;
	font-style: normal;
	letter-spacing: 0.12em;
	color: var(--lab-edge-ink);
}

.loupe-latent b {
	font-family: var(--font-mono);
	font-size: 1.05rem;
	font-weight: 600;
	color: oklch(97% 0.01 85);
	text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}

@media (prefers-reduced-motion: reduce) {
	.loupe {
		transition: opacity 0.1s ease;
		scale: 1;
	}
}

@media (prefers-reduced-motion: reduce) {
	.img img {
		transition: none;
	}
}
</style>
