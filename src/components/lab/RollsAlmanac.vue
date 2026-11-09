<template>
	<section class="almanac" aria-label="Your rolls at a glance">
		<!-- The readout: a few numbers worth knowing, wound up like a frame counter -->
		<dl class="stats">
			<div class="stat">
				<dt>Rolls in the logbook</dt>
				<dd><CountUp :value="rolls.length" /></dd>
				<dd class="sub">{{ thisYear }} this year · {{ inStorage }} unshot</dd>
			</div>
			<div class="stat">
				<dt>Frames scanned</dt>
				<dd><CountUp :value="scanned" /></dd>
				<dd class="sub">{{ linked }} rolls on the film desk{{ frames.length ? ` · ${frames.length} logged` : '' }}</dd>
			</div>
			<div class="stat">
				<dt>In cameras now</dt>
				<dd><CountUp :value="loaded.length" /></dd>
				<dd class="sub">{{ loaded.length ? loaded.map((r) => r.camera?.name ?? r.code).join(', ') : 'nothing loaded' }}</dd>
			</div>
			<div class="stat">
				<dt>Days in a camera</dt>
				<dd>{{ cameraDays ?? '—' }}</dd>
				<dd class="sub">{{ cameraDays == null ? 'median, once rolls are finished' : `median of ${cameraTimed} rolls` }}</dd>
			</div>
			<div class="stat">
				<dt>{{ spent ? 'Spent on film + lab' : 'Film stocks shot' }}</dt>
				<dd v-if="spent"><CountUp :value="spent / 100" :format="(n) => `$${Math.round(n).toLocaleString('en-US')}`" /></dd>
				<dd v-else><CountUp :value="stockRows.length" /></dd>
				<dd class="sub">{{ spent ? `${formatMoney(Math.round(spent / Math.max(1, pricedRolls)))} a roll, where priced` : `${brands} brands` }}</dd>
			</div>
		</dl>

		<div class="plates">
			<!-- Contact sheet calendar -->
			<article class="plate wide">
				<header>
					<h3>The contact sheet</h3>
					<p class="lab-edge-print" aria-live="polite">{{ calReadout ?? 'Each frame is a roll, by the month you shot it · tap a month to filter' }}</p>
				</header>
				<AlmanacCalendar :rolls="rolls" :milestones="milestones" :today="today" :active="active" @filter="toggle" @hover="calReadout = $event" />
			</article>

			<!-- Stock ribbon -->
			<article class="plate stocks">
				<header>
					<h3>What you shoot</h3>
					<p class="lab-edge-print" aria-live="polite">{{ stockReadout ?? `${stockRows.length} stocks · ${brands} brands · widest band = most rolls` }}</p>
				</header>
				<div class="ribbon" role="group" aria-label="Rolls by film stock">
					<button
						v-for="(s, i) in stockRows"
						:key="s.id"
						type="button"
						class="band"
						:class="{ picked: isActive('stock', s.id), dim: active?.kind === 'stock' && !isActive('stock', s.id) }"
						:style="{ flexGrow: s.count, '--c': s.color, '--ink': s.ink, '--i': i }"
						:aria-label="`${s.name}: ${s.count} ${s.count === 1 ? 'roll' : 'rolls'}`"
						:aria-pressed="isActive('stock', s.id)"
						@click="toggle({ kind: 'stock', value: s.id, label: s.name })"
						@mouseenter="stockReadout = `${s.name} · ${s.count} ${s.count === 1 ? 'roll' : 'rolls'} · ${pct(s.count)}`"
						@mouseleave="stockReadout = null"
					>
						<span v-if="s.count / rolls.length > 0.07">{{ s.short }}</span>
					</button>
				</div>
				<ol class="legend">
					<li v-for="s in stockRows.slice(0, 6)" :key="s.id">
						<button type="button" :aria-pressed="isActive('stock', s.id)" @click="toggle({ kind: 'stock', value: s.id, label: s.name })">
							<span class="can" :style="{ '--can-h': '38px' }">
								<FilmCanister :stock="s.token ?? s.id" :stock-label="s.name" :stock-brand="s.brand" />
							</span>
							<span class="lg-name">{{ s.name }}</span>
							<span class="lg-n">{{ s.count }}</span>
						</button>
					</li>
				</ol>
			</article>

			<!-- ISO dial -->
			<article class="plate dialplate">
				<header>
					<h3>Film speed</h3>
					<p class="lab-edge-print">Box speed of every roll · tap a spoke to filter</p>
				</header>
				<AlmanacDial :rolls="rolls" :active="active" @filter="toggle" />
			</article>

			<!-- Cameras -->
			<article class="plate">
				<header>
					<h3>Cameras</h3>
					<p class="lab-edge-print">{{ cameraRows.length }} cameras have shot a roll · d = median days a roll spends in it{{ loaded.length ? ' · ● loaded now' : '' }}</p>
				</header>
				<ul class="bars">
					<li v-for="(c, i) in cameraRows" :key="c.id">
						<button type="button" :aria-pressed="isActive('camera', c.id)" :style="{ '--i': i }" @click="toggle({ kind: 'camera', value: c.id, label: c.name })">
							<span class="b-name">{{ c.name }}<span v-if="c.loaded" class="live" aria-label="loaded now">●</span><span v-if="c.days != null" class="b-days" :title="`A roll usually spends ${c.days} days in it`">{{ c.days }}d</span></span>
							<span class="b-track"><span class="b-fill" :style="{ width: `${(c.count / cameraMax) * 100}%` }"></span></span>
							<span class="b-n">{{ c.count }}</span>
						</button>
					</li>
				</ul>
			</article>

			<!-- Labs -->
			<article class="plate">
				<header>
					<h3>Labs</h3>
					<p class="lab-edge-print">Each dot: days from drop-off to scans · tick = median</p>
				</header>
				<ul class="labs">
					<li v-for="l in labRows" :key="l.id">
						<button type="button" :aria-pressed="isActive('lab', l.id)" @click="toggle({ kind: 'lab', value: l.id, label: l.name })">
							<span class="l-head">
								<span class="b-name">{{ l.name }}</span>
								<span class="l-meta">{{ l.count }} {{ l.count === 1 ? 'roll' : 'rolls' }}{{ l.median != null ? ` · ${l.median} days` : '' }}</span>
							</span>
							<span class="l-track" :aria-label="l.days.length ? `${l.days.length} timed rolls, median ${l.median} days` : 'no timed rolls yet'">
								<span v-for="(d, k) in l.days" :key="k" class="l-dot" :style="{ left: `${(d / labMax) * 100}%`, '--k': k }"></span>
								<span v-if="l.median != null" class="l-med" :style="{ left: `${(l.median / labMax) * 100}%` }"></span>
								<span v-if="!l.days.length" class="l-none">timing starts with the next drop-off</span>
							</span>
						</button>
					</li>
				</ul>
				<p v-if="labRows.length" class="axis-note lab-edge-print">0 → {{ labMax }} days</p>
			</article>

			<!-- What a frame costs -->
			<article class="plate wide cost">
				<header>
					<h3>What a frame costs</h3>
					<p class="lab-edge-print">Film plus developing, scans and any prints, over the frames each roll gave</p>
				</header>
				<div v-if="cost" class="cost-grid">
					<div class="cost-side">
						<p class="cost-big">
							<b>{{ formatMoney(Math.round(cost.perFrame)) }}</b>
							<span>a frame, across {{ cost.rolls }} {{ cost.rolls === 1 ? 'roll' : 'rolls' }} · film {{ cost.filmShare }}%, lab {{ 100 - cost.filmShare }}%</span>
						</p>
						<span class="split" aria-hidden="true"><i :style="{ width: `${cost.filmShare}%` }"></i></span>
						<p v-if="fridgeValue" class="lab-meta">The fridge holds {{ formatMoney(fridgeValue.cents) }} of film across {{ fridgeValue.rolls }} priced {{ fridgeValue.rolls === 1 ? 'roll' : 'rolls' }}.</p>
					</div>
					<ul class="bars">
						<li v-for="(c, i) in cost.byStock" :key="c.id">
							<button type="button" :aria-pressed="isActive('stock', c.id)" :style="{ '--i': i }" @click="toggle({ kind: 'stock', value: c.id, label: c.name })">
								<span class="b-name">{{ c.name }}</span>
								<span class="b-track"><span class="b-fill" :style="{ width: `${(c.perFrame / cost.max) * 100}%`, background: c.color }"></span></span>
								<span class="b-n">{{ formatMoney(Math.round(c.perFrame)) }}</span>
							</button>
						</li>
					</ul>
				</div>
				<p v-else class="lab-meta">Add a price or lab cost to a few finished rolls and this works out what each frame costs you.</p>
			</article>

			<!-- Exposure map + clock -->
			<article class="plate wide">
				<header>
					<h3>Where your frames sit</h3>
					<p class="lab-edge-print">Logged exposures on the aperture × shutter grid · when you shoot</p>
				</header>
				<AlmanacExposure :frames="frames" />
			</article>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { daysFrom, median, rollMonth, type Facet, type FrameDigest, type Milestones } from '../../lib/lab/almanac';
