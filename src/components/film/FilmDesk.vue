<template>
	<div
		ref="rootRef"
		class="film"
		:class="{ 'is-live': live, 'is-grid': mode === 'grid', 'is-dragging': dragging }"
	>
		<!-- Keeps the floating site nav legible over the pile. -->
		<div class="film-nav-scrim" aria-hidden="true"></div>

		<!-- Floating along the bottom, under the pile: the rolls, then the
		     controls. Before the desk in the DOM so keyboard users reach both
		     without tabbing through every print. -->
		<div ref="bottomRef" class="film-bottom">
			<FilmRollStrip
				:rolls="rolls"
				:selected="selected.roll"
				:counts="rollCounts"
				:status="status"
				@toggle="(id) => toggle('roll', id)"
			/>
			<FilmFilterDock
				class="film-dock"
				:facets="FILTER_FACETS"
				:options="options"
				:has-filters="hasFilters"
				@toggle="toggle"
				@clear="clearAll"
				@toss="retoss"
			>
				<slot />
			</FilmFilterDock>
		</div>

		<div
			ref="deskRef"
			class="desk"
			:class="{ 'is-vertical': vertical }"
			:style="deskStyle"
			role="region"
			aria-label="Film prints"
		>
			<div ref="glowRef" class="glow" aria-hidden="true"><span class="glow-light"></span></div>

			<!-- Organized view: each roll is cut into strips of negatives, with the
			     prints settling into their frames (they're positioned separately).
			     A roll's first strip spools out of its canister; its last runs on
			     into a blank leader and the cut tongue. -->
			<TransitionGroup name="neg">
				<div
					v-for="(strip, k) in strips"
					:key="strip.key"
					class="neg-strip"
					:class="{ 'is-tail': strip.tail }"
					:style="{
						left: `${strip.x}px`,
						top: `${strip.y}px`,
						width: `${strip.w}px`,
						height: `${strip.h}px`,
						'--k': k,
					}"
					aria-hidden="true"
				>
					<template v-for="f in strip.frames" :key="f.idx">
						<span class="neg-window" :style="{ left: `${f.x}px`, top: `${f.y}px` }"></span>
						<span class="neg-edge" :style="vertical ? { top: `${f.y}px` } : { left: `${f.x}px` }">
							<span class="neg-stock">{{ f.stock }}</span>
							<span class="neg-num">{{ f.n }}</span>
							<span class="neg-num neg-num--half">▸ {{ f.n }}A</span>
						</span>
					</template>
					<svg v-if="strip.tail && !vertical" class="neg-tongue" viewBox="0 0 40 100" preserveAspectRatio="none">
						<path d="M0 0 H8 C16 0 15 46 26 46 H35 Q40 46 40 52 V100 H0 Z" />
					</svg>
					<svg v-if="strip.tail && vertical" class="neg-tongue" viewBox="0 0 100 40" preserveAspectRatio="none">
						<path d="M0 0 H100 V35 Q100 40 95 40 H58 Q54 40 54 36 V26 C54 18 20 10 0 8 Z" />
					</svg>
				</div>
			</TransitionGroup>

			<TransitionGroup name="neg">
				<FilmCanister
					v-for="can in canisters"
					:key="can.key"
					class="desk-can"
					:class="{ 'is-lying': vertical }"
					:stock="can.stock"
					:stock-label="can.stockLabel"
					:style="{
						left: `${can.x - (can.h * 0.43) / 2}px`,
						top: `${can.y - can.h / 2}px`,
						'--can-h': `${can.h}px`,
						'--k': can.k,
					}"
				/>
			</TransitionGroup>

			<!-- The lab's sticker on each leader, the roll's name written on in marker. -->
			<TransitionGroup name="neg">
				<p
					v-for="tag in stickers"
					:key="tag.key"
					class="lab-sticker"
					:style="{
						left: `${tag.x}px`,
						top: `${tag.y}px`,
						width: `${tag.w}px`,
						height: `${tag.h}px`,
						'--tilt': `${tag.tilt}deg`,
						'--fs': `${tag.fs}px`,
						'--k': tag.k,
					}"
				>
					<span v-for="(line, n) in tag.lines" :key="n">{{ line }}</span>
				</p>
			</TransitionGroup>

			<!-- A quiet heading per group (camera, film, lab or year) — none when
			     grouped by roll, since each roll's sticker names it. -->
			<h3
				v-for="head in heads"
				:key="head.key"
				class="group-head"
				:style="{ left: `${head.x}px`, width: `${head.w}px`, transform: `translateY(${head.y}px)` }"
			>
				<span class="group-eyebrow">{{ head.eyebrow }}</span>
				<span class="group-title">{{ head.label }}</span>
				<span class="group-rule" aria-hidden="true"></span>
				<span class="group-meta">{{ head.meta }}</span>
			</h3>

			<button
				v-for="i in rendered"
				:key="i"
				:ref="(el) => setPrintEl(i, el)"
				type="button"
				class="print"
				:style="{ width: `${sizeOf(i).w}px`, height: `${sizeOf(i).h}px` }"
				:aria-label="printLabel(i)"
				@click="onPrintClick(i)"
				@pointerdown="onPointerDown($event, i)"
				@pointermove="onPointerMove($event, i)"
				@pointerup="onPointerUp($event, i)"
				@pointercancel="onPointerUp($event, i)"
				@pointerenter="onPointerEnter($event, i)"
				@pointerleave="onPointerLeave(i)"
				@focus="onFocus(i)"
				@blur="hideGlow(i)"
			>
				<span class="print-lift" aria-hidden="true"></span>
				<span class="print-body">
					<img
						:src="thumbUrl(i)"
						alt=""
						draggable="false"
						:loading="pileSet.has(i) ? 'eager' : 'lazy'"
						decoding="async"
						@load="($event.target as HTMLImageElement).classList.add('is-loaded')"
					/>
				</span>
			</button>

			<p v-if="live && mode === 'grid' && !filtered.length" class="desk-empty">
				Nothing on the desk matches that combination.
			</p>
		</div>


		<PhotoLightbox />
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { gsap } from 'gsap';

import PhotoLightbox from '../PhotoLightbox.vue';
import FilmFilterDock from './FilmFilterDock.vue';
import '@fontsource/permanent-marker/400.css';

import FilmCanister from './FilmCanister.vue';
import FilmRollStrip from './FilmRollStrip.vue';
import { bestSplit } from './canister';
import { bunnyUrl } from '../../utils/bunny';
import {
	clamp,
	layoutStrips,
	layoutPile,
	mulberry32,
	pileCapacity,
	printLongFor,
	printSize,
	priorityWeight,
	stackOrder,
	weightedSample,
	type PileSlot,
} from './layout';
import type { FacetKey, FacetOption, FilmPhotoData, FilmRollData } from './types';

