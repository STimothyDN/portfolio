<template>
	<section v-if="part !== 'charts'" class="tone-review findings-part" aria-labelledby="tone-h">
		<header class="tr-head">
			<h2 id="tone-h" class="lab-h2">How the negatives come back</h2>
			<p class="lab-meta">
				From the tone of {{ desk.scans }} scans on the film desk{{ review.withScans ? `, and ${review.withScans} logged frames that line up with one` : '' }}.
				A thin negative scans with grey, raised blacks; cameras and labs are compared on the same film so the film’s own look doesn’t count against them.
			</p>
		</header>

		<ul v-if="findings.length" class="findings">
			<li v-for="f in findings" :key="f.title" class="finding" :class="f.tone">
				<span class="kind">{{ KIND[f.kind] }}</span>
				<b>{{ f.title }}</b>
				<p>{{ f.text }}</p>
			</li>
		</ul>
		<p v-else class="lab-empty">Nothing stands out yet: your cameras, film and labs all come back about the same.</p>
	</section>

	<section v-if="part !== 'findings'" class="tone-review" aria-label="Scan tone in detail">

		<!-- The light you metered against how the frame scanned -->
		<figure class="scatter-wrap lab-lightbox">
			<figcaption>
				<span class="lab-edge-print">Your frames · light against density</span>
				<span class="lab-meta">{{ review.points.length >= 3 ? 'Each dot is a logged frame with its scan. Higher means flatter (thinner) than the rest of its roll; amber ones came back thin.' : 'Log frames in shooting mode: once their scans come back and line up, each lands here by the light you metered and how dense the negative came out.' }}</span>
			</figcaption>
			<svg v-if="review.points.length >= 3" class="scatter" :viewBox="`0 0 ${SW} ${SH}`" role="img" :aria-label="scatterLabel">
				<g class="bands">
					<rect v-for="b in bands" :key="b.label" :x="b.x" :y="SP" :width="b.w" :height="SH - 2 * SP" :class="b.cls" />
					<text v-for="b in bands" :key="`t${b.label}`" :x="b.x + b.w / 2" :y="SP + 14" text-anchor="middle" class="band-label">{{ b.label }}</text>
				</g>
				<line :x1="SP" :x2="SW - SP" :y1="y(0.15)" :y2="y(0.15)" class="flat-line" />
				<g class="axis">
					<text v-for="ev in [4, 7, 10, 13, 16]" :key="ev" :x="x(ev)" :y="SH - 6" text-anchor="middle">EV {{ ev }}</text>
					<text v-for="b in [0, 0.1, 0.2, 0.3]" :key="b" :x="SP - 6" :y="y(b) + 4" text-anchor="end">{{ b.toFixed(1) }}</text>
				</g>
				<circle v-for="(p, i) in review.points" :key="i" :cx="x(p.ev)" :cy="y(p.black)" r="4.5" :class="{ thin: p.thin }">
					<title>{{ p.label }} · EV {{ p.ev }} · black {{ p.black.toFixed(2) }}{{ p.thin ? ' · thin' : '' }}</title>
				</circle>
			</svg>
		</figure>

		<!-- Every scan's range, black to white, camera by camera -->
		<div class="barcodes">
			<h3 class="lab-edge-print">Every scan, black point to white, by camera</h3>
			<ul>
				<li v-for="g in desk.cameras" :key="g.key" class="code-row">
					<div class="code-name">
						<b>{{ g.label }}</b>
						<span class="lab-mono">{{ g.scans }} scans · {{ pct(g.flat) }} flat · {{ liftText(g) }}</span>
					</div>
					<svg class="code" :viewBox="`0 0 ${g.bars.length * 3} 44`" preserveAspectRatio="none" role="img" :aria-label="`${g.label}: ${g.scans} scans, ${pct(g.flat)} flat`">
						<line x1="0" :x2="g.bars.length * 3" :y1="44 - 15 * 0.44" :y2="44 - 15 * 0.44" class="flat-line" vector-effect="non-scaling-stroke" />
						<rect v-for="([b, w], i) in g.bars" :key="i" :x="i * 3" :y="44 - w * 0.44" width="2" :height="Math.max(1, (w - b) * 0.44)" :class="{ flat: b >= 15 }" />
					</svg>
				</li>
			</ul>
			<p class="lab-hint">Each line is one scan, from its black point (bottom) to its white point (top), in the order the rolls were developed. Short lines that start high are flat scans; the dashed line is where flat begins.</p>
		</div>

		<div class="tables">
			<div v-for="t in tables" :key="t.title" class="table-wrap">
			<table>
				<caption class="lab-edge-print">{{ t.title }}</caption>
				<thead>
					<tr>
						<th scope="col">{{ t.col }}</th>
						<th scope="col">Scans</th>
						<th scope="col">Black</th>
						<th scope="col">Flat</th>
						<th v-if="t.lift" scope="col">vs same film</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="g in t.rows" :key="g.key">
						<th scope="row">{{ g.label }}</th>
						<td class="lab-mono">{{ g.scans }}</td>
						<td class="lab-mono">{{ g.medianBlack.toFixed(2) }}</td>
						<td>
							<span class="meter" :style="{ '--v': g.flat }" aria-hidden="true"></span>
							<span class="lab-mono">{{ pct(g.flat) }}</span>
						</td>
						<td v-if="t.lift" class="lab-mono">{{ g.lift == null ? '—' : `${g.lift >= 0 ? '+' : '−'}${Math.abs(g.lift).toFixed(2)}` }}</td>
					</tr>
				</tbody>
			</table>
			</div>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { LIGHT_BUCKETS, type Finding, type ToneGroup } from '../../lib/lab/insight';
