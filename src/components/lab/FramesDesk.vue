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
			<div class="sheet-wrap">
				<div v-if="groups.length" class="sheets">
					<section v-for="g in groups" :key="g.rollId" class="sheet-group" :aria-label="`${g.code}, ${g.rows.length} frames`">
						<header class="sg-head">
							<a class="lab-code" :href="`/photography/lab/rolls/${g.code}/`">{{ g.code }}</a>
							<span class="sg-title">{{ g.title ?? g.stock }}</span>
							<span class="sg-meta">{{ [g.title ? g.stock : null, g.camera].filter(Boolean).join(' · ') }}</span>
						</header>
						<ol class="sheet">
							<li v-for="r in g.rows" :key="r.id" class="cell" :class="{ thin: r.thin, unscanned: !r.scan }">
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
				<p v-else class="lab-empty">{{ rows.length ? 'No frame matches all of that.' : 'No frames logged yet. Shooting mode logs them as you go.' }}</p>
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
import { computed, onMounted, ref, watch } from 'vue';

import { describe, isEmpty, matches, parseQuery } from '../../lib/lab/frame-search';
import { formatExposure, frameTime } from '../../lib/lab/inventory';
import { formatEv } from '../../lib/lab/light';
import type { FrameRow } from '../../lib/lab/server/frames';
import FrameMap from './FrameMap.vue';

const props = defineProps<{ rows: FrameRow[]; initialQuery?: string }>();

const q = ref(props.initialQuery ?? '');
const query = computed(() => parseQuery(q.value));
const chips = computed(() => describe(query.value));
const results = computed(() => (isEmpty(query.value) ? props.rows : props.rows.filter((r) => matches(r, query.value))));
const pickedIds = ref<string[] | null>(null);
const visible = computed(() => (pickedIds.value ? results.value.filter((r) => pickedIds.value!.includes(r.id)) : results.value));
const limit = ref(36);
const shown = computed(() => visible.value.slice(0, limit.value));
/** The shown frames, roll by roll (a contact sheet per roll), most recent roll first. */
const groups = computed(() => {
	const out: { rollId: string; code: string; title: string | null; stock: string; camera: string | null; rows: FrameRow[] }[] = [];
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
	const wide = props.rows.map((r) => r.aperture).filter((a): a is number => a != null && a <= 2.8);
	if (wide.length) out.push(`f/${count(wide)[0][0]}`);
	const stock = count(props.rows.map((r) => r.stock.split(' ').find((w) => w.length > 3 && !/kodak|fuji|ilford|film/i.test(w)) ?? ''))[0];
	if (stock?.[0]) out.push(stock[0].toLowerCase());
	if (props.rows.some((r) => r.thin)) out.push('thin');
	if (props.rows.some((r) => r.flash)) out.push('flash');
	if (props.rows.some((r) => r.note)) out.push('noted');
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

@media (prefers-reduced-motion: reduce) {
	.img img {
		transition: none;
	}
}
</style>