const props = defineProps<{ rolls: FilmRollData[]; photos: FilmPhotoData[] }>();

/* ── Facets ─────────────────────────────────────────────────────────── */

type FilterFacet = Exclude<FacetKey, 'roll'>;
const FILTER_FACETS: { key: FilterFacet; label: string; title: string }[] = [
	{ key: 'camera', label: 'Camera', title: 'Shot on' },
	{ key: 'stock', label: 'Film', title: 'Film stock' },
	{ key: 'lab', label: 'Lab', title: 'Developed at' },
	{ key: 'year', label: 'Year', title: 'Developed in' },
];
const ALL_FACETS: FacetKey[] = ['roll', 'camera', 'stock', 'lab', 'year'];
const FACET_NOUN: Record<FacetKey, string> = {
	roll: 'roll',
	camera: 'camera',
	stock: 'film stock',
	lab: 'lab',
	year: 'year',
};

// Every frame inherits its roll's metadata — the folder name is the record.
const facetOf = props.photos.map((p) => {
	const roll = props.rolls[p.r];
	return { roll: roll.id, camera: roll.camera, stock: roll.stock, lab: roll.lab, year: roll.year } as Record<
		FacetKey,
		string
	>;
});

const labelOf = Object.fromEntries(ALL_FACETS.map((f) => [f, new Map<string, string>()])) as Record<
	FacetKey,
	Map<string, string>
>;
for (const roll of props.rolls) {
	labelOf.roll.set(roll.id, roll.title);
	labelOf.camera.set(roll.camera, roll.cameraLabel);
	labelOf.stock.set(roll.stock, roll.stockLabel);
	labelOf.lab.set(roll.lab, roll.labLabel);
	labelOf.year.set(roll.year, roll.year);
}

// Option order: rolls newest-first (as given), years newest-first, the rest A→Z.
const universe = Object.fromEntries(
	ALL_FACETS.map((f) => {
		const values = [...labelOf[f].keys()];
		if (f === 'year') values.sort((a, b) => b.localeCompare(a));
		else if (f !== 'roll') values.sort((a, b) => labelOf[f].get(a)!.localeCompare(labelOf[f].get(b)!));
		return [f, values];
	})
) as Record<FacetKey, string[]>;

const rollById = new Map(props.rolls.map((roll) => [roll.id, roll]));
const framesByRoll = props.rolls.map(() => [] as number[]);
props.photos.forEach((p, i) => framesByRoll[p.r].push(i));

/* ── Filter state ───────────────────────────────────────────────────── */

const selected = reactive<Record<FacetKey, string[]>>({ roll: [], camera: [], stock: [], lab: [], year: [] });
// Facets in the order they were first switched on. The first one decides how
// the grid is grouped; later ones only whittle it down.
const facetOrder = ref<FacetKey[]>([]);

const hasFilters = computed(() => facetOrder.value.length > 0);
const mode = computed<'pile' | 'grid'>(() => (hasFilters.value ? 'grid' : 'pile'));

const matches = (i: number, except?: FacetKey) =>
	facetOrder.value.every((f) => f === except || selected[f].includes(facetOf[i][f]));

const filtered = computed(() => props.photos.map((_, i) => i).filter((i) => matches(i)));

const groups = computed(() => {
	const f = facetOrder.value[0];
	if (!f) return [];
	const byValue = new Map<string, number[]>();
	for (const i of filtered.value) {
		const v = facetOf[i][f];
		if (!byValue.has(v)) byValue.set(v, []);
		byValue.get(v)!.push(i);
	}
	// photos are already roll (newest first) → frame order.
	return universe[f].filter((v) => byValue.has(v)).map((v) => ({ key: v, items: byValue.get(v)! }));
});

/** Per-facet option lists with counts under every *other* active facet. */
const options = computed(() => {
	const out = {} as Record<FacetKey, FacetOption[]>;
	for (const f of ALL_FACETS) {
		const counts = new Map<string, number>();
		props.photos.forEach((_, i) => {
			if (matches(i, f)) counts.set(facetOf[i][f], (counts.get(facetOf[i][f]) ?? 0) + 1);
		});
		out[f] = universe[f].map((value) => ({
			value,
			label: labelOf[f].get(value) ?? value,
			count: counts.get(value) ?? 0,
			selected: selected[f].includes(value),
		}));
	}
	return out;
});

const rollCounts = computed(() => Object.fromEntries(options.value.roll.map((o) => [o.value, o.count])));

function toggle(f: FacetKey, value: string) {
	const list = selected[f];
	const at = list.indexOf(value);
	if (at >= 0) list.splice(at, 1);
	else list.push(value);
	if (list.length && !facetOrder.value.includes(f)) facetOrder.value = [...facetOrder.value, f];
	if (!list.length) facetOrder.value = facetOrder.value.filter((x) => x !== f);
	if (f !== 'roll') pruneRolls();
}

// The roll list only shows rolls the other filters allow, so a selected roll
// those filters rule out is dropped rather than left selected out of sight.
function pruneRolls() {
	if (!selected.roll.length) return;
	const keep = selected.roll.filter((id) => rollCounts.value[id] > 0);
	if (keep.length === selected.roll.length) return;
	selected.roll = keep;
	if (!keep.length) facetOrder.value = facetOrder.value.filter((x) => x !== 'roll');
}