import type { FramesPage } from '../../lib/lab/server/frames';

const props = defineProps<{ review: FramesPage['review']; desk: FramesPage['desk']; part?: 'findings' | 'charts' }>();

const KIND: Record<Finding['kind'], string> = { camera: 'Camera', stock: 'Film', lab: 'Lab', light: 'Light', lens: 'Lens', roll: 'Roll' };
const findings = computed(() => [...props.review.findings, ...props.desk.findings]);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const liftText = (g: ToneGroup) => (g.lift == null ? 'no shared film' : `${g.lift >= 0 ? '+' : '−'}${Math.abs(g.lift).toFixed(2)} vs same film`);

const tables = computed(() => [
	{ title: 'By film', col: 'Film', rows: props.desk.stocks, lift: false },
	{ title: 'By lab', col: 'Lab', rows: props.desk.labs, lift: true },
]);

// Scatter geometry: EV 3–17 across, black point 0–0.35 up.
const SW = 960;
const SH = 300;
const SP = 40;
const x = (ev: number) => SP + ((Math.min(17, Math.max(3, ev)) - 3) / 14) * (SW - 2 * SP);
const y = (b: number) => SH - SP - (Math.min(0.35, b) / 0.35) * (SH - 2 * SP);
const bands = computed(() => {
	const edges = [3, 7, 10, 13, 17];
	const names = [...LIGHT_BUCKETS].reverse().map((b) => b.label);
	return names.map((label, i) => ({ label, x: x(edges[i]), w: x(edges[i + 1]) - x(edges[i]), cls: i % 2 ? 'odd' : 'even' }));
});
const scatterLabel = computed(() => {
	const thin = props.review.points.filter((p) => p.thin).length;
	return `${props.review.points.length} logged frames by light and density; ${thin} came back thin.`;
});
</script>

<style scoped>
.tone-review {
	display: grid;
	gap: 1.5rem;
}

.tr-head {
	display: grid;
	gap: 0.4rem;
	max-width: 48rem;
}

.findings {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	gap: 0.75rem;
	list-style: none;
	padding: 0;
}

