<template>
	<div
		ref="rootRef"
		class="film"
		:class="{ 'is-live': live, 'is-grid': mode === 'grid', 'is-dragging': dragging }"
	>
		<!-- Floating over the top of the desk, just under the site nav: the rolls,
		     on a scrim that lets the pile fade out beneath them. -->
		<div ref="topRef" class="film-top">
			<FilmRollStrip
				:rolls="rolls"
				:selected="selected.roll"
				:counts="rollCounts"
				:status="status"
				@toggle="toggleRoll"
			/>
		</div>

		<!-- Floating at the bottom. Before the desk in the DOM so keyboard users
		     reach the controls without tabbing through every print. -->
		<FilmFilterDock
			ref="dockRef"
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

		<div
			ref="deskRef"
			class="desk"
			:style="deskHeight ? { height: `${deskHeight}px` } : undefined"
			role="region"
			aria-label="Film prints"
		>
			<div ref="glowRef" class="glow" aria-hidden="true"><span class="glow-light"></span></div>

			<header
				v-for="head in heads"
				:key="head.key"
				class="group-head"
				:style="{ transform: `translateY(${head.y}px)`, left: `${gridPad}px`, right: `${gridPad}px` }"
			>
				<p class="group-eyebrow">{{ head.eyebrow }}</p>
				<h3 class="group-title">{{ head.label }}</h3>
				<p class="group-meta">{{ head.meta }}</p>
			</header>

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
import FilmRollStrip from './FilmRollStrip.vue';
import { bunnyUrl } from '../../utils/bunny';
import {
	clamp,
	layoutGrid,
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
}