function clearAll() {
	for (const f of ALL_FACETS) selected[f] = [];
	facetOrder.value = [];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const status = computed(() => {
	const total = props.photos.length;
	if (!hasFilters.value) return plural(total, 'frame');
	return `${filtered.value.length} of ${plural(total, 'frame')} · by ${FACET_NOUN[facetOrder.value[0]]}`;
});

/* ── URL state (shareable filtered views) ───────────────────────────── */

function writeUrl() {
	const params = new URLSearchParams();
	for (const f of facetOrder.value) params.set(f, selected[f].join(','));
	const qs = params.toString();
	const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
	if (next !== `${location.pathname}${location.search}${location.hash}`) {
		// Keep Astro's ClientRouter fields in the entry.
		history.replaceState(history.state, '', next);
	}
}

function readUrl() {
	const params = new URLSearchParams(location.search);
	for (const [key, raw] of params) {
		if (!ALL_FACETS.includes(key as FacetKey)) continue;
		const f = key as FacetKey;
		const values = raw.split(',').filter((v) => universe[f].includes(v));
		if (!values.length) continue;
		selected[f] = values;
		if (!facetOrder.value.includes(f)) facetOrder.value = [...facetOrder.value, f];
	}
}

/* ── Prints ─────────────────────────────────────────────────────────── */

const live = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const deskRef = ref<HTMLElement | null>(null);
const glowRef = ref<HTMLElement | null>(null);
const bottomRef = ref<HTMLElement | null>(null);

const printLong = ref(200);
const deskHeight = ref(0);
const vertical = ref(false);
const strips = ref<
	{
		key: string;
		x: number;
		y: number;
		w: number;
		h: number;
		tail: boolean;
		frames: { idx: number; x: number; y: number; n: number; stock: string }[];
	}[]
>([]);
const heads = ref<{ key: string; x: number; y: number; w: number; eyebrow: string; label: string; meta: string }[]>([]);
const canisters = ref<{ key: string; x: number; y: number; h: number; k: number; stock: string; stockLabel: string }[]>(
	[]
);
const stickers = ref<
	{ key: string; x: number; y: number; w: number; h: number; k: number; lines: string[]; fs: number; tilt: number }[]
>([]);
const frameGeo = ref({ w: 0, h: 0, rail: 0, tongue: 0 });
const deskStyle = computed(() => {
	if (!deskHeight.value) return undefined;
	const { w, h, rail, tongue } = frameGeo.value;
	return {
		height: `${deskHeight.value}px`,
		'--fw': `${w}px`,
		'--fh': `${h}px`,
		'--rail': `${rail}px`,
		'--tongue': `${tongue}px`,
	};
});
/** Photo indices with a DOM print, in focus order. */
const rendered = ref<number[]>([]);
const pileSet = shallowRef(new Set<number>());
const dragging = ref(false);

const els = new Map<number, HTMLElement>();
const setPrintEl = (i: number, el: unknown) => {
	if (el instanceof HTMLElement) els.set(i, el);
	else els.delete(i);
};

const aspectOf = (i: number) => {
	const p = props.photos[i];
	return p.w && p.h ? p.w / p.h : 1.5;
};
const sizeOf = (i: number) => printSize(aspectOf(i), printLong.value);

// CDN width for desk thumbnails — fixed once at mount so resizing never
// re-downloads, and shared with the lightbox's blur-up placeholder.
let thumbLong = 480;
const THUMB_STEPS = [360, 480, 600, 720];
const scanPath = (i: number) => `${props.rolls[props.photos[i].r].folder}/${props.photos[i].f}`;
function thumbUrl(i: number) {
	const a = aspectOf(i);
	const width = a >= 1 ? thumbLong : Math.round((thumbLong * a) / 40) * 40;
	return bunnyUrl(scanPath(i), { width, format: 'webp', quality: 72 });
}

const fullDate = (iso: string) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC',
	});

function printLabel(i: number) {
	const p = props.photos[i];
	const roll = props.rolls[p.r];
	return `${p.c ? `${p.c}. ` : ''}Frame ${p.n} of ${roll.title} — ${roll.cameraLabel}, ${roll.stockLabel}`;
}

function toLightbox(i: number) {
	const p = props.photos[i];
	const roll = props.rolls[p.r];
	return {
		filename: p.f,
		caption: p.c ?? '',
		label: `${roll.title} — No. ${p.n}`,
		fullUrl: bunnyUrl(scanPath(i), { width: 2000, format: 'webp', quality: 90 }),
		thumbUrl: thumbUrl(i),
		width: p.w,
		height: p.h,
		// The title already names the roll and frame; these are the rest of the folder name.
		details: [
			{ label: 'Camera', value: roll.cameraLabel },
			{ label: 'Film', value: roll.stockLabel },
			{ label: 'Lab', value: roll.labLabel },
			{ label: 'Developed', value: fullDate(roll.developed) },
		],
	};
}

/* ── Geometry ───────────────────────────────────────────────────────── */

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTopOf = () => document.body.scrollTop + window.scrollY;

// W: desk width. H: pile-mode desk height (the whole screen). navH/bottomH:
// the floating chrome; top/bottom: how far the pile keeps clear of it.
const geo = { W: 0, H: 0, top: 0, bottom: 0, navH: 0, bottomH: 0 };

function measure() {
	const desk = deskRef.value!;
	geo.W = desk.clientWidth;
	geo.navH = document.querySelector<HTMLElement>('nav')?.offsetHeight ?? 0;
	rootRef.value?.style.setProperty('--film-nav-h', `${geo.navH}px`);
	geo.bottomH = bottomRef.value?.offsetHeight ?? 0;
	geo.H = Math.max(420, window.innerHeight);
	// Prints may tuck partway under the nav and under the rolls — it reads as
	// one surface fading out beneath the controls.
	geo.top = geo.navH * 0.8;
	geo.bottom = geo.bottomH * 0.6;
	printLong.value = printLongFor(geo.W, geo.H - geo.top - geo.bottom);
}

const pileArea = () => ({ w: geo.W, h: geo.H - geo.top - geo.bottom });

/* ── The pile ───────────────────────────────────────────────────────── */

interface PileEntry {
	i: number;
	slot: PileSlot;
	z: number;
}
let pile: PileEntry[] = [];
let zTop = 0;

function buildPile() {
	const rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
	const area = pileArea();
	const all = props.photos.map((_, i) => i);
	const picked = weightedSample(
		all,
		(i) => priorityWeight(props.photos[i].p),
		pileCapacity(area, printLong.value),
		rand
	);
	const stacked = stackOrder(picked, (i) => props.photos[i].p, rand);
	const slots = layoutPile(stacked.map(sizeOf), area, rand);
	pile = stacked.map((i, k) => ({ i, slot: slots[k], z: k + 1 }));
	zTop = pile.length;
	pileSet.value = new Set(stacked);
}

/** Warm the cache for the prints people will see first, without stalling forever. */
function preload(indices: number[], timeout = 1400) {
	const loads = indices.map(
		(i) =>
			new Promise<void>((resolve) => {
				const img = new Image();
				img.onload = img.onerror = () => resolve();
				img.src = thumbUrl(i);
			})
	);
	return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeout))]);
}

/* ── Layout + motion ────────────────────────────────────────────────── */

interface Target {
	x: number;
	y: number;
	r: number;
	s: number;
	z: number;
}
let targets = new Map<number, Target>();
let gen = 0;
let ready = false;

type Kind = 'toss' | 'shift' | 'instant';

