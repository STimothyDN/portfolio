<script setup lang="ts">
/**
 * The reading photo: tap to meter a spot, drag to meter an area, or use the
 * buttons (whole frame, brightest and darkest parts with detail). Arrow
 * keys move the spot. The film camera's frame is drawn over the phone's
 * wider view, and false colour shows where every part lands on the film.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { FALSE_COLOUR, falseColour, findSpot, type Box, type Latitude, type Region } from '../../../lib/lab/meter/luma';
import type { Photo } from '../../../lib/lab/meter/photo';

const props = defineProps<{
	photo: Photo;
	region: Region;
	/** What the film camera's lens sees, if known. */
	frame: { box: Box; wider: boolean; label: string } | null;
	/** Where things land on the film, for false colour (null: off). */
	zones: { offset: number; lat: Latitude } | null;
	/** The reading at the spot or area, for its tag ("EV 12⅔"). */
	tag: string;
}>();
const emit = defineEmits<{ region: [region: Region] }>();

/** A spot about 5° across on a phone's main camera. */
const SPOT = 0.04;
const W = 1000;
const H = computed(() => Math.round((W * props.photo.h) / props.photo.w));
const L = computed(() => Math.max(W, H.value));

const figure = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const drag = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
let start: { x: number; y: number; id: number } | null = null;

function at(e: PointerEvent) {
	const r = figure.value!.getBoundingClientRect();
	return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
}
function down(e: PointerEvent) {
	if (e.button > 0) return;
	const p = at(e);
	start = { ...p, id: e.pointerId };
	(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
}
function move(e: PointerEvent) {
	if (!start || e.pointerId !== start.id) return;
	const p = at(e);
	if (drag.value || Math.hypot(p.x - start.x, p.y - start.y) > 0.03) drag.value = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
}
function up(e: PointerEvent) {
	if (!start || e.pointerId !== start.id) return;
	const d = drag.value;
	const p = at(e);
	if (d && Math.abs(d.x1 - d.x0) > 0.04 && Math.abs(d.y1 - d.y0) > 0.04) {
		emit('region', { kind: 'area', x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1) });
	} else emit('region', { kind: 'spot', x: p.x, y: p.y, r: SPOT });
	start = null;
	drag.value = null;
}
function cancel() {
	start = null;
	drag.value = null;
}
function key(e: KeyboardEvent) {
	const step = e.shiftKey ? 0.1 : 0.02;
	const r = props.region.kind === 'spot' ? props.region : { kind: 'spot' as const, x: 0.5, y: 0.5, r: SPOT };
	const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
	const m = moves[e.key];
	if (m) {
		e.preventDefault();
		emit('region', { ...r, x: Math.max(0, Math.min(1, r.x + m[0])), y: Math.max(0, Math.min(1, r.y + m[1])) });
	} else if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		emit('region', r);
	}
}

function find(which: 'brightest' | 'darkest') {
	const spot = findSpot(props.photo.map, which, SPOT, props.frame?.box);
	if (spot) emit('region', spot);
}

/* ---------- drawing ---------- */

const mask = computed(() => {
	const f = props.frame?.box;
	if (!f || props.frame?.wider) return '';
	const h = H.value;
	return `M0 0H${W}V${h}H0Z M${f.x0 * W} ${f.y0 * h}V${f.y1 * h}H${f.x1 * W}V${f.y0 * h}Z`;
});
const spot = computed(() => (props.region.kind === 'spot' ? { cx: props.region.x * W, cy: props.region.y * H.value, r: props.region.r * L.value } : null));
const area = computed(() => {
	const r = drag.value ?? (props.region.kind === 'area' ? props.region : null);
	if (!r) return null;
	return { x: Math.min(r.x0, r.x1) * W, y: Math.min(r.y0, r.y1) * H.value, w: Math.abs(r.x1 - r.x0) * W, h: Math.abs(r.y1 - r.y0) * H.value, live: !!drag.value };
});
/** Where the tag sits, in % of the picture. */
const tagAt = computed(() => {
	const r = props.region;
	if (r.kind === 'spot') return { left: r.x * 100, top: r.y * 100, below: r.y < 0.2 };
	if (r.kind === 'area') return { left: ((r.x0 + r.x1) / 2) * 100, top: Math.min(r.y0, r.y1) * 100, below: Math.min(r.y0, r.y1) < 0.12 };
	return null;
});

function paint() {
	const c = canvas.value;
	if (!c || !props.zones) return;
	const { map } = props.photo;
	const ctx = c.getContext('2d');
	if (!ctx) return;
	const img = ctx.createImageData(map.w, map.h);
	falseColour(map, props.zones.offset, props.zones.lat, img.data);
	ctx.putImageData(img, 0, 0);
}
watch(() => [props.zones?.offset, props.zones?.lat.toe, props.zones?.lat.shoulder, props.photo.at], () => void nextTick(paint));
onMounted(paint);

defineExpose({ find });
</script>

