<template>
	<figure ref="root" class="map" :style="{ height: `${height}px` }">
		<template v-if="view">
			<div class="tiles" aria-hidden="true">
				<img v-for="t in view.tiles" :key="t.key" :src="t.src" alt="" :style="{ left: `${t.left}px`, top: `${t.top}px` }" loading="lazy" decoding="async" draggable="false" />
			</div>
			<button
				v-for="c in view.clusters"
				:key="c.key"
				type="button"
				class="dot"
				:class="{ picked: picked === c.key, thin: c.thin }"
				:style="{ left: `${c.x}px`, top: `${c.y}px`, '--r': `${c.r}px` }"
				:aria-label="`${c.ids.length} ${c.ids.length === 1 ? 'frame' : 'frames'} here${c.thin ? ', some thin' : ''}`"
				:aria-pressed="picked === c.key"
				@click="pick(c)"
			>
				<span v-if="c.ids.length > 1">{{ c.ids.length }}</span>
			</button>
		</template>
		<p v-if="mounted && !points.length" class="empty">No frames with a location {{ filtered ? 'in this search' : 'yet' }}.</p>
		<figcaption class="credit">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</figcaption>
	</figure>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface MapPoint {
	id: string;
	lat: number;
	lng: number;
	thin?: boolean;
}

const props = withDefaults(defineProps<{ points: MapPoint[]; height?: number; filtered?: boolean }>(), { height: 340, filtered: false });
const emit = defineEmits<{ pick: [ids: string[] | null] }>();

const TILE = 256;
const MAX_ZOOM = 15;
const PAD = 36;

const root = ref<HTMLElement | null>(null);
const width = ref(0);
const mounted = ref(false);
const picked = ref<string | null>(null);

// Web Mercator, in pixels at zoom z.
const px = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const py = (lat: number, z: number) => {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

const view = computed(() => {
	const W = width.value;
	const H = props.height;
	const pts = props.points;
	if (!W || !pts.length) return null;
	const lats = pts.map((p) => p.lat);
	const lngs = pts.map((p) => p.lng);
	const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
	let z = MAX_ZOOM;
	while (z > 1 && (px(maxLng, z) - px(minLng, z) > W - 2 * PAD || py(minLat, z) - py(maxLat, z) > H - 2 * PAD)) z--;
	if (pts.length === 1) z = Math.min(z, 13);
	const cx = (px(minLng, z) + px(maxLng, z)) / 2;
	const cy = (py(minLat, z) + py(maxLat, z)) / 2;
	const left = cx - W / 2;
	const top = cy - H / 2;
	const n = 2 ** z;
	const tiles = [];
	for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) {
		for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
			if (ty < 0 || ty >= n) continue;
			const wx = ((tx % n) + n) % n;
			tiles.push({ key: `${z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, left: tx * TILE - left, top: ty * TILE - top });
		}
	}
	// Frames within a few pixels of each other share one dot.
	const cell = 22;
	const groups = new Map<string, { xs: number[]; ys: number[]; ids: string[]; thin: boolean }>();
	for (const p of pts) {
		const x = px(p.lng, z) - left;
		const y = py(p.lat, z) - top;
		const key = `${Math.round(x / cell)}:${Math.round(y / cell)}`;
		const g = groups.get(key) ?? { xs: [], ys: [], ids: [], thin: false };
		g.xs.push(x);
		g.ys.push(y);
		g.ids.push(p.id);
		g.thin ||= !!p.thin;
		groups.set(key, g);
	}
	const avg = (l: number[]) => l.reduce((s, v) => s + v, 0) / l.length;
	const clusters = [...groups].map(([key, g]) => ({
		key: `${z}:${key}`,
		x: Math.round(avg(g.xs)),
		y: Math.round(avg(g.ys)),
		r: Math.round(Math.min(18, 6 + Math.sqrt(g.ids.length) * 3)),
		ids: g.ids,
		thin: g.thin,
	}));
	return { tiles, clusters };
});

function pick(c: { key: string; ids: string[] }) {
	picked.value = picked.value === c.key ? null : c.key;
	emit('pick', picked.value ? c.ids : null);
}
// A new search clears the pick.
watch(
	() => props.points,
	() => {
		if (picked.value) {
			picked.value = null;
			emit('pick', null);
		}
	}
);

let ro: ResizeObserver | undefined;
onMounted(() => {
	mounted.value = true;
	const measure = () => (width.value = root.value?.clientWidth ?? 0);
	measure();
	ro = new ResizeObserver(measure);
	if (root.value) ro.observe(root.value);
});
onBeforeUnmount(() => {
	ro?.disconnect();
});
</script>

<style scoped>
.map {
	position: relative;
	overflow: hidden;
	margin: 0;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
	background: var(--gray-900);
	touch-action: pan-y;
	user-select: none;
}

/* OpenStreetMap's own tiles, greyed to sit quietly behind the dots. */
.tiles img {
	position: absolute;
	width: 256px;
	height: 256px;
	max-width: none;
	filter: grayscale(1) contrast(0.85) brightness(1.06);
}

:root.theme-dark .tiles img {
	filter: grayscale(1) invert(1) contrast(0.8) brightness(0.85);
}

.dot {
	position: absolute;
	display: grid;
	place-items: center;
	width: calc(var(--r) * 2);
	height: calc(var(--r) * 2);
	margin: calc(var(--r) * -1) 0 0 calc(var(--r) * -1);
	padding: 0;
	border: 2px solid var(--gray-999);
	border-radius: 50%;
	background: var(--accent-regular);
	color: var(--accent-text-over);
	font-family: var(--font-mono);
	font-size: 0.65rem;
	box-shadow: 0 1px 4px oklch(0% 0 0 / 0.35);
	cursor: pointer;
	transition: scale 0.15s ease;
}

.dot.thin {
	background: var(--lab-edge-text, oklch(62% 0.14 58));
}

.dot:hover,
.dot.picked {
	scale: 1.2;
	z-index: 1;
}

.dot.picked {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.dot:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 3px;
}

.empty {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	color: var(--gray-300);
	font-size: var(--text-sm);
}

.credit {
	position: absolute;
	right: 0.4rem;
	bottom: 0.3rem;
	padding: 0.1rem 0.4rem;
	border-radius: 0.25rem;
	background: color-mix(in oklch, var(--gray-999) 80%, transparent);
	font-size: 0.62rem;
	color: var(--gray-300);
}

.credit a {
	color: inherit;
}

@media (prefers-reduced-motion: reduce) {
	.dot {
		transition: none;
	}
}
</style>