async function applyLayout(kind: Kind) {
	if (!deskRef.value) return; // unmounted mid-await (navigated away)
	const my = ++gen;
	measure();

	const next = new Map<number, Target>();
	let order: number[];
	if (mode.value === 'pile') {
		if (!pile.length) buildPile();
		const area = pileArea();
		deskHeight.value = geo.H;
		strips.value = [];
		canisters.value = [];
		stickers.value = [];
		heads.value = [];
		for (const e of pile) {
			next.set(e.i, { x: e.slot.u * area.w, y: geo.top + e.slot.v * area.h, r: e.slot.r, s: 1, z: e.z });
		}
		order = [...pile].sort((a, b) => b.z - a.z).map((e) => e.i);
	} else {
		const sheet = layoutStrips(groups.value, geo.W, {
			top: geo.navH + 28,
			bottom: geo.bottomH + 40,
			maxContent: 1280,
			runOf: (i) => props.rolls[props.photos[i].r].id,
			headings: facetOrder.value[0] !== 'roll',
		});
		vertical.value = sheet.vertical;
		const f = facetOrder.value[0];
		heads.value = sheet.heads.map((h) => ({ ...h, ...groupInfo(f, h.key) }));
		deskHeight.value = Math.max(sheet.height, geo.H);
		frameGeo.value = { ...sheet.frame, rail: sheet.rail, tongue: sheet.tongue };
		canisters.value = sheet.canisters.map((can, k) => {
			const roll = rollById.get(can.run)!;
			return { ...can, k, stock: roll.stock, stockLabel: roll.stockLabel };
		});
		stickers.value = sheet.stickers.map((tag, k) => {
			const roll = rollById.get(tag.run)!;
			return { ...tag, k, ...stickerText(roll.title, tag.w, tag.h), tilt: tiltOf(roll.id) };
		});
		strips.value = sheet.strips.map((strip) => ({
			...strip,
			frames: strip.frames.map((fr) => ({
				...fr,
				n: props.photos[fr.idx].n,
				stock: props.rolls[props.photos[fr.idx].r].stockLabel.toUpperCase(),
			})),
		}));
		order = groups.value.flatMap((g) => g.items);
		order.forEach((i, k) => {
			const c = sheet.centers.get(i)!;
			const size = sizeOf(i);
			// Frames sit along the film as developed: landscape on strips across
			// the page, portrait on strips standing down it. A shot taken the
			// other way round lies sideways in its frame (turned clockwise).
			const frameTall = sheet.frame.h > sheet.frame.w;
			const turn = size.h > size.w !== frameTall;
			const s = turn
				? Math.min(sheet.frame.w / size.h, sheet.frame.h / size.w)
				: Math.min(sheet.frame.w / size.w, sheet.frame.h / size.h);
			next.set(i, { x: c.x, y: c.y, r: turn ? 90 : 0, s, z: k + 1 });
		});
	}

	const before = targets;
	targets = next;
	const leaving = rendered.value.filter((i) => !next.has(i));
	rendered.value = [...order, ...leaving];
	await nextTick();
	if (my !== gen) return;

	hideGlow();
	const reduce = prefersReducedMotion();

	if (kind === 'instant') {
		for (const [i, t] of next) {
			const el = els.get(i);
			if (!el) continue;
			gsap.killTweensOf(el);
			gsap.set(el, { xPercent: -50, yPercent: -50, x: t.x, y: t.y, rotation: t.r, scale: t.s, opacity: 1, zIndex: t.z * 2 });
		}
		leaving.forEach(drop);
		return;
	}

	if (kind === 'toss') {
		pile.forEach((e, k) => {
			const el = els.get(e.i);
			if (el) tossIn(el, next.get(e.i)!, k, pile.length, reduce);
		});
		return;
	}

	// shift: re-file the desk. Staying prints glide; newcomers arrive; the rest go.
	const each = Math.min(0.012, 0.45 / Math.max(1, order.length));
	order.forEach((i, k) => {
		const el = els.get(i);
		const t = next.get(i)!;
		if (!el) return;
		if (!before.has(i)) {
			if (mode.value === 'pile') {
				tossIn(el, t, k, order.length, reduce);
			} else {
				gsap.set(el, {
					xPercent: -50,
					yPercent: -50,
					x: t.x,
					y: t.y + (reduce ? 0 : 40),
					rotation: t.r,
					scale: t.s * (reduce ? 1 : 0.94),
					opacity: 0,
					zIndex: t.z * 2,
				});
				gsap.to(el, {
					y: t.y,
					scale: t.s,
					opacity: 1,
					duration: reduce ? 0.3 : 0.6,
					delay: reduce ? 0 : 0.2 + k * each,
					ease: 'power3.out',
					overwrite: true,
				});
			}
			return;
		}
		// Returning to the pile restacks immediately so prints land in order.
		if (mode.value === 'pile') gsap.set(el, { zIndex: t.z * 2 });
		gsap.to(el, {
			x: t.x,
			y: t.y,
			rotation: t.r,
			scale: t.s,
			opacity: 1,
			duration: reduce ? 0 : 0.85,
			delay: reduce ? 0 : k * each,
			ease: 'power3.inOut',
			overwrite: true,
			onComplete: () => {
				if (mode.value === 'grid') gsap.set(el, { zIndex: t.z * 2 });
			},
		});
	});

	leaving.forEach((i) => {
		const el = els.get(i);
		if (!el) return drop(i);
		gsap.to(el, {
			opacity: 0,
			y: `+=${reduce ? 0 : 36}`,
			scale: Number(gsap.getProperty(el, 'scale')) * (reduce ? 1 : 0.9),
			duration: reduce ? 0.2 : 0.35,
			ease: 'power2.in',
			overwrite: true,
			onComplete: () => drop(i),
		});
	});
}

/** Forget a print that has finished leaving — unless a newer layout wants it back. */
function drop(i: number) {
	if (!targets.has(i)) rendered.value = rendered.value.filter((x) => x !== i);
}

/**
 * One print thrown onto the desk from the viewer's side: it rises off the
 * bottom edge large (close to the camera), shrinks as it falls to the
 * surface, touches down a little short, and skids into place.
 */
function tossIn(el: HTMLElement, t: Target, k: number, n: number, reduce: boolean) {
	const lift = el.querySelector<HTMLElement>('.print-lift');
	gsap.killTweensOf([el, lift]);
	if (reduce) {
		gsap.set(el, { xPercent: -50, yPercent: -50, x: t.x, y: t.y, rotation: t.r, scale: t.s, opacity: 0, zIndex: t.z * 2 });
		gsap.to(el, { opacity: 1, duration: 0.4, delay: Math.min(k * 0.01, 0.4) });
		return;
	}
	const size = { w: el.offsetWidth, h: el.offsetHeight };
	const fromX = geo.W * (0.5 + (Math.random() - 0.5) * 0.8);
	const fromY = deskHeight.value + size.h * (0.8 + Math.random() * 0.6);
	const dx = t.x - fromX;
	const dy = t.y - fromY;
	const len = Math.hypot(dx, dy) || 1;
	const skid = 12 + Math.random() * 22;
	const spin = (Math.random() - 0.5) * 80;
	const flight = 0.5 + Math.random() * 0.15;
	const each = Math.min(0.05, 1.8 / Math.max(1, n));

	gsap.set(el, {
		xPercent: -50,
		yPercent: -50,
		x: fromX,
		y: fromY,
		rotation: t.r + spin,
		scale: t.s * 1.6,
		opacity: 0,
		zIndex: t.z * 2,
	});
	if (lift) gsap.set(lift, { opacity: 1 });
	gsap
		.timeline({ delay: 0.15 + k * each })
		.to(el, { opacity: 1, duration: 0.1, ease: 'none' }, 0)
		.to(el, { x: t.x - (dx / len) * skid, y: t.y - (dy / len) * skid, duration: flight, ease: 'power1.out' }, 0)
		.to(el, { scale: t.s, duration: flight, ease: 'power2.in' }, 0)
		.to(el, { rotation: t.r - spin * 0.08, duration: flight, ease: 'power1.out' }, 0)
		.to(lift, { opacity: 0, duration: flight, ease: 'power2.in', clearProps: 'opacity' }, 0)
		.to(el, { x: t.x, y: t.y, rotation: t.r, duration: 0.45, ease: 'power3.out' }, flight);
}