.finding {
	display: grid;
	gap: 0.35rem;
	align-content: start;
	padding: 0.9rem 1rem 1rem;
	border: 1px solid var(--gray-800);
	border-left: 3px solid var(--gray-500);
	border-radius: 0.5rem;
	background: var(--gray-999);
}

.finding.warn {
	border-left-color: var(--lab-warn);
}

.finding.good {
	border-left-color: var(--lab-ok);
}

.finding .kind {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.finding b {
	color: var(--gray-0);
	font-size: 1.05rem;
	line-height: 1.25;
}

.finding p {
	font-size: var(--text-sm);
	line-height: 1.5;
	color: var(--gray-200);
}

.scatter-wrap {
	display: grid;
	gap: 0.75rem;
	margin: 0;
	padding: 1rem 1.1rem 0.75rem;
}

.scatter-wrap figcaption {
	display: grid;
	gap: 0.25rem;
}

.scatter {
	width: 100%;
	height: auto;
	font-family: var(--font-mono);
	font-size: 12px;
}

/* The chart shrinks with the screen; its labels and dots shouldn't vanish with it. */
@media (max-width: 40em) {
	.scatter {
		font-size: 26px;
	}

	.scatter circle {
		r: 9px;
	}

	.band-label {
		font-size: 22px;
	}
}

.bands .even {
	fill: oklch(50% 0.02 70 / 0.05);
}

.bands .odd {
	fill: oklch(50% 0.02 70 / 0.1);
}

.band-label {
	fill: var(--gray-300);
	font-size: 11px;
	letter-spacing: 0.06em;
}

.axis text {
	fill: var(--gray-300);
}

.flat-line {
	stroke: var(--lab-edge-text);
	stroke-width: 1;
	stroke-dasharray: 4 4;
	opacity: 0.7;
}

.scatter circle {
	fill: none;
	stroke: var(--gray-100);
	stroke-width: 1.5;
}

.scatter circle.thin {
	fill: var(--lab-edge-ink);
	stroke: var(--lab-edge-text);
}

.barcodes {
	display: grid;
	gap: 0.6rem;
}

.barcodes ul {
	display: grid;
	gap: 0.4rem;
	list-style: none;
	padding: 0.9rem 1rem;
	border-radius: 0.5rem;
	background: var(--lab-film);
}

.code-row {
	display: grid;
	grid-template-columns: minmax(9rem, 14rem) minmax(0, 1fr);
	gap: 0.3rem 1rem;
	align-items: center;
}

@media (max-width: 40em) {
	.code-row {
		grid-template-columns: minmax(0, 1fr);
	}
}

.code-name {
	display: grid;
	gap: 0.05rem;
	color: oklch(94% 0.008 85);
}

.code-name b {
	font-weight: 500;
	font-size: var(--text-sm);
}

.code-name .lab-mono {
	font-size: 0.64rem;
	color: oklch(72% 0.012 75);
}

.code {
	width: 100%;
	height: 2.75rem;
}

.code rect {
	fill: oklch(86% 0.012 80);
}

.code rect.flat {
	fill: var(--lab-edge-ink);
}

.tables {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
	gap: 1.5rem;
}

.table-wrap {
	min-width: 0;
	overflow-x: auto;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--text-sm);
}

caption {
	text-align: left;
	padding-bottom: 0.5rem;
}

th,
td {
	padding: 0.45rem 0.5rem 0.45rem 0;
	text-align: left;
	border-bottom: 1px solid var(--gray-800);
	font-weight: 400;
	white-space: nowrap;
}

thead th {
	font-size: 0.68rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--gray-300);
}

tbody th {
	color: var(--gray-0);
	white-space: normal;
}

.meter {
	display: inline-block;
	width: 3rem;
	height: 0.4rem;
	margin-right: 0.4rem;
	border-radius: 999px;
	vertical-align: middle;
	background: linear-gradient(90deg, var(--lab-edge-text) calc(var(--v) * 100%), var(--gray-800) 0);
}
</style>