// A roll that the other filters rule out is still one click away: picking it
// clears those filters rather than producing an empty desk.
function toggleRoll(id: string) {
	if (!selected.roll.includes(id) && !rollCounts.value[id]) {
		for (const { key } of FILTER_FACETS) selected[key] = [];
		facetOrder.value = facetOrder.value.filter((f) => f === 'roll');
	}
	toggle('roll', id);
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
const topRef = ref<HTMLElement | null>(null);
const dockRef = ref<InstanceType<typeof FilmFilterDock> | null>(null);

const printLong = ref(200);
const deskHeight = ref(0);
const gridPad = ref(24);
const heads = ref<{ key: string; y: number; eyebrow: string; label: string; meta: string }[]>([]);
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

// W: desk width. H: pile-mode desk height (the whole screen). topH/dockH: the
// floating chrome; top/bottom: how far the pile keeps clear of it.
const geo = { W: 0, H: 0, top: 0, bottom: 0, topH: 0, dockH: 0 };

function measure() {
	const desk = deskRef.value!;
	geo.W = desk.clientWidth;
	// The rolls sit just under the floating site nav, whatever its height.
	const navH = document.querySelector<HTMLElement>('nav')?.offsetHeight ?? 0;
	rootRef.value?.style.setProperty('--film-nav-h', `${navH}px`);
	geo.topH = topRef.value?.offsetHeight ?? 0;
	geo.dockH = (dockRef.value?.$el as HTMLElement | undefined)?.offsetHeight ?? 0;
	geo.H = Math.max(420, window.innerHeight);
	// Prints may tuck partway under the rolls and the dock — it reads as one
	// surface fading out under the controls.
	geo.top = geo.topH * 0.62;
	geo.bottom = (geo.dockH + 16) * 0.7;
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
		heads.value = [];
		for (const e of pile) {
			next.set(e.i, { x: e.slot.u * area.w, y: geo.top + e.slot.v * area.h, r: e.slot.r, s: 1, z: e.z });
		}
		order = [...pile].sort((a, b) => b.z - a.z).map((e) => e.i);
	} else {
		const grid = layoutGrid(groups.value, geo.W, {
			top: geo.topH + 20,
			bottom: geo.dockH + 64,
			maxContent: 1280,
		});
		deskHeight.value = Math.max(grid.height, geo.H);
		gridPad.value = grid.pad;
		const f = facetOrder.value[0];
		heads.value = grid.heads.map((h) => ({ ...h, ...groupInfo(f, h.key) }));
		order = groups.value.flatMap((g) => g.items);
		order.forEach((i, k) => {
			const c = grid.centers.get(i)!;
			const size = sizeOf(i);
			const s = Math.min((grid.cell.w * 0.94) / size.w, (grid.cell.h * 0.94) / size.h);
			next.set(i, { x: c.x, y: c.y, r: 0, s, z: k + 1 });
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

function groupInfo(f: FacetKey, key: string) {
	const items = groups.value.find((g) => g.key === key)?.items ?? [];
	const label = labelOf[f].get(key) ?? key;
	if (f === 'roll') {
		const roll = props.rolls.find((r) => r.id === key)!;
		return {
			eyebrow: `Roll · developed ${fullDate(roll.developed)}`,
			label,
			meta: `${roll.cameraLabel} · ${roll.stockLabel} · ${roll.labLabel} · ${plural(items.length, 'frame')}`,
		};
	}
	const rollsIn = new Set(items.map((i) => props.photos[i].r)).size;
	return {
		eyebrow: FILTER_FACETS.find((x) => x.key === f)?.title ?? f,
		label,
		meta: `${plural(items.length, 'frame')} · ${plural(rollsIn, 'roll')}`,
	};
}

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
	position: relative;
}

:root.theme-dark .film {
	--paper: #ece8df;
	--print-rest: 0 0 0 1px rgba(255, 255, 255, 0.04), 0 10px 24px -8px rgba(0, 0, 0, 0.9);
	--print-glow: 0 0 0 1px rgba(255, 250, 238, 0.95), 0 0 28px 6px rgba(255, 238, 205, 0.45);
}

/* ── Floating chrome ── */

.film-top {
	position: fixed;
	inset: 0 0 auto;
	z-index: 3;
	/* --film-nav-h is measured from the nav at runtime; this is the pre-hydration guess. */
	padding-top: var(--film-nav-h, 4.75rem);
	pointer-events: none;
}

.film-top > * {
	pointer-events: auto;
}

/* Scrim: the pile fades (and on wide screens, softly blurs) out under the
   nav and the rolls, so both stay legible over any photo. */
.film-top::before {
	content: '';
	position: absolute;
	inset: 0 0 -3rem;
	z-index: -1;
	background: linear-gradient(
		to bottom,
		var(--gray-999) 0%,
		color-mix(in srgb, var(--gray-999) 92%, transparent) 45%,
		color-mix(in srgb, var(--gray-999) 70%, transparent) 72%,
		transparent
	);
	pointer-events: none;
}

@media (min-width: 50em) {
	.film-top::before {
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		mask-image: linear-gradient(to bottom, #000 70%, transparent);
	}
}

/* Centered by auto margins (with left and right both pinned) rather than
   left: 50% — that would cap its shrink-to-fit width at half the viewport. */
.film > .film-dock {
	position: fixed;
	inset: auto 0 max(1rem, env(safe-area-inset-bottom));
	z-index: 4;
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
		box-shadow 260ms ease;
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

/* ── Grid group headings ── */

.group-head {
	position: absolute;
	top: 0;
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	column-gap: 1rem;
	padding-top: 0.75rem;
	border-top: 1px solid var(--gray-800);
	animation: head-in 500ms 250ms cubic-bezier(0.33, 1, 0.68, 1) backwards;
}

@media (prefers-reduced-motion: no-preference) {
	.group-head {
		transition: transform 850ms cubic-bezier(0.65, 0, 0.35, 1);
	}
}

@keyframes head-in {
	from {
		opacity: 0;
	}
}

.group-eyebrow {
	flex-basis: 100%;
	font-size: var(--text-sm);
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.group-title {
	font-size: var(--text-xl);
	font-weight: 500;
	line-height: 1.2;
	color: var(--gray-0);
}

.group-meta {
	font-size: var(--text-sm);
	letter-spacing: 0.06em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
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