async function retoss() {
	if (mode.value !== 'pile') return;
	const my = ++gen;
	const reduce = prefersReducedMotion();
	hideGlow();
	// Sweep the old pile off the bottom edge, then throw a fresh one.
	if (!reduce) {
		rendered.value.forEach((i, k) => {
			const el = els.get(i);
			if (!el) return;
			gsap.to(el, {
				y: `+=${geo.H * 0.6}`,
				rotation: `+=${(Math.random() - 0.5) * 50}`,
				opacity: 0,
				duration: 0.45,
				delay: k * 0.004,
				ease: 'power2.in',
				overwrite: true,
			});
		});
	}
	buildPile();
	await Promise.all([preload(topOfPile()), new Promise((r) => setTimeout(r, reduce ? 0 : 520))]);
	if (my !== gen) return;
	targets = new Map();
	rendered.value = [];
	await nextTick();
	applyLayout('toss');
}

const topOfPile = (n = 24) => pile.slice(-n).map((e) => e.i);

/** Heading for one group: what it is, its name, and how much is in it. */
function groupInfo(f: FacetKey, key: string) {
	const items = groups.value.find((g) => g.key === key)?.items ?? [];
	const rollsIn = new Set(items.map((i) => props.photos[i].r)).size;
	return {
		eyebrow: FILTER_FACETS.find((x) => x.key === f)?.title ?? '',
		label: labelOf[f].get(key) ?? key,
		meta: `${plural(items.length, 'frame')} · ${plural(rollsIn, 'roll')}`,
	};
}

/**
 * The roll's name as a lab tech would write it on the leader's sticker: in
 * marker, broken over up to three lines to write as large as the sticker
 * allows (the marker face runs about 0.6em per character).
 */
function stickerText(title: string, w: number, h: number) {
	const innerW = w * 0.82;
	const innerH = h * 0.74;
	const { lines, score } = bestSplit(title, 3, (ls) => {
		const longest = Math.max(...ls.map((l) => l.length));
		return Math.min(innerH / (ls.length * 1.08), innerW / (longest * 0.6), h * 0.34);
	});
	return { lines, fs: Math.max(8, Math.round(score * 10) / 10) };
}

/** Each sticker goes on a little crooked — always the same way for a given roll. */
const tiltOf = (id: string) => ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 3) % 9) - 5;

/* ── Hover glow ─────────────────────────────────────────────────────── */

// One shared glow (a blurred copy of the hovered print, tucked directly
// beneath it) instead of a filter layer per print.
let glowFor = -1;

function syncGlow() {
	const el = els.get(glowFor);
	const glow = glowRef.value;
	if (!el || !glow) return;
	gsap.set(glow, {
		x: gsap.getProperty(el, 'x'),
		y: gsap.getProperty(el, 'y'),
		rotation: gsap.getProperty(el, 'rotation'),
		scale: gsap.getProperty(el, 'scale'),
		zIndex: Number(gsap.getProperty(el, 'zIndex')) - 1,
	});
}