import { formatMoney, type RollView } from '../../lib/lab/inventory';
import { canisterColors } from '../film/canister';
import FilmCanister from '../film/FilmCanister.vue';
import AlmanacCalendar from './AlmanacCalendar.vue';
import AlmanacDial from './AlmanacDial.vue';
import AlmanacExposure from './AlmanacExposure.vue';
import CountUp from './CountUp.vue';

const props = defineProps<{
	rolls: RollView[];
	milestones: Milestones;
	frames: FrameDigest[];
	deskCounts: Record<string, number>;
	today: string;
	active: Facet | null;
}>();
const emit = defineEmits<{ filter: [facet: Facet | null] }>();

const calReadout = ref<string | null>(null);
const stockReadout = ref<string | null>(null);

const isActive = (kind: Facet['kind'], value: string) => props.active?.kind === kind && props.active.value === value;
function toggle(f: Facet) {
	emit('filter', isActive(f.kind, f.value) ? null : f);
}
const pct = (n: number) => `${Math.round((n / Math.max(1, props.rolls.length)) * 100)}%`;

/* ---------- the readout ---------- */

const year = props.today.slice(0, 4);
const thisYear = computed(() => props.rolls.filter((r) => rollMonth(r, props.milestones)?.startsWith(year)).length);
const inStorage = computed(() => props.rolls.filter((r) => r.status === 'storage').length);
const loaded = computed(() => props.rolls.filter((r) => r.status === 'camera'));
const linked = computed(() => props.rolls.filter((r) => r.publicRollId).length);
const scanned = computed(() => props.rolls.reduce((n, r) => n + (r.publicRollId ? props.deskCounts[r.publicRollId] ?? 0 : 0), 0));
const cameraSpans = computed(() =>
	props.rolls
		.map((r) => props.milestones[r.id])
		.filter((m) => m?.camera && m.shot)
		.map((m) => daysFrom(m!.camera!, m!.shot!))
		.filter((d) => d >= 0)
);
const cameraDays = computed(() => median(cameraSpans.value));
const cameraTimed = computed(() => cameraSpans.value.length);
/** What a roll cost at the lab: developing and scans, plus prints when they were extra. */
const labCents = (r: RollView) => (r.devCostCents ?? 0) + (r.printsCostCents ?? 0);
const spent = computed(() => props.rolls.reduce((n, r) => n + (r.priceCents ?? 0) + labCents(r), 0));
const pricedRolls = computed(() => props.rolls.filter((r) => r.priceCents != null || r.devCostCents != null || r.printsCostCents != null).length);

