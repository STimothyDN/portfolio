<template>
	<div
		ref="rootRef"
		class="film"
		:class="{ 'is-live': live, 'is-grid': mode === 'grid', 'is-dragging': dragging, 'is-negative': negative }"
	>
		<!-- Keeps the floating site nav legible over the pile. -->
		<div class="film-nav-scrim" aria-hidden="true"></div>

		<!-- Floating along the bottom, under the pile: the rolls, then the
		     controls. Before the desk in the DOM so keyboard users reach both
		     without tabbing through every print. -->
		<div ref="bottomRef" class="film-bottom">
			<FilmRollStrip
				ref="rollStripRef"
				:rolls="rolls"
				:selected="selected.roll"
				:counts="rollCounts"
				:status="status"
				:negative="negative"
				:state="rollsState"
				:current="rollsCurrent"
				@toggle-open="rollsState = NEXT_ROLLS_STATE[rollsCurrent]"
				@toggle="pickRoll"
			/>
			<FilmFilterDock
				class="film-dock"
				:facets="FILTER_FACETS"
				:options="options"
				:has-filters="hasFilters"
				:negative="negative"
				@negative="negative = !negative"
				@toggle="toggle"
				@toggle-many="toggleMany"
				@clear="clearAll"
				@toss="retoss"
			>
				<slot />
			</FilmFilterDock>

			<!-- Zoom for the pile: on smaller screens the desk runs off the edges. -->
			<Transition name="zoom">
				<div v-if="live && mode === 'pile'" class="zoom" role="group" aria-label="Zoom the desk">
					<button type="button" class="zoom-btn" :disabled="zoomAt === 'max'" aria-label="Zoom in" @click="zoomBy(1.5)">
						<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M128 64v128M64 128h128" /></svg>
					</button>
					<button type="button" class="zoom-btn" :disabled="zoomAt === 'fit'" aria-label="Zoom out" @click="zoomBy(1 / 1.5)">
						<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M64 128h128" /></svg>
					</button>
					<button
						type="button"
						class="zoom-btn"
						:disabled="zoomAt === 'fit'"
						aria-label="Show the whole desk"
						@click="zoomToFit"
					>
						<svg viewBox="0 0 256 256" aria-hidden="true">
							<path d="M160 48h48v48M96 208H48v-48M208 160v48h-48M48 96V48h48" />
						</svg>
					</button>
				</div>
			</Transition>
		</div>

		<!-- In the pile, the desk is a surface to explore: drag (or scroll) to pan,
		     pinch (or ctrl-scroll) to zoom; touch picks a print up on a long press. -->
		<div
			ref="deskRef"
			class="desk"
			:class="{ 'is-vertical': vertical }"
			:style="deskStyle"
			role="region"
			aria-label="Film prints"
			@pointerdown="onDeskDown"
			@pointermove="onDeskMove"
			@pointerup="onDeskUp"
			@pointercancel="onDeskUp"
			@dblclick="onDeskDblClick"
			@contextmenu="onContextMenu"
		>
			<!-- The camera: panned and scaled over the pile, identity once filed. -->
			<div ref="worldRef" class="desk-world">
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
						:class="{ 'is-tail': strip.tail, 'is-mono': strip.mono }"
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
						:stock-brand="can.stockBrand"
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

				<!-- A print's markup only depends on the print size and whether it's
				     in the pile (eager image); memoizing on those keeps state flips
				     like `dragging` from re-diffing hundreds of filed prints. -->
				<button
					v-for="i in rendered"
					:key="i"
					v-memo="[printLong, pileSet.has(i), sharp.get(i)]"
					:ref="(el) => setPrintEl(i, el)"
					type="button"
					class="print"
					:class="{ 'is-mono': rolls[photos[i].r].mono }"
					:style="{ width: `${sizeOf(i).w}px`, height: `${sizeOf(i).h}px` }"
					:data-i="i"
					:aria-label="printLabel(i)"
					@click="onPrintClick(i)"
					@pointerenter="onPointerEnter($event, i)"
					@pointerleave="onPointerLeave(i)"
					@focus="onFocus(i)"
					@blur="hideGlow(i)"
				>
					<span class="print-lift" aria-hidden="true"></span>
					<span class="print-body">
						<img
							:src="printSrc(i)"
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
import { unpackFilmPhotos } from './data';
import { bunnyUrl } from '../../utils/bunny';
import {
	clamp,
	deskWorld,
	layoutStrips,
	layoutPile,
	mulberry32,
	pileCapacity,
	printSize,
	priorityWeight,
	stackOrder,
	weightedSample,
	type DeskWorld,
	type PileSlot,
} from './layout';
import type { FacetKey, FacetOption, FilmPhotoData, FilmRollData, RollsState } from './types';