function showGlow(i: number) {
	const glow = glowRef.value;
	const el = els.get(i);
	if (!glow || !el || glowFor === i) return;
	const firstShow = glowFor < 0;
	glowFor = i;
	const size = sizeOf(i);
	gsap.set(glow, { xPercent: -50, yPercent: -50, width: size.w, height: size.h });
	(glow.firstElementChild as HTMLElement).style.backgroundImage = `url("${thumbUrl(i)}")`;
	syncGlow();
	if (firstShow) gsap.ticker.add(syncGlow);
	gsap.fromTo(glow, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out', overwrite: true });
}

function hideGlow(i?: number) {
	if (glowFor < 0 || (i !== undefined && i !== glowFor)) return;
	glowFor = -1;
	gsap.ticker.remove(syncGlow);
	if (glowRef.value) gsap.to(glowRef.value, { opacity: 0, duration: 0.25, ease: 'power2.out', overwrite: true });
}

function onPointerEnter(e: PointerEvent, i: number) {
	if (e.pointerType === 'mouse' && !drag) showGlow(i);
}

function onPointerLeave(i: number) {
	if (!drag) hideGlow(i);
}

/** Keyboard focus lifts the print to the top of the pile so it's actually visible. */
function onFocus(i: number) {
	const el = els.get(i);
	if (!el?.matches(':focus-visible')) return;
	raise(i);
	showGlow(i);
}

function raise(i: number) {
	if (mode.value !== 'pile') return;
	const entry = pile.find((e) => e.i === i);
	const el = els.get(i);
	if (!entry || !el) return;
	entry.z = ++zTop;
	const t = targets.get(i);
	if (t) t.z = entry.z;
	gsap.set(el, { zIndex: entry.z * 2 });
}

/* ── Dragging (pile only) ───────────────────────────────────────────── */

interface Drag {
	i: number;
	el: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	x0: number;
	y0: number;
	r0: number;
	moved: boolean;
	lastX: number;
	lastY: number;
	lastT: number;
	vx: number;
	vy: number;
	tilt?: (value: number) => void;
}
let drag: Drag | null = null;
let suppressClick = false;

function onPointerDown(e: PointerEvent, i: number) {
	suppressClick = false;
	if (mode.value !== 'pile' || e.button !== 0 || !e.isPrimary) return;
	const el = els.get(i);
	if (!el) return;
	drag = {
		i,
		el,
		pointerId: e.pointerId,
		startX: e.clientX,
		startY: e.clientY,
		x0: Number(gsap.getProperty(el, 'x')),
		y0: Number(gsap.getProperty(el, 'y')),
		r0: targets.get(i)?.r ?? Number(gsap.getProperty(el, 'rotation')),
		moved: false,
		lastX: e.clientX,
		lastY: e.clientY,
		lastT: performance.now(),
		vx: 0,
		vy: 0,
	};
}

function onPointerMove(e: PointerEvent, i: number) {
	const d = drag;
	if (!d || d.i !== i || e.pointerId !== d.pointerId) return;
	const dx = e.clientX - d.startX;
	const dy = e.clientY - d.startY;
	if (!d.moved) {
		if (Math.hypot(dx, dy) < 6) return;
		// Picked up: it comes to the top of the pile and lifts off the desk.
		d.moved = true;
		d.el.setPointerCapture(e.pointerId);
		gsap.killTweensOf(d.el);
		raise(i);
		d.el.classList.add('is-lifted');
		d.tilt = gsap.quickTo(d.el, 'rotation', { duration: 0.4, ease: 'power3' });
		dragging.value = true;
	}
	const now = performance.now();
	const dt = Math.max(8, now - d.lastT) / 1000;
	d.vx = d.vx * 0.6 + ((e.clientX - d.lastX) / dt) * 0.4;
	d.vy = d.vy * 0.6 + ((e.clientY - d.lastY) / dt) * 0.4;
	d.lastX = e.clientX;
	d.lastY = e.clientY;
	d.lastT = now;
	gsap.set(d.el, {
		x: clamp(d.x0 + dx, 0, geo.W),
		y: clamp(d.y0 + dy, 0, deskHeight.value),
	});
	// Swings a little with the motion, like paper dragged by a corner.
	d.tilt?.(d.r0 + clamp(d.vx / 140, -9, 9));
}

function onPointerUp(e: PointerEvent, i: number) {
	const d = drag;
	if (!d || d.i !== i || e.pointerId !== d.pointerId) return;
	drag = null;
	if (!d.moved) return; // a plain click — the click handler opens it
	suppressClick = true;
	dragging.value = false;
	d.el.classList.remove('is-lifted');

	// A flick carries the print on a little before friction wins.
	const size = sizeOf(i);
	const fling = e.type === 'pointercancel' ? 0 : 0.12;
	const carry = (v: number) => clamp(v * fling, -140, 140);
	const x = clamp(Number(gsap.getProperty(d.el, 'x')) + carry(d.vx), size.w / 2, geo.W - size.w / 2);
	const y = clamp(Number(gsap.getProperty(d.el, 'y')) + carry(d.vy), size.h / 2, deskHeight.value - size.h / 2);
	const r = clamp(d.r0 + d.vx * 0.006, d.r0 - 14, d.r0 + 14);
	gsap.to(d.el, { x, y, rotation: r, duration: 0.6, ease: 'power3.out', overwrite: true });

	const entry = pile.find((p) => p.i === i);
	const t = targets.get(i);
	const area = pileArea();
	if (entry) entry.slot = { u: x / area.w, v: (y - geo.top) / area.h, r };
	if (t) Object.assign(t, { x, y, r });
	if (e.pointerType === 'mouse' && d.el.matches(':hover')) showGlow(i);
}

function onPrintClick(i: number) {
	if (suppressClick) {
		suppressClick = false;
		return;
	}
	// On the pile a print opens within its roll; in the grid, within the grid.
	const list = mode.value === 'pile' ? framesByRoll[props.photos[i].r] : groups.value.flatMap((g) => g.items);
	window.dispatchEvent(
		new CustomEvent('open-lightbox', { detail: { photos: list.map(toLightbox), index: list.indexOf(i) } })
	);
}

/* ── Lifecycle ──────────────────────────────────────────────────────── */

const layoutKey = computed(() => `${mode.value}|${facetOrder.value[0] ?? ''}|${filtered.value.join(',')}`);

watch(layoutKey, () => {
	if (!ready) return;
	writeUrl();
	applyLayout('shift');
	// Re-filing while scrolled deep into a long grid: start again from its top.
	if (scrollTopOf() > 8) {
		document.body.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
	}
});

let lastW = 0;
let lastVH = 0;
let resizeTimer = 0;
function onResize() {
	window.clearTimeout(resizeTimer);
	resizeTimer = window.setTimeout(() => {
		const w = deskRef.value?.clientWidth ?? 0;
		// Mobile URL-bar show/hide changes the height constantly; ignore small shifts.
		if (w === lastW && Math.abs(window.innerHeight - lastVH) < 120) return;
		lastW = w;
		lastVH = window.innerHeight;
		applyLayout('instant');
	}, 160);
}

onMounted(async () => {
	readUrl();
	pruneRolls();
	live.value = true;
	// The masthead's display face can shift the desk's top as it swaps in.
	await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 700))]);
	await nextTick();
	if (!deskRef.value) return;
	measure();
	lastW = geo.W;
	lastVH = window.innerHeight;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	thumbLong = THUMB_STEPS.find((s) => s >= printLong.value * dpr) ?? THUMB_STEPS[THUMB_STEPS.length - 1];

	if (mode.value === 'pile') {
		buildPile();
		await preload(topOfPile());
		if (!deskRef.value) return;
		await applyLayout('toss');
	} else {
		await applyLayout('shift');
	}
	ready = true;
	window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
	gen++;
	window.removeEventListener('resize', onResize);
	window.clearTimeout(resizeTimer);
	gsap.ticker.remove(syncGlow);
	gsap.killTweensOf([...els.values()]);
});
</script>

<style scoped>
.film {
	--film-gutter: max(1.5rem, calc((100% - 80rem) / 2));
	--paper: #fbfaf6;
	--paper-edge: 4px;
	--print-rest: 0 1px 1px rgba(17, 16, 16, 0.08), 0 2px 6px -1px rgba(17, 16, 16, 0.14),
		0 10px 22px -10px rgba(17, 16, 16, 0.22);
	/* Warm rim light on the hovered print, on top of its color halo (.glow). */
	--print-glow: 0 0 0 1px rgba(255, 250, 238, 0.9), 0 0 18px 2px rgba(255, 236, 200, 0.55);
	/* Negative strips: warm film base, darker frame gaps, amber edge print. */
	--neg-base: #211a14;
	--neg-frame: #0f0b09;
	--neg-ink: rgba(232, 168, 82, 0.85);
	position: relative;
}

:root.theme-dark .film {
	--paper: #ece8df;
	--print-rest: 0 0 0 1px rgba(255, 255, 255, 0.04), 0 10px 24px -8px rgba(0, 0, 0, 0.9);
	--print-glow: 0 0 0 1px rgba(255, 250, 238, 0.95), 0 0 28px 6px rgba(255, 238, 205, 0.45);
	--neg-base: #2c241d;
	--neg-frame: #120e0b;
}

/* ── Floating chrome ── */