/* ---------- stocks ---------- */

const stockRows = computed(() => {
	const map = new Map<string, { id: string; token: string | null; name: string; brand: string; count: number }>();
	for (const r of props.rolls) {
		const row = map.get(r.stock.id) ?? { id: r.stock.id, token: r.stock.token, name: r.stock.name, brand: r.stock.brand, count: 0 };
		row.count++;
		map.set(r.stock.id, row);
	}
	return [...map.values()]
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.map((s) => {
			const { can, ink } = canisterColors({ stock: s.token ?? s.id, stockLabel: s.name, stockBrand: s.brand });
			// The name without its brand, for the band itself.
			const bare = s.name.replace(new RegExp(`^${s.brand}\\s+`, 'i'), '').replace(/^Fuji(color|film)\s+/i, '');
			// "400" alone says nothing: keep the brand on number-only names.
			const short = /^\d+$/.test(bare) ? s.name : bare;
			return { ...s, color: can, ink, short };
		});
});
const brands = computed(() => new Set(stockRows.value.map((s) => s.brand)).size);

/* ---------- cameras and labs ---------- */

const cameraRows = computed(() => {
	const map = new Map<string, { id: string; name: string; count: number; loaded: boolean; spans: number[] }>();
	for (const r of props.rolls) {
		if (!r.camera || r.status === 'storage') continue;
		const row = map.get(r.camera.id) ?? { id: r.camera.id, name: r.camera.name, count: 0, loaded: false, spans: [] };
		row.count++;
		if (r.status === 'camera') row.loaded = true;
		const m = props.milestones[r.id];
		if (m?.camera && m.shot && daysFrom(m.camera, m.shot) >= 0) row.spans.push(daysFrom(m.camera, m.shot));
		map.set(r.camera.id, row);
	}
	return [...map.values()]
		.map((c) => ({ ...c, days: median(c.spans) }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});
const cameraMax = computed(() => Math.max(1, ...cameraRows.value.map((c) => c.count)));

const labRows = computed(() => {
	const map = new Map<string, { id: string; name: string; count: number; days: number[]; median: number | null }>();
	for (const r of props.rolls) {
		if (!r.lab) continue;
		const row = map.get(r.lab.id) ?? { id: r.lab.id, name: r.lab.name, count: 0, days: [], median: null };
		row.count++;
		const m = props.milestones[r.id];
		if (m?.lab && m.scanned) {
			const d = daysFrom(m.lab, m.scanned);
			if (d >= 0) row.days.push(d);
		}
		map.set(r.lab.id, row);
	}
	return [...map.values()].map((l) => ({ ...l, median: median(l.days) })).sort((a, b) => b.count - a.count);
});
const labMax = computed(() => Math.max(14, ...labRows.value.flatMap((l) => l.days)));

/* ---------- cost per frame ---------- */

/** Frames a finished roll gave: its scans on the desk, else its exposures. */
const framesOf = (r: RollView) => (r.publicRollId ? props.deskCounts[r.publicRollId] : undefined) || r.exposures;
const cost = computed(() => {
	const done = props.rolls.filter(
		(r) => ['shot', 'lab', 'scanned', 'negatives'].includes(r.status) && (r.priceCents != null || r.devCostCents != null || r.printsCostCents != null)
	);
	if (!done.length) return null;
	const film = done.reduce((n, r) => n + (r.priceCents ?? 0), 0);
	const lab = done.reduce((n, r) => n + labCents(r), 0);
	const frames = done.reduce((n, r) => n + framesOf(r), 0);
	const byStock = new Map<string, { id: string; name: string; cents: number; frames: number; color: string }>();
	for (const r of done) {
		const row =
			byStock.get(r.stock.id) ??
			{ id: r.stock.id, name: r.stock.name, cents: 0, frames: 0, color: canisterColors({ stock: r.stock.token ?? r.stock.id, stockLabel: r.stock.name, stockBrand: r.stock.brand }).can };
		row.cents += (r.priceCents ?? 0) + labCents(r);
		row.frames += framesOf(r);
		byStock.set(r.stock.id, row);
	}
	const rows = [...byStock.values()].map((s) => ({ ...s, perFrame: s.cents / Math.max(1, s.frames) })).sort((a, b) => a.perFrame - b.perFrame).slice(0, 8);
	return {
		perFrame: (film + lab) / Math.max(1, frames),
		rolls: done.length,
		filmShare: Math.round((film / Math.max(1, film + lab)) * 100),
		byStock: rows,
		max: Math.max(1, ...rows.map((r) => r.perFrame)),
	};
});
const fridgeValue = computed(() => {
	const priced = props.rolls.filter((r) => r.status === 'storage' && r.priceCents != null);
	return priced.length ? { cents: priced.reduce((n, r) => n + r.priceCents!, 0), rolls: priced.length } : null;
});
</script>

<style scoped>
.almanac {
	display: grid;
	gap: 1.25rem;
}

/* ---------- the readout ---------- */
.stats {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	margin: 0;
	border-block: 1px solid var(--gray-800);
}

.stat {
	display: grid;
	align-content: start;
	gap: 0.15rem;
	padding: 0.9rem 1rem 1rem;
	border-left: 1px solid var(--gray-800);
}

.stat:first-child {
	border-left: 0;
	padding-left: 0;
}

.stat dt {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.stat dd {
	margin: 0;
	font-family: var(--font-brand);
	font-size: clamp(1.9rem, 3.4vw, 2.6rem);
	font-weight: 420;
	font-variation-settings: 'opsz' 96;
	line-height: 1.05;
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

.stat .sub {
	font-family: var(--font-body);
	font-size: var(--text-sm);
	line-height: 1.35;
	color: var(--gray-300);
	overflow-wrap: anywhere;
}

@media (max-width: 64em) {
	.stats {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.stat:nth-child(4) {
		border-left: 0;
		padding-left: 0;
	}

	.stat:nth-child(n + 4) {
		border-top: 1px solid var(--gray-800);
	}
}

@media (max-width: 34em) {
	.stats {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.stat:nth-child(n) {
		border-left: 1px solid var(--gray-800);
		padding-left: 1rem;
		border-top: 0;
	}

	.stat:nth-child(odd) {
		border-left: 0;
		padding-left: 0;
	}

	.stat:nth-child(n + 3) {
		border-top: 1px solid var(--gray-800);
	}
}

/* ---------- plates ---------- */
.plates {
	display: grid;
	grid-template-columns: repeat(12, minmax(0, 1fr));
	gap: 1rem;
}

.plate {
	grid-column: span 6;
	display: grid;
	align-content: start;
	gap: 1rem;
	min-width: 0;
	padding: 1.1rem 1.2rem 1.25rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
	background: color-mix(in oklch, var(--gray-999) 92%, var(--gray-900));
}

.plate.wide {
	grid-column: 1 / -1;
}

.plate.stocks {
	grid-column: span 7;
}

.plate.dialplate {
	grid-column: span 5;
}

@media (max-width: 60em) {
	.plate,
	.plate.stocks,
	.plate.dialplate {
		grid-column: 1 / -1;
	}
}

.plate header {
	display: grid;
	gap: 0.25rem;
}

.plate h3 {
	font-family: var(--font-brand);
	font-size: var(--text-lg);
	font-weight: 560;
	font-variation-settings: 'opsz' 30;
	letter-spacing: -0.01em;
	color: var(--gray-0);
}

.plate .lab-edge-print {
	min-height: 1.3em;
	line-height: 1.4;
}

/* ---------- stock ribbon ---------- */
.ribbon {
	display: flex;
	gap: 2px;
	height: 3.4rem;
	padding: 0.45rem 0.3rem;
	border-radius: 3px;
	background: var(--lab-film);
	position: relative;
}

.ribbon::before,
.ribbon::after {
	content: '';
	position: absolute;
	inset-inline: 0.3rem;
	height: 0.2rem;
	background: repeating-linear-gradient(90deg, var(--lab-sprocket) 0 0.35rem, transparent 0.35rem 0.7rem);
	opacity: 0.7;
}

.ribbon::before {
	top: 0.1rem;
}

.ribbon::after {
	bottom: 0.1rem;
}

.band {
	flex-basis: 0;
	min-width: 0.4rem;
	display: grid;
	place-items: center;
	padding: 0 0.3rem;
	border: 0;
	border-radius: 2px;
	background: var(--c);
	color: var(--ink);
	font-family: var(--font-mono);
	font-size: 0.66rem;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	white-space: nowrap;
	overflow: hidden;
	cursor: pointer;
	box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
	transition:
		opacity 0.2s ease,
		transform 0.2s ease;
}

.band span {
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 100%;
}

.band:hover,
.band:focus-visible,
.band.picked {
	transform: translateY(-2px);
	outline: none;
	box-shadow:
		inset 0 0 0 1px rgb(255 255 255 / 0.4),
		0 0 0 2px var(--lab-lit);
}

.band.dim {
	opacity: 0.3;
}

.legend {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 11.5rem), 1fr));
	gap: 0.3rem 0.75rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.legend button,
.bars button,
.labs button {
	width: 100%;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	border-radius: 0.4rem;
}

.legend button {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.25rem 0.35rem;
}

.legend button:hover,
.legend button[aria-pressed='true'],
.bars button:hover,
.bars button[aria-pressed='true'],
.labs button:hover,
.labs button[aria-pressed='true'] {
	background: var(--gray-900);
}

.legend button:focus-visible,
.bars button:focus-visible,
.labs button:focus-visible {
	outline: 2px solid var(--accent-regular);
}

.can {
	display: grid;
	place-items: center;
	width: 1.1rem;
	flex: none;
}

.lg-name {
	flex: 1;
	min-width: 0;
	font-size: var(--text-sm);
	color: var(--gray-200);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.lg-n,
.b-n {
	font-family: var(--font-mono);
	font-size: 0.8rem;
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

/* ---------- bars ---------- */
.b-days {
	margin-left: 0.4rem;
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--gray-300);
}

.cost-grid {
	display: grid;
	gap: 1rem 2rem;
}

@media (min-width: 48em) {
	.cost-grid {
		grid-template-columns: minmax(14rem, 1fr) minmax(0, 2fr);
		align-items: start;
	}
}

.cost-side {
	display: grid;
	gap: 0.75rem;
}

/* Film against lab, as one bar. */
.split {
	display: block;
	height: 0.45rem;
	border-radius: 999px;
	background: var(--lab-edge-text);
	overflow: hidden;
}

.split i {
	display: block;
	height: 100%;
	background: var(--gray-0);
}

.cost-big {
	display: grid;
	gap: 0.15rem;
}

.cost-big b {
	font-family: var(--font-mono);
	font-size: 2rem;
	font-weight: 500;
	line-height: 1;
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

.cost-big span {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.bars,
.labs {
	display: grid;
	gap: 0.2rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.bars button {
	display: grid;
	grid-template-columns: minmax(7rem, 11rem) 1fr 2rem;
	align-items: center;
	gap: 0.75rem;
	padding: 0.4rem 0.4rem;
}

.b-name {
	font-size: var(--text-sm);
	color: var(--gray-200);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.live {
	margin-left: 0.35rem;
	color: oklch(58% 0.19 28);
	font-size: 0.7em;
	vertical-align: 0.15em;
}

.b-track {
	height: 0.6rem;
	border-radius: 999px;
	background: var(--gray-900);
	overflow: hidden;
}

.b-fill {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, var(--lab-edge-ink), color-mix(in oklch, var(--lab-edge-ink) 70%, var(--gray-0)));
}

.b-n {
	text-align: right;
}

/* ---------- lab turnaround ---------- */
.labs button {
	display: grid;
	gap: 0.4rem;
	padding: 0.5rem 0.4rem 0.6rem;
}

.l-head {
	display: flex;
	justify-content: space-between;
	gap: 0.75rem;
}

.l-meta {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	color: var(--gray-300);
	white-space: nowrap;
}

.l-track {
	position: relative;
	display: block;
	height: 0.9rem;
	border-bottom: 1px solid var(--gray-700);
}

.l-dot {
	position: absolute;
	top: 0.15rem;
	width: 0.55rem;
	height: 0.55rem;
	margin-left: -0.275rem;
	border-radius: 50%;
	background: color-mix(in oklch, var(--lab-edge-ink) 65%, transparent);
	box-shadow: 0 0 0 1px var(--lab-edge-ink);
}

.l-med {
	position: absolute;
	top: -0.15rem;
	bottom: -0.25rem;
	width: 2px;
	margin-left: -1px;
	background: var(--gray-0);
}

.l-none {
	position: relative;
	top: -0.3rem;
	font-family: var(--font-mono);
	font-size: 0.66rem;
	color: var(--gray-400);
}

.axis-note {
	justify-self: end;
}

@media (prefers-reduced-motion: no-preference) {
	.band {
		animation: unspool 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.15s + var(--i) * 35ms);
	}

	@keyframes unspool {
		from {
			opacity: 0.001;
			scale: 1 0.2;
		}
	}

	.b-fill {
		transform-origin: left;
		animation: fill 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(0.25s + var(--i, 0) * 50ms);
	}

	@keyframes fill {
		from {
			transform: scaleX(0);
		}
	}

	.l-dot {
		animation: drop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
		animation-delay: calc(0.3s + var(--k) * 40ms);
	}

	@keyframes drop {
		from {
			opacity: 0;
			translate: 0 -0.6rem;
		}
	}
}
</style>