<template>
	<div class="pm-wrap">
		<figure
			ref="figure"
			class="pm"
			:style="{ aspectRatio: `${photo.w} / ${photo.h}`, width: `min(100%, ${Math.round((5600 * photo.w) / photo.h) / 100}vh)` }"
			tabindex="0"
			aria-label="Your reading photo. Tap or press Enter to meter a spot, drag for an area; arrow keys move the spot."
			@pointerdown="down"
			@pointermove="move"
			@pointerup="up"
			@pointercancel="cancel"
			@keydown="key"
		>
			<img :src="photo.url" alt="" draggable="false" />
			<canvas v-show="zones" ref="canvas" class="false" :width="photo.map.w" :height="photo.map.h" aria-hidden="true"></canvas>
			<svg class="over" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
				<path v-if="mask" class="outside" :d="mask" fill-rule="evenodd" />
				<rect
					v-if="frame && !frame.wider"
					class="frameline"
					:x="frame.box.x0 * W"
					:y="frame.box.y0 * H"
					:width="(frame.box.x1 - frame.box.x0) * W"
					:height="(frame.box.y1 - frame.box.y0) * H"
				/>
				<template v-if="spot">
					<circle class="ring-dark" :cx="spot.cx" :cy="spot.cy" :r="spot.r" />
					<circle class="ring" :cx="spot.cx" :cy="spot.cy" :r="spot.r" />
					<path class="ring" :d="`M${spot.cx - spot.r * 0.35} ${spot.cy}h${spot.r * 0.7}M${spot.cx} ${spot.cy - spot.r * 0.35}v${spot.r * 0.7}`" />
				</template>
				<template v-if="area">
					<rect class="ring-dark" :x="area.x" :y="area.y" :width="area.w" :height="area.h" />
					<rect class="ring" :class="{ live: area.live }" :x="area.x" :y="area.y" :width="area.w" :height="area.h" />
				</template>
			</svg>
			<span v-if="tagAt && tag && !drag" class="tag" :class="{ below: tagAt.below }" :style="{ left: `${tagAt.left}%`, top: `${tagAt.top}%` }">{{ tag }}</span>
			<span v-if="frame && !frame.wider" class="frame-label" :style="{ left: `${frame.box.x0 * 100}%`, top: `${frame.box.y1 * 100}%` }">{{ frame.label }}</span>
		</figure>
		<ul v-if="zones" class="legend" aria-label="False colour">
			<li v-for="c in FALSE_COLOUR" :key="c.key"><i :style="{ background: `rgb(${c.rgb.join(' ')})` }"></i>{{ c.label }}</li>
		</ul>
	</div>
</template>

<style scoped>
.pm-wrap {
	display: grid;
	gap: 0.5rem;
}

.pm {
	position: relative;
	/* Width comes inline: the full column, or less for a tall picture so it stays on screen. */
	margin: 0 auto;
	border-radius: 0.6rem;
	overflow: hidden;
	background: var(--shoot-window);
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	cursor: crosshair;
}

.pm:focus-visible {
	outline: 2px solid var(--shoot-mark);
	outline-offset: 2px;
}

.pm img,
.pm .false,
.pm .over {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.pm img {
	object-fit: fill;
	pointer-events: none;
}

.false {
	opacity: 0.88;
	pointer-events: none;
}

.over {
	overflow: visible;
	pointer-events: none;
}

.outside {
	fill: rgb(0 0 0 / 0.42);
}

.frameline {
	fill: none;
	stroke: rgb(255 255 255 / 0.9);
	stroke-width: 1.5;
	stroke-dasharray: 6 4;
	vector-effect: non-scaling-stroke;
}

.ring,
.ring-dark {
	fill: none;
	vector-effect: non-scaling-stroke;
}

.ring {
	stroke: #fff;
	stroke-width: 2;
}

.ring.live {
	stroke-dasharray: 5 4;
}

.ring-dark {
	stroke: rgb(0 0 0 / 0.55);
	stroke-width: 4.5;
}

.tag {
	position: absolute;
	translate: -50% calc(-100% - 0.9rem);
	padding: 0.15rem 0.45rem;
	border-radius: 0.35rem;
	background: rgb(0 0 0 / 0.72);
	color: #fff;
	font-family: var(--font-mono);
	font-size: 0.72rem;
	white-space: nowrap;
	pointer-events: none;
}

.tag.below {
	translate: -50% 1.6rem;
}

.frame-label {
	position: absolute;
	translate: 0.3rem calc(-100% - 0.25rem);
	padding: 0.05rem 0.3rem;
	border-radius: 0.25rem;
	background: rgb(0 0 0 / 0.55);
	color: #fff;
	font-family: var(--font-mono);
	font-size: 0.62rem;
	pointer-events: none;
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25rem 0.75rem;
	list-style: none;
	padding: 0;
	font-size: 0.7rem;
	color: var(--shoot-meta);
}

.legend li {
	display: flex;
	align-items: center;
	gap: 0.3rem;
}

.legend i {
	width: 0.7rem;
	height: 0.7rem;
	border-radius: 0.15rem;
}

/* Under the safelight the photo goes dim red, like everything else. */
:root[data-safelight] .pm img,
:root[data-safelight] .pm .false {
	filter: grayscale(1) brightness(0.5) sepia(1) hue-rotate(-50deg) saturate(5);
}
</style>