/* Scrims: the pile fades (and on wide screens, softly blurs) out under the
   nav and under the rolls, so both stay legible over any photo. */
.film-nav-scrim,
.film-bottom::before {
	--scrim: var(--gray-999) 0%, color-mix(in srgb, var(--gray-999) 92%, transparent) 45%,
		color-mix(in srgb, var(--gray-999) 70%, transparent) 72%, transparent;
	pointer-events: none;
}

.film-nav-scrim {
	position: fixed;
	inset: 0 0 auto;
	z-index: 3;
	/* --film-nav-h is measured from the nav at runtime; this is the pre-hydration guess. */
	height: calc(var(--film-nav-h, 4.75rem) + 2.5rem);
	background: linear-gradient(to bottom, var(--scrim));
}

.film-bottom {
	position: fixed;
	inset: auto 0 0;
	z-index: 4;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	padding-bottom: max(1rem, env(safe-area-inset-bottom));
	pointer-events: none;
}

.film-bottom > * {
	pointer-events: auto;
}

.film-bottom::before {
	content: '';
	position: absolute;
	inset: -3rem 0 0;
	z-index: -1;
	background: linear-gradient(to top, var(--scrim));
}

@media (min-width: 50em) {
	.film-nav-scrim,
	.film-bottom::before {
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.film-nav-scrim {
		mask-image: linear-gradient(to bottom, #000 60%, transparent);
	}

	.film-bottom::before {
		mask-image: linear-gradient(to top, #000 70%, transparent);
	}
}

/* Its option lists open upward over the rolls. */
.film-bottom > .film-dock {
	position: relative;
	z-index: 2;
}

/* ── The desk: the whole page ── */

.desk {
	position: relative;
	z-index: 1;
	height: 100svh;
	overflow: hidden;
	isolation: isolate;
	touch-action: pan-y;
}

@media (prefers-reduced-motion: no-preference) {
	.desk {
		transition: height 650ms cubic-bezier(0.65, 0, 0.35, 1);
	}
}

/* ── Prints ── */

.print {
	position: absolute;
	top: 0;
	left: 0;
	padding: 0;
	border: 0;
	background: none;
	opacity: 0;
	cursor: grab;
	touch-action: pan-y pinch-zoom;
	-webkit-tap-highlight-color: transparent;
	will-change: transform;
}

.is-grid .print {
	cursor: zoom-in;
	touch-action: manipulation;
}

/* ── Negative strips (organized view) ── */

.neg-strip {
	/* Real 35mm proportions, scaled from the rail: holes ~2mm in a 5.5mm rail,
	   ~4.75mm apart, about 2mm in from the edge. */
	--hole-h: calc(var(--rail) * 0.36);
	--hole-w: calc(var(--hole-h) * 1.4);
	--hole-y: calc(var(--rail) * 0.36);
	--pitch: calc(var(--rail) * 0.9);
	--holes:
		linear-gradient(90deg, #000 0 var(--hole-w), transparent var(--hole-w)) calc(var(--pitch) * 0.3)
			var(--hole-y) / var(--pitch) var(--hole-h) repeat-x,
		linear-gradient(90deg, #000 0 var(--hole-w), transparent var(--hole-w)) calc(var(--pitch) * 0.3)
			calc(100% - var(--hole-y)) / var(--pitch) var(--hole-h) repeat-x;
	position: absolute;
	z-index: 0;
	border-radius: 2px;
	background: var(--neg-base);
	/* Holes punched through to the desk. */
	-webkit-mask: var(--holes), linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask: var(--holes), linear-gradient(#000 0 0);
	mask-composite: exclude;
}

/* Standing strips (phones): rails, holes and edge print run down the sides. */
.is-vertical .neg-strip {
	--holes:
		linear-gradient(180deg, #000 0 var(--hole-w), transparent var(--hole-w)) var(--hole-y)
			calc(var(--pitch) * 0.3) / var(--hole-h) var(--pitch) repeat-y,
		linear-gradient(180deg, #000 0 var(--hole-w), transparent var(--hole-w)) calc(100% - var(--hole-y))
			calc(var(--pitch) * 0.3) / var(--hole-h) var(--pitch) repeat-y;
}

/* The exposed frame itself — the photo settles over it (and, when a photo
   doesn't fill the frame, it shows around the edges like unexposed film). */
.neg-window {
	position: absolute;
	width: var(--fw);
	height: var(--fh);
	border-radius: 1px;
	background: var(--neg-frame);
}

/* Edge printing: stock name along the top, frame numbers along the bottom. */
.neg-edge {
	position: absolute;
	inset: 0 auto;
	width: var(--fw);
	color: var(--neg-ink);
	font-family: var(--font-body);
	font-size: calc(var(--rail) * 0.3);
	font-weight: 600;
	line-height: 1;
	letter-spacing: 0.08em;
	white-space: nowrap;
	pointer-events: none;
}

.neg-stock,
.neg-num {
	position: absolute;
	overflow: hidden;
}

.neg-stock {
	top: calc(var(--rail) * 0.04);
	left: 5%;
	max-width: 95%;
}

.neg-num {
	bottom: calc(var(--rail) * 0.04);
	left: 6%;
}

.neg-num--half {
	left: 56%;
}

.is-vertical .neg-edge {
	inset: auto 0;
	width: auto;
	height: var(--fh);
}

.is-vertical .neg-stock,
.is-vertical .neg-num {
	writing-mode: vertical-rl;
}

.is-vertical .neg-stock {
	top: 5%;
	right: calc(var(--rail) * 0.04);
	left: auto;
	max-width: none;
	max-height: 95%;
}

.is-vertical .neg-num {
	top: 6%;
	left: calc(var(--rail) * 0.04);
	bottom: auto;
}

.is-vertical .neg-num--half {
	top: 56%;
}

.neg-leave-active {
	transition: opacity 300ms ease;
}

.neg-leave-to {
	opacity: 0;
}

@media (prefers-reduced-motion: no-preference) {
	/* Re-filing slides strips to their new rows (box properties — not
	   transform, which would hand them to TransitionGroup's FLIP). */
	.neg-strip {
		transition:
			left 850ms cubic-bezier(0.65, 0, 0.35, 1),
			top 850ms cubic-bezier(0.65, 0, 0.35, 1),
			width 850ms cubic-bezier(0.65, 0, 0.35, 1),
			height 850ms cubic-bezier(0.65, 0, 0.35, 1);
		animation: neg-in 700ms calc(min(var(--k), 12) * 45ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
	}

	.is-vertical .neg-strip {
		animation-name: neg-in-down;
	}

	/* A new strip pulls out from its head end. */
	@keyframes neg-in {
		from {
			clip-path: inset(0 100% 0 0);
		}
	}

	@keyframes neg-in-down {
		from {
			clip-path: inset(0 0 100% 0);
		}
	}
}

.is-dragging,
.is-dragging .print {
	cursor: grabbing;
}

.print-body {
	position: absolute;
	inset: 0;
	padding: var(--paper-edge);
	/* Until its scan arrives, a print is blank paper with a faint warm cast. */
	background:
		linear-gradient(color-mix(in srgb, var(--paper) 82%, #8a7d64) 0 0) content-box,
		var(--paper);
	box-shadow: var(--print-rest);
	transition:
		scale 260ms cubic-bezier(0.33, 1, 0.68, 1),
		box-shadow 260ms ease,
		padding 600ms cubic-bezier(0.33, 1, 0.68, 1),
		background-color 600ms ease;
}

/* Filed into a strip, a print sheds its paper border and becomes a frame. */
.is-grid .print-body {
	padding: 0;
	background-color: var(--neg-frame);
	box-shadow: none;
}

.print-body img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	opacity: 0;
	pointer-events: none;
	user-select: none;
	-webkit-user-drag: none;
	transition: opacity 400ms ease;
}

.print-body img.is-loaded {
	opacity: 1;
}

/* Height shadow: strong while a print is in the air, gone once it lands. */
.print-lift {
	position: absolute;
	inset: 0;
	opacity: 0;
	box-shadow:
		0 28px 56px -14px rgba(0, 0, 0, 0.42),
		0 14px 26px -14px rgba(0, 0, 0, 0.32);
	transition: opacity 300ms ease;
	pointer-events: none;
}

.print:hover .print-body,
.print:focus-visible .print-body {
	scale: 1.035;
	box-shadow: var(--print-glow), var(--print-rest);
}

.print.is-lifted .print-body {
	scale: 1.06;
}

.print.is-lifted .print-lift {
	opacity: 1;
}

.print:focus-visible {
	outline: none;
}

.print:focus-visible .print-body {
	outline: 2px solid var(--accent-regular);
	outline-offset: 3px;
}

/* ── Glow: the hovered print's own colors, blurred into light beneath it ── */

.glow {
	position: absolute;
	top: 0;
	left: 0;
	opacity: 0;
	pointer-events: none;
}

.glow-light {
	position: absolute;
	inset: -24%;
	border-radius: 24%;
	background-position: center;
	background-size: cover;
	filter: blur(30px) saturate(2.2) brightness(1.2);
}

/* On the dark desk the halo adds light to whatever it falls on. (The blend
   sits on .glow, not its child: .glow is its own stacking context, so a child
   would only blend with an empty group.) */
:root.theme-dark .glow {
	mix-blend-mode: screen;
}

:root.theme-dark .glow-light {
	filter: blur(34px) saturate(2.2) brightness(1.6);
}

/* ── A roll's two ends ── */

@keyframes head-in {
	from {
		opacity: 0;
	}
}

/* The last strip's base stops short of its cut tongue (drawn by the SVG). */
.neg-strip.is-tail {
	background: linear-gradient(var(--neg-base) 0 0) 0 0 / calc(100% - var(--tongue) + 1px) 100% no-repeat;
}

.is-vertical .neg-strip.is-tail {
	background-size: 100% calc(100% - var(--tongue) + 1px);
}

.neg-tongue {
	position: absolute;
	top: 0;
	right: 0;
	width: var(--tongue);
	height: 100%;
	fill: var(--neg-base);
}

.is-vertical .neg-tongue {
	top: auto;
	bottom: 0;
	width: 100%;
	height: var(--tongue);
}

/* The canister at the head of a roll, its film running out of the felt lip
   into the first strip (which starts tucked underneath). */
.desk > .desk-can {
	position: absolute;
	z-index: 1;
	filter: drop-shadow(0 8px 10px rgba(17, 16, 16, 0.25));
	animation: head-in 450ms calc(min(var(--k), 12) * 60ms) ease-out backwards;
}

/* Standing strips: the canister lies across the head of the first one, lip down. */
.desk > .desk-can.is-lying {
	rotate: 90deg;
}

:root.theme-dark .desk > .desk-can {
	filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.8));
}

/* The lab's sticker on the leader: a slip of cream label stock, slapped on a
   little crooked, the roll's name written in marker. */
.lab-sticker {
	position: absolute;
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	border-radius: 2px;
	background:
		linear-gradient(170deg, rgba(255, 255, 255, 0.55), transparent 45%),
		linear-gradient(to bottom, transparent 0 12%, rgba(120, 150, 190, 0.18) 12% 14%, transparent 14%),
		#efe8d6;
	box-shadow:
		0 1px 1px rgba(0, 0, 0, 0.3),
		0 4px 10px -4px rgba(0, 0, 0, 0.45);
	color: #18191d;
	font-family: 'Permanent Marker', var(--font-brand), cursive;
	font-size: var(--fs);
	line-height: 1.05;
	text-align: center;
	rotate: var(--tilt);
	animation: slap-on 420ms calc(300ms + min(var(--k), 12) * 60ms) cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards;
}

/* Handwriting never sits quite level. */
.lab-sticker span:nth-child(2) {
	rotate: 1.2deg;
	translate: 0.15em 0;
}

.lab-sticker span:nth-child(3) {
	rotate: -0.8deg;
}

@keyframes slap-on {
	from {
		opacity: 0;
		scale: 1.25;
	}
}

@media (prefers-reduced-motion: reduce) {
	.desk-can,
	.lab-sticker {
		animation: none;
	}
}

/* A quiet heading per group: what it is, its name, a hairline, the count. */
.group-head {
	position: absolute;
	top: 0;
	display: flex;
	align-items: baseline;
	gap: 0.6rem;
	margin: 0;
	padding-top: 0.25rem;
	font-weight: 400;
	animation: head-in 500ms 250ms cubic-bezier(0.33, 1, 0.68, 1) backwards;
}

@media (prefers-reduced-motion: no-preference) {
	.group-head {
		transition: transform 850ms cubic-bezier(0.65, 0, 0.35, 1);
	}
}

.group-eyebrow,
.group-meta {
	flex: none;
	font-family: var(--font-body);
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.group-title {
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	font-family: var(--font-brand);
	font-size: var(--text-md);
	font-weight: 500;
	color: var(--gray-100);
}

.group-rule {
	flex: 1;
	min-width: 1rem;
	height: 1px;
	align-self: center;
	background: var(--gray-800);
}

@media (max-width: 40em) {
	.group-eyebrow {
		display: none;
	}
}

.desk-empty {
	position: absolute;
	inset: 40% 1.5rem auto;
	text-align: center;
	font-style: italic;
	color: var(--gray-300);
}

@media (max-width: 40em) {
	.film {
		--paper-edge: 3px;
	}
}
</style>