// Every frame on every roll, packed into one string by the page (data.ts) —
// static for the island's lifetime, so a plain array, not reactive state.
const props = defineProps<{ rolls: FilmRollData[]; packedPhotos: string }>();
const photos: FilmPhotoData[] = unpackFilmPhotos(props.packedPhotos);

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
const facetOf = photos.map((p) => {
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

// Makers of each camera and film stock, for the brand buttons.
const brandOf: Partial<Record<FacetKey, Map<string, string>>> = {
	camera: new Map(props.rolls.map((r) => [r.camera, r.cameraBrand])),
	stock: new Map(props.rolls.map((r) => [r.stock, r.stockBrand])),
};

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

/* ── Filter state ───────────────────────────────────────────────────── */

const selected = reactive<Record<FacetKey, string[]>>({ roll: [], camera: [], stock: [], lab: [], year: [] });
// Facets in the order they were first switched on. The first one decides how
// the grid is grouped; later ones only whittle it down.
const facetOrder = ref<FacetKey[]>([]);

const hasFilters = computed(() => facetOrder.value.length > 0);
const mode = computed<'pile' | 'grid'>(() => (hasFilters.value ? 'grid' : 'pile'));

const matches = (i: number, except?: FacetKey) =>
	facetOrder.value.every((f) => f === except || selected[f].includes(facetOf[i][f]));

const filtered = computed(() => photos.map((_, i) => i).filter((i) => matches(i)));

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
		photos.forEach((_, i) => {
			if (matches(i, f)) counts.set(facetOf[i][f], (counts.get(facetOf[i][f]) ?? 0) + 1);
		});
		out[f] = universe[f].map((value) => ({
			value,
			label: labelOf[f].get(value) ?? value,
			count: counts.get(value) ?? 0,
			selected: selected[f].includes(value),
			brand: brandOf[f]?.get(value),
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

/** Select (or clear) several values of one facet at once — a whole brand. */
function toggleMany(f: FacetKey, values: string[], on: boolean) {
	const list = selected[f];
	selected[f] = on ? [...list, ...values.filter((v) => !list.includes(v))] : list.filter((v) => !values.includes(v));
	if (selected[f].length && !facetOrder.value.includes(f)) facetOrder.value = [...facetOrder.value, f];
	if (!selected[f].length) facetOrder.value = facetOrder.value.filter((x) => x !== f);
	if (f !== 'roll') pruneRolls();
}

// Rolls are picked one at a time: choosing another replaces the current one,
// and choosing the current one again puts it back.
function pickRoll(id: string) {
	const current = selected.roll[0];
	if (current && current !== id) selected.roll = [];
	toggle('roll', id);
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
	const total = photos.length;
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
		// One roll at a time, even from a hand-edited link.
		selected[f] = f === 'roll' ? values.slice(0, 1) : values;
		if (!facetOrder.value.includes(f)) facetOrder.value = [...facetOrder.value, f];
	}
}

/* ── Prints ─────────────────────────────────────────────────────────── */

const live = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const deskRef = ref<HTMLElement | null>(null);
const worldRef = ref<HTMLElement | null>(null);
const glowRef = ref<HTMLElement | null>(null);
const bottomRef = ref<HTMLElement | null>(null);
const rollStripRef = ref<InstanceType<typeof FilmRollStrip> | null>(null);

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
		mono: boolean;
		frames: { idx: number; x: number; y: number; n: number; stock: string }[];
	}[]
>([]);
const heads = ref<{ key: string; x: number; y: number; w: number; eyebrow: string; label: string; meta: string }[]>([]);
const canisters = ref<
	{ key: string; x: number; y: number; h: number; k: number; stock: string; stockLabel: string; stockBrand: string }[]
>([]);
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

// Roll selector: open, rewound onto its shelf, or put away entirely. The
// toggle steps through them in that order and loops. null = the screen's
// default (open on desktop, put away on phones — CSS applies it, so there's
// no flash).
const NEXT_ROLLS_STATE = { open: 'closed', closed: 'away', away: 'open' } as const;
const rollsState = ref<RollsState | null>(null);
const narrow = ref(false);
const rollsCurrent = computed<RollsState>(() => rollsState.value ?? (narrow.value ? 'away' : 'open'));

// Negative view: strips show as color negatives (a viewer convenience, kept
// in this browser only; it starts off and is read after hydration).
const negative = ref(false);
const NEGATIVE_KEY = 'film-negative';
watch(negative, (on) => {
	try {
		localStorage.setItem(NEGATIVE_KEY, on ? '1' : '0');
	} catch {
		/* storage unavailable — the toggle still works for this visit */
	}
});

const els = new Map<number, HTMLElement>();
const setPrintEl = (i: number, el: unknown) => {
	if (el instanceof HTMLElement) els.set(i, el);
	else els.delete(i);
};

const aspectOf = (i: number) => {
	const p = photos[i];
	return p.w && p.h ? p.w / p.h : 1.5;
};
const sizeOf = (i: number) => printSize(aspectOf(i), printLong.value);

// CDN width for desk thumbnails — fixed once at mount so resizing never
// re-downloads, and shared with the lightbox's blur-up placeholder.
let thumbLong = 480;
const THUMB_STEPS = [360, 480, 600, 720];
const scanPath = (i: number) => `${props.rolls[photos[i].r].folder}/${photos[i].f}`;

// Per-photo derivations never change once thumbLong is set (at mount, before
// any print renders), so each is built at most once: hundreds of prints
// render, and a click in the strips hands the lightbox the whole filed desk.
const thumbUrls = new Map<number, string>();
function thumbUrl(i: number) {
	let url = thumbUrls.get(i);
	if (!url) thumbUrls.set(i, (url = scanUrl(i, thumbLong)));
	return url;
}

function scanUrl(i: number, long: number) {
	const a = aspectOf(i);
	const width = a >= 1 ? long : Math.round((long * a) / 40) * 40;
	return bunnyUrl(scanPath(i), { width, format: 'webp', quality: 72 });
}

// Zoomed in past what the thumbnails hold, the prints in view swap to sharper
// scans (photo index → long edge). Only ever upgrades; see sharpen().
const SHARP_STEPS = [600, 720, 960, 1200];
const sharp = shallowRef(new Map<number, number>());
const printSrc = (i: number) => {
	const long = sharp.value.get(i);
	return long ? scanUrl(i, long) : thumbUrl(i);
};

const fullDates = new Map<string, string>();
const fullDate = (iso: string) => {
	let label = fullDates.get(iso);
	if (!label) {
		label = new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: 'UTC',
		});
		fullDates.set(iso, label);
	}
	return label;
};

function printLabel(i: number) {
	const p = photos[i];
	const roll = props.rolls[p.r];
	return `${p.c ? `${p.c}. ` : ''}Frame ${p.n} of ${roll.title} — ${roll.cameraLabel}, ${roll.stockLabel}`;
}

type LightboxRecord = ReturnType<typeof buildLightboxRecord>;
const lightboxRecords = new Map<number, LightboxRecord>();
const toLightbox = (i: number) => {
	let record = lightboxRecords.get(i);
	if (!record) lightboxRecords.set(i, (record = buildLightboxRecord(i)));
	return record;
};

function buildLightboxRecord(i: number) {
	const p = photos[i];
	const roll = props.rolls[p.r];
	return {
		filename: p.f,
		caption: p.c ?? '',
		label: `${roll.title} — Frame ${p.n}`,
		fullUrl: bunnyUrl(scanPath(i), { width: 2000, format: 'webp', quality: 90 }),
		mono: roll.mono,
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
// The pile's own desk, in desk px — larger than the screen on smaller ones.
let world: DeskWorld = { w: 0, h: 0, long: 200, fit: 1, home: 1, max: 2 };

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
	world = deskWorld({ w: geo.W, h: bandH() });
	printLong.value = world.long;
}

/** Height of the free band between the floating chrome, where the pile sits. */
const bandH = () => geo.H - geo.top - geo.bottom;

/**
 * The slice of the desk on screen, in desk coordinates — widened up to the
 * desk's top when scrolled down, since re-filing a deep grid scrolls back to
 * its top while the prints are moving (see the layoutKey watcher).
 */
function viewBand() {
	const top = -deskRef.value!.getBoundingClientRect().top;
	const scrolled = scrollTopOf();
	return { top: scrolled > 8 ? top - scrolled : top, bottom: top + window.innerHeight };
}

/* ── Camera (pile only) ─────────────────────────────────────────────── */

// screen = world × z + (x, y), relative to the desk's top-left. Once the desk
// is filed into strips it's the identity, and the page scrolls as usual.
interface Cam {
	x: number;
	y: number;
	z: number;
}
type Point = { x: number; y: number };
const IDENTITY: Cam = { x: 0, y: 0, z: 1 };
const cam: Cam = { ...IDENTITY };
let camTween: gsap.core.Tween | null = null;
let camGoal: Cam | null = null;
// Once someone has moved the view, layouts keep it rather than going home.
let camTouched = false;
let pileCam: Cam | null = null;
const zoomAt = ref<'fit' | 'max' | null>('fit');

function renderCam() {
	const el = worldRef.value;
	if (!el) return;
	const still = cam.x === 0 && cam.y === 0 && cam.z === 1;
	el.style.transform = still ? '' : `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
}

/** Where the camera may sit at zoom z: the desk covers the free band, or is centered in it. */
function camBounds(z: number) {
	const ww = world.w * z;
	const wh = world.h * z;
	const bh = bandH();
	const x = ww <= geo.W + 0.5 ? [(geo.W - ww) / 2, (geo.W - ww) / 2] : [geo.W - ww, 0];
	const y = wh <= bh + 0.5 ? [geo.top + (bh - wh) / 2, geo.top + (bh - wh) / 2] : [geo.top + bh - wh, geo.top];
	return { x0: x[0], x1: x[1], y0: y[0], y1: y[1] };
}

const clampZoom = (z: number) => clamp(z, world.fit, world.max);

function clampCam(c: Cam): Cam {
	const z = clampZoom(c.z);
	const b = camBounds(z);
	return { z, x: clamp(c.x, b.x0, b.x1), y: clamp(c.y, b.y0, b.y1) };
}

/** Past an edge the desk still follows the finger, but reluctantly. */
const rubber = (v: number, lo: number, hi: number) => (v < lo ? lo + (v - lo) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v);

/** The view at zoom z that keeps screen point (px, py) over the same spot on the desk. */
function zoomedAbout(px: number, py: number, z: number, from: Cam = cam): Cam {
	return { z, x: px - ((px - from.x) / from.z) * z, y: py - ((py - from.y) / from.z) * z };
}

function homeCam(): Cam {
	const z = world.home;
	return clampCam({ z, x: (geo.W - world.w * z) / 2, y: geo.top + (bandH() - world.h * z) / 2 });
}

const toWorld = (p: Point) => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });

// While the view moves, the desk is one composited layer; once it rests the
// layer goes, so the prints re-rasterize crisp at the new zoom.
let settleTimer = 0;
function moving() {
	window.clearTimeout(settleTimer);
	worldRef.value?.classList.add('is-moving');
}

function settleCam() {
	const pile = mode.value === 'pile';
	zoomAt.value = cam.z <= world.fit + 1e-3 ? 'fit' : cam.z >= world.max - 1e-3 ? 'max' : null;
	// A data attribute, not a bound class: Vue would overwrite a hand-set class.
	const desk = deskRef.value;
	if (desk && desk.dataset.pan !== 'active') desk.dataset.pan = pile && cam.z > world.fit + 1e-3 ? 'can' : '';
	window.clearTimeout(settleTimer);
	settleTimer = window.setTimeout(() => {
		worldRef.value?.classList.remove('is-moving');
		if (pile) sharpen();
	}, 150);
}

function moveCam(to: Cam, duration = 0.5, ease = 'power3.out') {
	camTween?.kill();
	camTween = null;
	camGoal = to;
	if (!duration || prefersReducedMotion()) {
		Object.assign(cam, to);
		camGoal = null;
		renderCam();
		settleCam();
		return;
	}
	moving();
	camTween = gsap.to(cam, {
		...to,
		duration,
		ease,
		onUpdate: renderCam,
		onComplete: () => {
			camTween = null;
			camGoal = null;
			settleCam();
		},
	});
}

/** Stop a glide where it is (a finger caught the desk). */
function stopCam() {
	camTween?.kill();
	camTween = null;
	camGoal = null;
}

/** Back inside the bounds, if a stopped glide or a pinch left it outside. */
function settleInto() {
	const to = clampCam(cam);
	if (Math.abs(to.x - cam.x) + Math.abs(to.y - cam.y) + Math.abs(to.z - cam.z) * 100 > 0.5) moveCam(to, 0.4);
	else settleCam();
}

function zoomBy(f: number) {
	if (mode.value !== 'pile') return;
	camTouched = true;
	const from = camGoal ?? cam;
	moveCam(clampCam(zoomedAbout(geo.W / 2, geo.top + bandH() / 2, clampZoom(from.z * f), from)), 0.45);
}

/** The whole desk in view — with the rolls tucked away, so there's room for all of it. */
function zoomToFit() {
	if (mode.value !== 'pile') return;
	camTouched = true;
	moveCam(clampCam({ x: 0, y: 0, z: world.fit }), 0.6);
	// The chrome shrinking re-lays the desk out (watchChrome), and a view at
	// fit stays at fit — so it settles on the larger band once they're away.
	rollsState.value = 'away';
}

/** Pan just enough to bring a print fully into view (keyboard focus lands on it). */
function revealPrint(i: number) {
	const t = targets.get(i);
	if (mode.value !== 'pile' || !t) return;
	const size = sizeOf(i);
	const r = (Math.hypot(size.w, size.h) / 2) * cam.z;
	const sx = t.x * cam.z + cam.x;
	const sy = t.y * cam.z + cam.y;
	const m = 16;
	const top = geo.top + m;
	const bottom = geo.H - geo.bottom - m;
	const dx = sx - r < m ? m - (sx - r) : sx + r > geo.W - m ? geo.W - m - (sx + r) : 0;
	const dy = sy - r < top ? top - (sy - r) : sy + r > bottom ? bottom - (sy + r) : 0;
	if (dx || dy) moveCam(clampCam({ z: cam.z, x: cam.x + dx, y: cam.y + dy }), 0.45);
}

/** Swap the prints in view to sharper scans when zoomed past their thumbnails. */
function sharpen() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const need = printLong.value * cam.z * dpr;
	if (need <= thumbLong * 1.15) return;
	const long = SHARP_STEPS.find((s) => s >= need) ?? SHARP_STEPS[SHARP_STEPS.length - 1];
	let next: Map<number, number> | null = null;
	for (const e of pile) {
		const t = targets.get(e.i);
		if (!t || (sharp.value.get(e.i) ?? thumbLong) >= long) continue;
		const r = (printLong.value / 2) * cam.z;
		const sx = t.x * cam.z + cam.x;
		const sy = t.y * cam.z + cam.y;
		if (sx + r < 0 || sx - r > geo.W || sy + r < 0 || sy - r > geo.H) continue;
		(next ??= new Map(sharp.value)).set(e.i, long);
	}
	if (next) sharp.value = next;
}

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
	const area = world;
	const all = photos.map((_, i) => i);
	const picked = weightedSample(
		all,
		(i) => priorityWeight(photos[i].p),
		pileCapacity(area, printLong.value),
		rand
	);
	const stacked = stackOrder(picked, (i) => photos[i].p, rand);
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
/** The mode the desk was last laid out in (pile prints sit in camera space). */
let laidOut: 'pile' | 'grid' | null = null;

type Kind = 'toss' | 'shift' | 'instant';

async function applyLayout(kind: Kind) {
	if (!deskRef.value) return; // unmounted mid-await (navigated away)
	const my = ++gen;
	const fitBefore = world.fit;
	measure();

	const next = new Map<number, Target>();
	let order: number[];
	let goal: Cam;
	const from = laidOut;
	laidOut = mode.value;
	if (mode.value === 'pile') {
		if (!pile.length) buildPile();
		deskHeight.value = geo.H;
		strips.value = [];
		canisters.value = [];
		stickers.value = [];
		heads.value = [];
		for (const e of pile) {
			next.set(e.i, { x: e.slot.u * world.w, y: e.slot.v * world.h, r: e.slot.r, s: 1, z: e.z });
		}
		order = [...pile].sort((a, b) => b.z - a.z).map((e) => e.i);
		// Back from the strips, the view returns to wherever it was left.
		const kept = from === 'grid' ? pileCam : (camGoal ?? cam);
		// Zoomed all the way out, it stays all the way out on a resized desk.
		const atFit = from === 'pile' && kept && kept.z <= fitBefore + 1e-3;
		goal = !camTouched || !kept ? homeCam() : clampCam(atFit ? { ...kept, z: world.fit } : kept);
	} else {
		if (from === 'pile') pileCam = { ...(camGoal ?? cam) };
		goal = IDENTITY;
		const sheet = layoutStrips(groups.value, geo.W, {
			top: geo.navH + 28,
			bottom: geo.bottomH + 40,
			maxContent: 1280,
			runOf: (i) => props.rolls[photos[i].r].id,
			headings: facetOrder.value[0] !== 'roll',
		});
		vertical.value = sheet.vertical;
		const f = facetOrder.value[0];
		heads.value = sheet.heads.map((h) => ({ ...h, ...groupInfo(f, h.key) }));
		deskHeight.value = Math.max(sheet.height, geo.H);
		frameGeo.value = { ...sheet.frame, rail: sheet.rail, tongue: sheet.tongue };
		canisters.value = sheet.canisters.map((can, k) => {
			const roll = rollById.get(can.run)!;
			return { ...can, k, stock: roll.stock, stockLabel: roll.stockLabel, stockBrand: roll.stockBrand };
		});
		stickers.value = sheet.stickers.map((tag, k) => {
			const roll = rollById.get(tag.run)!;
			return { ...tag, k, ...stickerText(roll.title, tag.w, tag.h), tilt: tiltOf(roll.id) };
		});
		strips.value = sheet.strips.map((strip) => ({
			...strip,
			mono: rollById.get(strip.run)!.mono,
			frames: strip.frames.map((fr) => ({
				...fr,
				n: photos[fr.idx].n,
				stock: props.rolls[photos[fr.idx].r].stockLabel.toUpperCase(),
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
	if (kind === 'shift') moveCam(goal, 0.85, 'power3.inOut');
	else moveCam(goal, 0);

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
	// A print whose whole move happens off screen can't be seen moving, so it
	// jumps straight to where it's going: re-filing a big desk only tweens the
	// few dozen prints in (or passing through) view, not every frame on it.
	// (Pile prints sit in camera space, which this doesn't follow, and there
	// are only a few dozen of them: they always move.)
	const band = viewBand();
	const unseen = (i: number, from: number, to: number, scale: number) => {
		const size = sizeOf(i);
		const reach = (Math.hypot(size.w, size.h) / 2) * Math.max(1, scale) + 60;
		return Math.max(from, to) + reach < band.top || Math.min(from, to) - reach > band.bottom;
	};
	const place = (el: HTMLElement, t: Target) => {
		gsap.killTweensOf(el);
		gsap.set(el, { xPercent: -50, yPercent: -50, x: t.x, y: t.y, rotation: t.r, scale: t.s, opacity: 1, zIndex: t.z * 2 });
	};
	const each = Math.min(0.012, 0.45 / Math.max(1, order.length));
	order.forEach((i, k) => {
		const el = els.get(i);
		const t = next.get(i)!;
		if (!el) return;
		if (!before.has(i)) {
			if (mode.value === 'pile') {
				tossIn(el, t, k, order.length, reduce);
			} else if (unseen(i, t.y, t.y + 40, t.s)) {
				place(el, t);
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
		const fromY = Number(gsap.getProperty(el, 'y'));
		const scale = Math.max(t.s, Number(gsap.getProperty(el, 'scale')));
		if (from === 'grid' && mode.value === 'grid' && unseen(i, fromY, t.y, scale)) return place(el, t);
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
		const fromY = Number(gsap.getProperty(el, 'y'));
		if (from === 'grid' && unseen(i, fromY, fromY + 36, Number(gsap.getProperty(el, 'scale')))) {
			gsap.killTweensOf(el);
			return drop(i);
		}
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
	// Thrown from below the screen's bottom edge, wherever the view is on the desk.
	const fromX = (geo.W * (0.5 + (Math.random() - 0.5) * 0.8) - cam.x) / cam.z;
	const fromY = (geo.H - cam.y) / cam.z + el.offsetHeight * (0.8 + Math.random() * 0.6);
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
	// A fresh pile starts from the usual view.
	camTouched = false;
	moveCam(homeCam(), 0.6, 'power2.inOut');
	// Sweep the old pile off the bottom edge, then throw a fresh one.
	if (!reduce) {
		rendered.value.forEach((i, k) => {
			const el = els.get(i);
			if (!el) return;
			gsap.to(el, {
				y: `+=${(geo.H * 0.6) / cam.z}`,
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
	const rollsIn = new Set(items.map((i) => photos[i].r)).size;
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
	if (e.pointerType === 'mouse' && !gesture) showGlow(i);
}

function onPointerLeave(i: number) {
	if (!drag) hideGlow(i);
}

/** Keyboard focus lifts the print to the top of the pile (and into view) so it's actually visible. */
function onFocus(i: number) {
	const el = els.get(i);
	if (!el?.matches(':focus-visible')) return;
	raise(i);
	revealPrint(i);
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

/* ── Handling the pile: dragging prints, panning and zooming the desk ── */

// Mouse and pen: drag a print to move it, drag the desk to pan, scroll to pan,
// pinch or ctrl-scroll to zoom. Touch: a swipe pans wherever it starts (the
// pile covers most of a phone), a long press picks a print up, and two
// fingers pinch. Filed into strips, none of this applies: the page scrolls.

interface Drag {
	i: number;
	el: HTMLElement;
	pointerId: number;
	/** The print's center relative to the pointer, in desk px. */
	offX: number;
	offY: number;
	r0: number;
	/** Pointer position (desk-relative screen px) and velocity (px/s). */
	px: number;
	py: number;
	lastT: number;
	vx: number;
	vy: number;
	tilt?: (value: number) => void;
}
let drag: Drag | null = null;
let suppressClick = false;

type Gesture =
	| { kind: 'press'; id: number; touch: boolean; x0: number; y0: number; i: number; timer: number }
	| { kind: 'pan'; id: number; x0: number; y0: number; cam0: Cam; lastX: number; lastY: number; lastT: number; vx: number; vy: number }
	| { kind: 'pinch'; d0: number; m0: Point; m: Point; cam0: Cam }
	| { kind: 'print' };
let gesture: Gesture | null = null;
/** Pointers down on the pile, by id (desk-relative positions). */
const pointers = new Map<number, Point>();
let lastPointerType = '';

const LONG_PRESS = 380;

function deskPoint(e: { clientX: number; clientY: number }): Point {
	const r = deskRef.value!.getBoundingClientRect();
	return { x: e.clientX - r.left, y: e.clientY - r.top };
}

const canPan = () => cam.z > world.fit + 1e-3;

function capture(el: Element | null | undefined, id: number) {
	try {
		el?.setPointerCapture(id);
	} catch {
		/* the pointer is already gone */
	}
}

function onDeskDown(e: PointerEvent) {
	suppressClick = false;
	if (mode.value !== 'pile' || !ready) return;
	if (e.pointerType === 'mouse' && e.button !== 0) return;
	lastPointerType = e.pointerType;
	const p = deskPoint(e);
	pointers.set(e.pointerId, p);
	if (pointers.size === 2 && e.pointerType === 'touch') return startPinch();
	if (pointers.size > 1 || gesture) return;
	stopCam();
	const printEl = (e.target as Element).closest<HTMLElement>('.print');
	const i = printEl ? Number(printEl.dataset.i) : -1;
	const touch = e.pointerType === 'touch';
	gesture = { kind: 'press', id: e.pointerId, touch, x0: p.x, y0: p.y, i, timer: 0 };
	if (touch && i >= 0) gesture.timer = window.setTimeout(() => startDrag(i, e.pointerId, p, true), LONG_PRESS);
}

function onDeskMove(e: PointerEvent) {
	if (!pointers.has(e.pointerId)) return;
	const p = deskPoint(e);
	pointers.set(e.pointerId, p);
	const g = gesture;
	if (!g) return;
	if (g.kind === 'pinch') return pinchMove(g);
	if (g.kind === 'print') return dragMove(e.pointerId, p);
	if (g.id !== e.pointerId) return;
	if (g.kind === 'press') {
		if (Math.hypot(p.x - g.x0, p.y - g.y0) < (g.touch ? 8 : 5)) return;
		window.clearTimeout(g.timer);
		if (!g.touch && g.i >= 0) {
			startDrag(g.i, g.id, { x: g.x0, y: g.y0 });
			return dragMove(e.pointerId, p);
		}
		if (!canPan()) {
			gesture = null;
			return;
		}
		startPan(g.id, { x: g.x0, y: g.y0 });
	}
	if (gesture?.kind === 'pan') panMove(gesture, p);
}

function onDeskUp(e: PointerEvent) {
	if (!pointers.delete(e.pointerId)) return;
	const g = gesture;
	// Swallow the click that ends a drag or pan — but not one that never comes
	// (a pan released over the bare desk), or a later keypress would be lost.
	if (suppressClick) window.setTimeout(() => (suppressClick = false), 350);
	if (!g) return;
	if (g.kind === 'press' && g.id === e.pointerId) {
		window.clearTimeout(g.timer);
		gesture = null;
		settleInto(); // a tap that caught a glide mid-way; the click opens the print
	} else if (g.kind === 'pan' && g.id === e.pointerId) {
		gesture = null;
		endPan(g, e.type === 'pointercancel');
	} else if (g.kind === 'print' && drag?.pointerId === e.pointerId) {
		gesture = null;
		endDrag(e.type === 'pointercancel' ? 0 : 0.12, e.pointerType);
	} else if (g.kind === 'pinch') {
		// One finger up ends the pinch; the other just rests until it lifts.
		gesture = null;
		if (deskRef.value) deskRef.value.dataset.pan = '';
		moveCam(clampCam(zoomedAbout(g.m.x, g.m.y, clampZoom(cam.z))), 0.35);
	}
}

/* Panning */

function startPan(id: number, from: Point) {
	const now = performance.now();
	gesture = { kind: 'pan', id, x0: from.x, y0: from.y, cam0: { ...cam }, lastX: from.x, lastY: from.y, lastT: now, vx: 0, vy: 0 };
	capture(deskRef.value, id);
	if (deskRef.value) deskRef.value.dataset.pan = 'active';
	camTouched = true;
	suppressClick = true;
	hideGlow();
	moving();
}

function panMove(g: Extract<Gesture, { kind: 'pan' }>, p: Point) {
	const now = performance.now();
	const dt = Math.max(8, now - g.lastT) / 1000;
	g.vx = g.vx * 0.6 + ((p.x - g.lastX) / dt) * 0.4;
	g.vy = g.vy * 0.6 + ((p.y - g.lastY) / dt) * 0.4;
	g.lastX = p.x;
	g.lastY = p.y;
	g.lastT = now;
	const b = camBounds(cam.z);
	cam.x = rubber(g.cam0.x + p.x - g.x0, b.x0, b.x1);
	cam.y = rubber(g.cam0.y + p.y - g.y0, b.y0, b.y1);
	renderCam();
}

function endPan(g: Extract<Gesture, { kind: 'pan' }>, cancelled: boolean) {
	if (deskRef.value) deskRef.value.dataset.pan = '';
	// A flick glides on (a stale velocity — the finger paused first — doesn't).
	const glide = cancelled || performance.now() - g.lastT > 80 ? 0 : 0.3;
	moveCam(clampCam({ z: cam.z, x: cam.x + g.vx * glide, y: cam.y + g.vy * glide }), glide ? 0.8 : 0.4);
}

/* Pinching */

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function startPinch() {
	// A second finger turns whatever the first was doing into a pinch.
	const g = gesture;
	if (g?.kind === 'press') window.clearTimeout(g.timer);
	if (g?.kind === 'print') endDrag(0, 'touch');
	stopCam();
	const [a, b] = [...pointers.values()];
	const m = mid(a, b);
	gesture = { kind: 'pinch', d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: m, m, cam0: { ...cam } };
	for (const id of pointers.keys()) capture(deskRef.value, id);
	if (deskRef.value) deskRef.value.dataset.pan = 'active';
	camTouched = true;
	suppressClick = true;
	hideGlow();
	moving();
}

function pinchMove(g: Extract<Gesture, { kind: 'pinch' }>) {
	const [a, b] = [...pointers.values()];
	if (!b) return;
	g.m = mid(a, b);
	// Past either limit it still gives a little, then settles back on release.
	const z = clamp((g.cam0.z * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, world.fit * 0.8, world.max * 1.25);
	// The spot that was under the fingers stays under them as they move.
	const wx = (g.m0.x - g.cam0.x) / g.cam0.z;
	const wy = (g.m0.y - g.cam0.y) / g.cam0.z;
	const bounds = camBounds(z);
	cam.z = z;
	cam.x = rubber(g.m.x - wx * z, bounds.x0, bounds.x1);
	cam.y = rubber(g.m.y - wy * z, bounds.y0, bounds.y1);
	renderCam();
}

/* Dragging prints */

function startDrag(i: number, pointerId: number, at: Point, longPress = false) {
	const el = els.get(i);
	if (!el || mode.value !== 'pile') return;
	// Picked up: it comes to the top of the pile and lifts off the desk.
	gsap.killTweensOf(el);
	const w = toWorld(at);
	drag = {
		i,
		el,
		pointerId,
		offX: Number(gsap.getProperty(el, 'x')) - w.x,
		offY: Number(gsap.getProperty(el, 'y')) - w.y,
		r0: targets.get(i)?.r ?? Number(gsap.getProperty(el, 'rotation')),
		px: at.x,
		py: at.y,
		lastT: performance.now(),
		vx: 0,
		vy: 0,
		tilt: gsap.quickTo(el, 'rotation', { duration: 0.4, ease: 'power3' }),
	};
	gesture = { kind: 'print' };
	capture(el, pointerId);
	raise(i);
	el.classList.add('is-lifted');
	dragging.value = true;
	suppressClick = true;
	if (longPress) navigator.vibrate?.(8);
	edgeT = 0;
	edgeRaf ||= requestAnimationFrame(edgePan);
}

/** Puts the dragged print under the pointer (wherever the view has moved). */
function placeDragged(d: Drag) {
	const w = toWorld({ x: d.px, y: d.py });
	gsap.set(d.el, { x: clamp(w.x + d.offX, 0, world.w), y: clamp(w.y + d.offY, 0, world.h) });
}

function dragMove(pointerId: number, p: Point) {
	const d = drag;
	if (!d || pointerId !== d.pointerId) return;
	const now = performance.now();
	const dt = Math.max(8, now - d.lastT) / 1000;
	d.vx = d.vx * 0.6 + ((p.x - d.px) / dt) * 0.4;
	d.vy = d.vy * 0.6 + ((p.y - d.py) / dt) * 0.4;
	d.px = p.x;
	d.py = p.y;
	d.lastT = now;
	placeDragged(d);
	// Swings a little with the motion, like paper dragged by a corner.
	d.tilt?.(d.r0 + clamp(d.vx / 140, -9, 9));
}

/** Carried to the edge of the view, a print pulls the desk along with it. */
let edgeRaf = 0;
let edgeT = 0;
function edgePan(now: number) {
	const d = drag;
	if (!d) {
		edgeRaf = 0;
		return;
	}
	const dt = edgeT ? Math.min(0.05, (now - edgeT) / 1000) : 0;
	edgeT = now;
	const E = 56;
	const push = (v: number, lo: number, hi: number) =>
		clamp(v < lo + E ? (lo + E - v) / E : v > hi - E ? (hi - E - v) / E : 0, -1, 1);
	const sx = push(d.px, 0, geo.W);
	const sy = push(d.py, geo.top, geo.H - geo.bottom);
	if ((sx || sy) && canPan()) {
		const b = camBounds(cam.z);
		const x = clamp(cam.x + sx * 720 * dt, b.x0, b.x1);
		const y = clamp(cam.y + sy * 720 * dt, b.y0, b.y1);
		if (x !== cam.x || y !== cam.y) {
			cam.x = x;
			cam.y = y;
			moving();
			renderCam();
			placeDragged(d);
		}
	}
	edgeRaf = requestAnimationFrame(edgePan);
}

/** Lets go of the dragged print; `fling` is how far its momentum carries it (s). */
function endDrag(fling: number, pointerType: string) {
	const d = drag;
	if (!d) return;
	drag = null;
	cancelAnimationFrame(edgeRaf);
	edgeRaf = 0;
	dragging.value = false;
	d.el.classList.remove('is-lifted');

	// A flick carries the print on a little before friction wins.
	const i = d.i;
	const size = sizeOf(i);
	const carry = (v: number) => clamp((v * fling) / cam.z, -140, 140);
	const x = clamp(Number(gsap.getProperty(d.el, 'x')) + carry(d.vx), size.w / 2, world.w - size.w / 2);
	const y = clamp(Number(gsap.getProperty(d.el, 'y')) + carry(d.vy), size.h / 2, world.h - size.h / 2);
	const r = clamp(d.r0 + d.vx * 0.006, d.r0 - 14, d.r0 + 14);
	gsap.to(d.el, { x, y, rotation: r, duration: 0.6, ease: 'power3.out', overwrite: true });

	const entry = pile.find((p) => p.i === i);
	const t = targets.get(i);
	if (entry) entry.slot = { u: x / world.w, v: y / world.h, r };
	if (t) Object.assign(t, { x, y, r });
	if (pointerType === 'mouse' && d.el.matches(':hover')) showGlow(i);
	settleCam();
}

/* Wheel, trackpad, keys */

// Trackpad scrolling pans; a pinch (which browsers send as ctrl + wheel)
// zooms about the pointer, as does ctrl + a mouse wheel.
let safariPinch = false;
function onWheel(e: WheelEvent) {
	if (mode.value !== 'pile' || !ready) return;
	e.preventDefault();
	if (gesture || (safariPinch && e.ctrlKey)) return;
	stopCam();
	const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? geo.H : 1;
	let dx = e.deltaX * unit;
	let dy = e.deltaY * unit;
	if (e.ctrlKey) {
		const p = deskPoint(e);
		Object.assign(cam, clampCam(zoomedAbout(p.x, p.y, clampZoom(cam.z * Math.exp(clamp(-dy, -50, 50) * 0.01)))));
	} else {
		if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
		Object.assign(cam, clampCam({ z: cam.z, x: cam.x - dx, y: cam.y - dy }));
	}
	camTouched = true;
	hideGlow();
	moving();
	renderCam();
	settleCam();
}

// Safari reports trackpad (and iOS) pinches as gesture events instead. Touch
// pinches are already handled through pointers, so those only block page zoom.
type SafariGesture = UIEvent & { scale: number; clientX: number; clientY: number };
let gestureZ0 = 1;
function onGestureStart(e: Event) {
	if (mode.value !== 'pile') return;
	e.preventDefault();
	safariPinch = true;
	gestureZ0 = cam.z;
}

function onGestureChange(e: Event) {
	if (mode.value !== 'pile') return;
	e.preventDefault();
	if (pointers.size || !safariPinch) return;
	const g = e as SafariGesture;
	const p = deskPoint(g);
	stopCam();
	Object.assign(cam, clampCam(zoomedAbout(p.x, p.y, clampZoom(gestureZ0 * g.scale))));
	camTouched = true;
	moving();
	renderCam();
	settleCam();
}

function onGestureEnd(e: Event) {
	if (mode.value === 'pile') e.preventDefault();
	safariPinch = false;
}

function onDeskDblClick(e: MouseEvent) {
	if (mode.value !== 'pile' || (e.target as Element).closest('.print')) return;
	const p = deskPoint(e);
	const z = cam.z >= world.max - 1e-3 ? world.home : clampZoom(cam.z * 2);
	camTouched = true;
	moveCam(clampCam(zoomedAbout(p.x, p.y, z)), 0.5);
}

// A long press on a phone would otherwise open the image menu mid-lift.
function onContextMenu(e: MouseEvent) {
	if (mode.value === 'pile' && lastPointerType === 'touch') e.preventDefault();
}

/** + and − zoom, 0 shows the whole desk — unless typing, or the lightbox is up. */
function onKeydown(e: KeyboardEvent) {
	if (mode.value !== 'pile' || !ready || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
	const t = e.target as HTMLElement | null;
	if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
	if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
	if (e.key === '+' || e.key === '=') zoomBy(1.5);
	else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.5);
	else if (e.key === '0') zoomToFit();
	else return;
	e.preventDefault();
}

function onPrintClick(i: number) {
	if (suppressClick) {
		suppressClick = false;
		return;
	}
	// A print picked off the pile opens on its own; once a roll or filter has
	// filed the desk into strips, the lightbox steps through those frames. A
	// print still on its way out of a re-file isn't in them: it opens alone.
	const filed = mode.value === 'pile' ? [i] : groups.value.flatMap((g) => g.items);
	const list = filed.includes(i) ? filed : [i];
	// From a strip of negatives, the lightbox scans the frame into a positive.
	const scan = negative.value && mode.value === 'grid';
	// A print viewed on its own can take you to the rest of its roll.
	const action = list.length === 1 ? { label: 'View entire roll', run: () => viewRoll(photos[i].r) } : undefined;
	window.dispatchEvent(
		new CustomEvent('open-lightbox', {
			detail: { photos: list.map(toLightbox), index: list.indexOf(i), negative: scan, action },
		})
	);
}

/** Lay out just this roll on the desk, whatever was filed before, and bring
 * it into view in the roll row. */
async function viewRoll(r: number) {
	const id = props.rolls[r].id;
	clearAll();
	pickRoll(id);
	await nextTick(); // the row has re-rendered (and re-shown any filtered-out rolls)
	rollStripRef.value?.reveal(id);
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

let narrowQuery: MediaQueryList | null = null;
const onNarrow = (e: MediaQueryList | MediaQueryListEvent) => (narrow.value = e.matches);

// When the bottom chrome changes height (the roll row rewinding or opening,
// titles wrapping), re-spread the pile — or re-pad the strips — once it settles.
let chromeObserver: ResizeObserver | null = null;
let chromeTimer = 0;
let chromeH = 0;
function watchChrome() {
	if (!bottomRef.value) return;
	chromeH = bottomRef.value.offsetHeight;
	chromeObserver = new ResizeObserver(() => {
		const h = bottomRef.value?.offsetHeight ?? 0;
		if (Math.abs(h - chromeH) < 4) return;
		chromeH = h;
		window.clearTimeout(chromeTimer);
		chromeTimer = window.setTimeout(() => {
			if (ready && !gesture) applyLayout('shift');
		}, 180);
	});
	chromeObserver.observe(bottomRef.value);
}

onMounted(async () => {
	narrowQuery = window.matchMedia('(max-width: 40em)');
	onNarrow(narrowQuery);
	narrowQuery.addEventListener('change', onNarrow);
	try {
		negative.value = localStorage.getItem(NEGATIVE_KEY) === '1';
	} catch {
		/* storage unavailable */
	}
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
	// Sized for where the view starts; zooming in swaps in sharper scans.
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const need = printLong.value * world.home * dpr;
	thumbLong = THUMB_STEPS.find((s) => s >= need) ?? THUMB_STEPS[THUMB_STEPS.length - 1];
	thumbUrls.clear();
	lightboxRecords.clear();

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
	window.addEventListener('keydown', onKeydown);
	// Non-passive: in the pile, wheel and pinch move the desk, not the page.
	const desk = deskRef.value;
	desk?.addEventListener('wheel', onWheel, { passive: false });
	desk?.addEventListener('gesturestart', onGestureStart);
	desk?.addEventListener('gesturechange', onGestureChange);
	desk?.addEventListener('gestureend', onGestureEnd);
	watchChrome();
});

onBeforeUnmount(() => {
	gen++;
	narrowQuery?.removeEventListener('change', onNarrow);
	chromeObserver?.disconnect();
	window.clearTimeout(chromeTimer);
	window.removeEventListener('resize', onResize);
	window.removeEventListener('keydown', onKeydown);
	window.clearTimeout(resizeTimer);
	window.clearTimeout(settleTimer);
	cancelAnimationFrame(edgeRaf);
	camTween?.kill();
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
	/* A color negative: inverted, under the orange mask of C-41 film. */
	--negative: invert(1) sepia(0.55) saturate(1.7) hue-rotate(-14deg) brightness(0.9) contrast(0.92);
	position: relative;
}

/* Negative view: the strips turn to orange-masked film with dark edge print. */
.film.is-negative {
	--neg-base: #a85d27;
	--neg-frame: #c27a3f;
	--neg-ink: rgba(52, 22, 6, 0.8);
	/* Black-and-white negatives: a clear gray base, frames inverted to gray. */
	--negative-mono: invert(1) grayscale(1) contrast(0.88) brightness(1.04);
}

.film.is-negative .neg-strip.is-mono {
	--neg-base: #a9a6a0;
	--neg-frame: #c8c5bf;
	--neg-ink: rgba(20, 20, 20, 0.75);
}

:root.theme-dark .film.is-negative .neg-strip.is-mono {
	--neg-base: #7a7772;
	--neg-frame: #9b9893;
}

:root.theme-dark .film.is-negative {
	--neg-base: #8c4c20;
	--neg-frame: #a6622f;
	--neg-ink: rgba(30, 12, 3, 0.85);
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

/* Zoom: a small column floating above the bottom chrome, at the right. */
.film-bottom > .zoom {
	position: absolute;
	right: max(1rem, env(safe-area-inset-right));
	bottom: calc(100% + 0.75rem);
	z-index: 1;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
	padding: 0.25rem;
	border: 1px solid var(--gray-800);
	border-radius: 999rem;
	background: color-mix(in srgb, var(--gray-999) 82%, transparent);
	backdrop-filter: blur(16px) saturate(1.3);
	-webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: var(--shadow-md);
}

.zoom-btn {
	display: grid;
	place-items: center;
	width: 2.25rem;
	height: 2.25rem;
	padding: 0;
	border: 0;
	border-radius: 999rem;
	background: none;
	color: var(--gray-200);
	cursor: pointer;
	transition:
		background-color 200ms ease,
		color 200ms ease,
		opacity 200ms ease;
}

.zoom-btn:hover:not(:disabled) {
	background: var(--gray-900);
	color: var(--gray-0);
}

.zoom-btn:disabled {
	opacity: 0.35;
	cursor: default;
}

.zoom-btn:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.zoom-btn svg {
	width: 1rem;
	height: 1rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 18;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.zoom-enter-active,
.zoom-leave-active {
	transition:
		opacity 300ms ease,
		translate 300ms cubic-bezier(0.33, 1, 0.68, 1);
}

.zoom-enter-from,
.zoom-leave-to {
	opacity: 0;
	translate: 0 0.5rem;
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

/* The pile handles every touch itself (pan, pinch, long-press to lift). */
.film:not(.is-grid) .desk {
	touch-action: none;
	-webkit-touch-callout: none;
	-webkit-user-select: none;
	user-select: none;
}

.desk[data-pan='can'] {
	cursor: grab;
}

.desk[data-pan='active'],
.desk[data-pan='active'] .print {
	cursor: grabbing;
}

.desk-world {
	position: absolute;
	inset: 0;
	transform-origin: 0 0;
}

.desk-world.is-moving {
	will-change: transform;
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
	touch-action: none;
	-webkit-tap-highlight-color: transparent;
	/* No standing will-change: a filed desk can hold hundreds of prints, and a
	   compositor layer each is a lot of GPU memory. Tweens promote prints for
	   their duration (GSAP force3D: auto); a print being dragged opts in below. */
}

.print.is-lifted {
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

/* Frames in the strips read as negatives; pointing at one flips it positive. */
.is-negative.is-grid .print-body img {
	filter: var(--negative);
	transition:
		opacity 400ms ease,
		filter 650ms cubic-bezier(0.33, 1, 0.68, 1);
}

.is-negative.is-grid .print.is-mono .print-body img {
	filter: var(--negative-mono);
}

.is-negative.is-grid .print:hover .print-body img,
.is-negative.is-grid .print:focus-visible .print-body img {
	filter: none;
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
	/* It follows its print every frame; on its own layer the 30px blur is
	   rasterized once and moved, not repainted each frame. */
	will-change: transform;
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
.desk-world > .desk-can {
	position: absolute;
	z-index: 1;
	filter: drop-shadow(0 8px 10px rgba(17, 16, 16, 0.25));
	animation: head-in 450ms calc(min(var(--k), 12) * 60ms) ease-out backwards;
}

/* Standing strips: the canister lies across the head of the first one, lip down. */
.desk-world > .desk-can.is-lying {
	rotate: 90deg;
}

:root.theme-dark .desk-world > .desk-can {
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
