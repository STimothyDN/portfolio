<script setup lang="ts">
/**
 * The almanac: what your film adds up to. Findings first (the few things
 * worth knowing, each a sentence with its numbers), then nine chapters, each
 * a question with the figure that answers it and one thing to do about it.
 * Everything is worked out on the server (server/almanac.ts); this draws it.
 */
import { computed } from 'vue';

import { monthLabel } from '../../../lib/lab/almanac';
import { formatAperture, formatDay, formatMoney } from '../../../lib/lab/inventory';
import { formatMonths } from '../../../lib/lab/pace';
import type { AlmanacData } from '../../../lib/lab/server/almanac';
import { LEGS } from '../../../lib/lab/stats/pipeline';
import BarList from '../charts/BarList.vue';
import Columns from '../charts/Columns.vue';
import Figure from '../charts/Figure.vue';
import Scatter from '../charts/Scatter.vue';
import SpreadRows from '../charts/SpreadRows.vue';

const props = defineProps<{ data: AlmanacData }>();
const d = props.data;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (c: number) => formatMoney(Math.round(c));
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${(Math.abs(v) / 100).toFixed(2)}`;

const CHAPTERS = [
	['life', 'The life of a roll'],
	['exposure', 'Exposure'],
	['light', 'Film for the light'],
	['keepers', 'Keepers'],
	['rhythm', 'Rhythm'],
	['kit', 'Kit'],
	['labs', 'Labs'],
	['money', 'Money'],
	['shelf', 'Shelf life'],
] as const;

/* ---------- 1 · life ---------- */
const STAGE_OF = { camera: 'camera', waiting: 'shot', lab: 'lab', filing: 'scanned' } as const;
const legRows = computed(() =>
	LEGS.map((l) => {
		const s = d.pipeline.legs[l.key];
		return { key: l.key, label: l.label, values: d.pipeline.values[l.key], median: s ? Math.round(s.median) : null, lo: s ? Math.round(s.lo) : null, hi: s ? Math.round(s.hi) : null, color: `var(--lab-stage-${STAGE_OF[l.key]})` };
	}).filter((r) => r.values.length)
);
const lifeFinding = computed(() => {
	const s = d.pipeline.slowest ? d.pipeline.legs[d.pipeline.slowest] : null;
	if (!s || !d.pipeline.slowest) return null;
	const leg = LEGS.find((l) => l.key === d.pipeline.slowest)!;
	const total = LEGS.reduce((t, l) => t + (d.pipeline.legs[l.key]?.median ?? 0), 0);
	return `From loading to filing takes about ${Math.round(total)} days. The longest stretch is ${leg.label.toLowerCase()}: a median ${Math.round(s.median)} days, usually ${Math.round(s.lo)}–${Math.round(s.hi)} (${plural(s.n, 'roll')}).`;
});
const backlog = computed(() => {
	const weeks = d.pipeline.backlog;
	const fmt = (w: string) => formatDay(w, false).replace(/^(\w{3}) (\d+)$/, '$1 $2');
	return { labels: weeks.map((w) => fmt(w.week)), values: [weeks.map((w) => w.shot), weeks.map((w) => w.lab), weeks.map((w) => w.scanned)] };
});
const backlogPeak = computed(() => Math.max(0, ...d.pipeline.backlog.map((w) => w.shot + w.lab + w.scanned)));

/* ---------- 2 · exposure ---------- */
const camLift = computed(() =>
	(d.exposure.desk?.cameras ?? []).filter((g) => g.lift != null && g.compared >= 10).map((g) => ({ key: g.key, label: g.label, value: Math.round(g.lift! * 100), n: g.compared, note: g.mostly ? 'one lab only' : undefined }))
);
const labLift = computed(() => (d.exposure.desk?.labs ?? []).filter((g) => g.lift != null && g.compared >= 10).map((g) => ({ key: g.key, label: g.label, value: Math.round(g.lift! * 100), n: g.compared })));
const thinShare = computed(() => (d.exposure.points.length ? d.exposure.points.filter((p) => p.thin).length / d.exposure.points.length : 0));

/* ---------- 3 · light ---------- */
const fits = computed(() => d.light.fits.filter((f) => f.n >= 5));
const fitColumns = (f: (typeof d.light.fits)[number]) => {
	const lo = Math.min(Math.floor(f.window[0]) - 1, ...f.bins.map((b) => b.ev));
	const hi = Math.max(Math.ceil(f.window[1]) + 1, ...f.bins.map((b) => b.ev));
	const evs = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
	const count = new Map(f.bins.map((b) => [b.ev, b.n]));
	return {
		labels: evs.map((e) => String(e)),
		values: [evs.map((e) => count.get(e) ?? 0)],
		band: { from: evs.indexOf(Math.ceil(f.window[0])), to: evs.indexOf(Math.floor(f.window[1])), label: 'hand-held' },
	};
};
const lightFinding = computed(() => {
	const worst = [...fits.value].sort((a, b) => b.under - a.under)[0];
	if (!worst) return null;
	const best = d.light.best;
	return `${pct(worst.under)} of your ISO ${worst.iso} frames were in light too dim to hold at f/2 and 1/30 (median scene EV ${worst.median.toFixed(1)}).${best ? ` Across everything you logged, ISO ${best.iso} film would have kept ${pct(best.inside)} of frames hand-holdable.` : ''}`;
});

/* ---------- 4 · keepers ---------- */
const rateRows = (list: typeof d.keepers.camera) => list.map((r) => ({ key: r.key, label: r.label, value: r.rate, lo: r.lo, hi: r.hi, n: r.n }));
const keeperFinding = computed(() => {
	const o = d.keepers.overall;
	if (!o) return null;
	const top = d.keepers.camera[0];
	const pos = [...d.keepers.position].sort((a, b) => a.rate - b.rate)[0];
	return `${pct(o.rate)} of your scans are keepers (${o.k} of ${o.n}).${top ? ` The ${top.label} leads at ${pct(top.rate)} (likely ${pct(top.lo)}–${pct(top.hi)}).` : ''}${pos && pos.rate < o.rate * 0.75 ? ` Frames ${pos.label} on a roll are your weakest (${pct(pos.rate)}).` : ''}`;
});

/* ---------- 5 · rhythm ---------- */
const HOURS = Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`));
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const busiestDay = computed(() => {
	const w = d.rhythm.weekdays;
	const i = w.indexOf(Math.max(...w));
	return d.rhythm.frames ? WEEK[i] : null;
});

/* ---------- 6 · kit ---------- */
const kitFinding = computed(() => {
	const cams = d.kit.cameras;
	if (!cams.length) return null;
	const most = cams[0];
	const idle = cams.filter((c) => c.idle != null).sort((a, b) => b.idle! - a.idle!)[0];
	const lossy = cams.filter((c) => c.lost != null && c.lost >= 4).sort((a, b) => b.lost! - a.lost!)[0];
	return `The ${most.name} does most of the work (${plural(most.rolls, 'roll')}).${idle && idle.idle! > 30 ? ` The ${idle.name} has sat empty ${idle.idle} days.` : ''}${lossy ? ` The ${lossy.name} loses about ${lossy.lost} frames a roll that never come back as scans.` : ''}`;
});

/* ---------- 7 · labs ---------- */
const labRows = computed(() => d.labs.map((l) => ({ key: l.id, label: l.name, values: l.days, median: l.turnaround ? Math.round(l.turnaround.median) : null, lo: l.turnaround ? Math.round(l.turnaround.lo) : null, hi: l.turnaround ? Math.round(l.turnaround.hi) : null, color: 'var(--lab-stage-lab)', note: l.ifToday ? `sent today: back ${l.ifToday.text}` : undefined })));
const labFinding = computed(() => {
	const timed = d.labs.filter((l) => l.turnaround && l.turnaround.n >= 2).sort((a, b) => a.turnaround!.median - b.turnaround!.median);
	if (!timed.length) return null;
	const f = timed[0];
	return `${f.name} is quickest: a median ${Math.round(f.turnaround!.median)} days (${plural(f.turnaround!.n, 'roll')}). Sent today, scans would be back ${f.ifToday?.text}.${timed.length > 1 ? ` ${timed.at(-1)!.name} takes ${Math.round(timed.at(-1)!.turnaround!.median)}.` : ''}`;
});

/* ---------- 8 · money ---------- */
const moneyCols = computed(() => {
	const m = d.money!;
	const months = m.months.slice(-14);
	return { labels: months.map((x) => monthLabel(x.month).slice(0, 3)), values: [months.map((x) => x.film / 100), months.map((x) => x.lab / 100)], mark: months.length - 1 };
});

/* ---------- 9 · shelf ---------- */
const shelfRange = computed(() => {
	const rows = d.shelf.rows;
	if (!rows.length) return null;
	const days = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
	const t0 = days(d.today);
	const end = Math.max(t0 + 120, ...rows.map((r) => days(r.expires)), ...rows.map((r) => (r.reach ? days(r.reach) : t0)));
	const x = (iso: string) => `${Math.round(((Math.max(t0, days(iso)) - t0) / (end - t0)) * 10000) / 100}%`;
	return { x, end };
});
const late = computed(() => d.shelf.rows.filter((r) => r.late && !r.expired));
</script>

<template>
	<div class="almanac">
		<!-- Findings first -->
		<section class="headlines" aria-labelledby="hl-h">
			<h2 id="hl-h" class="lab-edge-print">What stands out · {{ d.totals.rolls }} rolls · {{ d.totals.frames }} frames logged<template v-if="d.totals.scans"> · {{ d.totals.scans }} scans</template></h2>
			<ol v-if="d.headlines.length" class="notes">
				<li v-for="h in d.headlines" :key="h.chapter" :class="h.tone">
					<a :href="`#${h.chapter}`">{{ h.text }}</a>
				</li>
			</ol>
			<p v-else class="lab-empty">Nothing stands out yet. Each chapter below says what it needs.</p>
			<nav class="toc" aria-label="Chapters">
				<a v-for="([key, label], i) in CHAPTERS" :key="key" :href="`#${key}`"><b>{{ i + 1 }}</b> {{ label }}</a>
			</nav>
		</section>

		<!-- 1 · Life of a roll -->
		<section id="life" class="chapter" aria-labelledby="c-life">
			<header><span class="no">1</span><h2 id="c-life">The life of a roll</h2></header>
			<div class="figs">
				<Figure title="Where does film wait?" :finding="lifeFinding" :need="legRows.length ? null : 'Once a few rolls have gone from loading to filing on the bench, each stage’s wait shows here.'" :action="{ href: '/photography/lab/rolls/', label: 'See every roll on the line' }" has-table wide>
					<SpreadRows :rows="legRows" />
					<template #table>
						<table>
							<thead><tr><th>Stage</th><th class="num">Rolls</th><th class="num">Median</th><th class="num">Middle half</th></tr></thead>
							<tbody><tr v-for="r in legRows" :key="r.key"><td>{{ r.label }}</td><td class="num">{{ r.values.length }}</td><td class="num">{{ r.median }} d</td><td class="num">{{ r.lo }}–{{ r.hi }} d</td></tr></tbody>
						</table>
					</template>
				</Figure>
				<Figure
					title="Is anything piling up?"
					:finding="backlogPeak ? `At the busiest, ${plural(backlogPeak, 'roll')} sat between the camera and the binder at once.` : null"
					:need="backlogPeak ? null : 'Nothing has waited between shooting and filing yet.'"
					wide
				>
					<Columns
						:labels="backlog.labels"
						:values="backlog.values"
						:series="[
							{ key: 'shot', label: 'Waiting to send', color: 'var(--lab-stage-shot)' },
							{ key: 'lab', label: 'At a lab', color: 'var(--lab-stage-lab)' },
							{ key: 'scanned', label: 'Scans in, not filed', color: 'var(--lab-stage-scanned)' },
						]"
						:every="4"
						:height="120"
					/>
				</Figure>
			</div>
		</section>

		<!-- 2 · Exposure -->
		<section id="exposure" class="chapter" aria-labelledby="c-exposure">
			<header><span class="no">2</span><h2 id="c-exposure">Exposure</h2></header>
			<ul v-if="d.exposure.findings.length" class="findings">
				<li v-for="f in d.exposure.findings" :key="f.title" :class="f.tone">
					<b>{{ f.title }}</b>
					<p>{{ f.text }}</p>
				</li>
			</ul>
			<div class="figs">
				<Figure
					title="Which light gives you thin negatives?"
					:finding="d.exposure.points.length >= 6 ? `${pct(thinShare)} of the ${d.exposure.points.length} logged frames with scans came back thin.` : null"
					:need="d.exposure.points.length >= 6 ? null : `Log frames in shooting mode; once ${d.exposure.points.length ? 'a few more' : 'their'} scans line up, each lands here by its light and density.`"
					:action="{ href: '/photography/lab/frames/', label: 'Open the frames' }"
					wide
				>
					<Scatter :points="d.exposure.points" />
				</Figure>
				<Figure title="Cameras, on the same film" :finding="camLift.length ? 'Each camera’s scans against the same film shot in your other cameras: right of centre is thinner (flatter), left denser.' : null" :need="camLift.length ? null : 'Needs scans from the same film in more than one camera.'" has-table>
					<BarList :rows="camLift" :format="signed" :diverging="{ neg: 'denser', pos: 'thinner' }" unit="scans compared" />
					<template #table>
						<table>
							<thead><tr><th>Camera</th><th class="num">Black point vs same film</th><th class="num">Scans</th></tr></thead>
							<tbody><tr v-for="r in camLift" :key="r.key"><td>{{ r.label }}</td><td class="num">{{ signed(r.value) }}</td><td class="num">{{ r.n }}</td></tr></tbody>
						</table>
					</template>
				</Figure>
				<Figure title="Labs, on the same film" :finding="labLift.length ? 'Each lab’s scans against the same film developed elsewhere.' : null" :need="labLift.length ? null : 'Needs the same film developed at more than one lab.'">
					<BarList :rows="labLift" :format="signed" :diverging="{ neg: 'punchier', pos: 'flatter' }" unit="scans compared" />
				</Figure>
			</div>
		</section>

		<!-- 3 · Film for the light -->
		<section id="light" class="chapter" aria-labelledby="c-light">
			<header><span class="no">3</span><h2 id="c-light">Film for the light</h2></header>
			<div class="figs">
				<Figure
					title="Am I loading the right speed?"
					:finding="lightFinding"
					:need="fits.length ? null : 'Log aperture and shutter in shooting mode (on a camera you set by hand) and the light you shoot in shows here, film speed by film speed.'"
					:action="{ href: '/photography/lab/fridge/', label: 'See what’s in the fridge' }"
					wide
				>
					<div class="multiples">
						<div v-for="f in fits" :key="f.iso" class="multiple">
							<p class="m-head"><b>ISO {{ f.iso }}</b> · {{ f.n }} frames · {{ pct(f.under) }} too dim<template v-if="f.over"> · {{ pct(f.over) }} too bright</template></p>
							<Columns v-bind="fitColumns(f)" :series="[{ key: 'n', label: 'Frames', color: 'oklch(64% 0.13 62)' }]" :format="(v: number) => `${v} frames`" :height="90" :every="2" />
						</div>
					</div>
					<p class="axis-note">Scene light, EV at ISO 100: lower is darker. The green band is what that film can expose hand-held (f/2 at 1/30 to f/16 at 1/1000).</p>
				</Figure>
			</div>
		</section>

		<!-- 4 · Keepers -->
		<section id="keepers" class="chapter" aria-labelledby="c-keepers">
			<header><span class="no">4</span><h2 id="c-keepers">Keepers</h2></header>
			<div v-if="d.keepers.overall" class="tiles">
				<div class="tile"><b>{{ pct(d.keepers.overall.rate) }}</b><span>of scans rated four stars or more</span></div>
				<div class="tile"><b>{{ d.keepers.overall.k }}</b><span>keepers from {{ d.keepers.overall.n }} scans</span></div>
				<div class="tile"><b>{{ d.keepers.costPerKeeper != null ? money(d.keepers.costPerKeeper) : '—' }}</b><span>{{ d.keepers.costPerKeeper != null ? 'per keeper, film and lab' : 'per keeper, once rolls have prices' }}</span></div>
			</div>
			<div class="figs">
				<Figure title="What gives me keepers?" :finding="keeperFinding" :need="d.keepers.camera.length ? null : 'Keepers come from the star ratings on your scans (set when they’re uploaded). Rate a few rolls and this compares cameras, films and labs.'" has-table>
					<BarList :rows="rateRows(d.keepers.camera)" :format="pct" :reference="d.keepers.overall ? { value: d.keepers.overall.rate, label: `all scans, ${pct(d.keepers.overall.rate)}` } : null" :max="1" unit="scans" />
					<template #table>
						<table>
							<thead><tr><th>Camera</th><th class="num">Keepers</th><th class="num">Scans</th><th class="num">Rate</th><th class="num">Likely</th></tr></thead>
							<tbody><tr v-for="r in d.keepers.camera" :key="r.key"><td>{{ r.label }}</td><td class="num">{{ r.k }}</td><td class="num">{{ r.n }}</td><td class="num">{{ pct(r.rate) }}</td><td class="num">{{ pct(r.lo) }}–{{ pct(r.hi) }}</td></tr></tbody>
						</table>
					</template>
				</Figure>
				<Figure title="…by film" :need="d.keepers.stock.length ? null : 'Needs a dozen rated scans of a film.'">
					<BarList :rows="rateRows(d.keepers.stock)" :format="pct" :reference="d.keepers.overall ? { value: d.keepers.overall.rate, label: 'all scans' } : null" :max="1" unit="scans" />
				</Figure>
				<Figure title="…by where it falls on the roll" :finding="d.keepers.position.length ? 'The first frames on a roll are often throwaways; the last can be rushed.' : null" :need="d.keepers.position.length ? null : 'Needs rated scans.'">
					<BarList :rows="rateRows(d.keepers.position)" :format="pct" :reference="d.keepers.overall ? { value: d.keepers.overall.rate, label: 'all scans' } : null" :max="1" unit="scans" />
				</Figure>
				<Figure title="…by lab" :need="d.keepers.lab.length ? null : 'Needs rated scans from a lab.'">
					<BarList :rows="rateRows(d.keepers.lab)" :format="pct" :reference="d.keepers.overall ? { value: d.keepers.overall.rate, label: 'all scans' } : null" :max="1" unit="scans" />
				</Figure>
			</div>
		</section>

		<!-- 5 · Rhythm -->
		<section id="rhythm" class="chapter" aria-labelledby="c-rhythm">
			<header><span class="no">5</span><h2 id="c-rhythm">Rhythm</h2></header>
			<div class="figs">
				<Figure title="When do I shoot?" :finding="d.rhythm.peak ? `Most of your frames are taken ${d.rhythm.peak}${busiestDay ? `, most often on a ${busiestDay}` : ''}.` : null" :need="d.rhythm.frames >= 12 ? null : 'Frames logged in shooting mode carry the time; a dozen or so and your hours show here.'" wide>
					<Columns :labels="HOURS" :values="[d.rhythm.hours]" :series="[{ key: 'h', label: 'Frames', color: 'oklch(64% 0.13 62)' }]" :format="(v: number) => `${v} frames`" :every="3" :height="110" :band="{ from: 6, to: 18, label: 'daylight, roughly' }" />
				</Figure>
				<Figure title="…by day of the week" :need="d.rhythm.frames >= 12 ? null : 'Needs logged frames.'">
					<Columns :labels="WEEK" :values="[d.rhythm.weekdays]" :series="[{ key: 'w', label: 'Frames', color: 'oklch(64% 0.13 62)' }]" :format="(v: number) => `${v} frames`" :height="100" />
				</Figure>
				<Figure title="What do I load?" :finding="d.rhythm.films.length ? `${d.rhythm.films[0].label} most of all: ${plural(d.rhythm.films[0].n, 'roll')} of ${d.rhythm.films.reduce((t, f) => t + f.n, 0)}.` : null" :need="d.rhythm.films.length ? null : 'Films show here once you’ve loaded a roll.'">
					<BarList :rows="d.rhythm.films.slice(0, 10).map((f) => ({ key: f.key, label: f.label, value: f.n }))" :format="(v: number) => String(v)" />
				</Figure>
				<Figure title="Rolls, month by month" :need="d.rhythm.months.length ? null : 'Rolls show here by the month you finished them.'">
					<Columns :labels="d.rhythm.months.map((m) => monthLabel(m.month))" :values="[d.rhythm.months.map((m) => m.n)]" :series="[{ key: 'm', label: 'Rolls', color: 'oklch(64% 0.13 62)' }]" :format="(v: number) => plural(v, 'roll')" :height="100" :mark="d.rhythm.months.length - 1" />
				</Figure>
			</div>
		</section>

		<!-- 6 · Kit -->
		<section id="kit" class="chapter" aria-labelledby="c-kit">
			<header><span class="no">6</span><h2 id="c-kit">Kit</h2></header>
			<div class="figs">
				<Figure title="Is each camera earning its keep?" :finding="kitFinding" :need="d.kit.cameras.length ? null : 'Cameras show here once they’ve shot a roll.'" :action="{ href: '/photography/lab/gear/', label: 'Open the kit' }" wide>
					<div class="table kit">
						<table>
							<thead>
								<tr><th>Camera</th><th class="num">Rolls</th><th class="num">Frames back</th><th class="num">Lost a roll</th><th class="num">Empty for</th><th class="num">A roll costs</th><th class="num">Density</th></tr>
							</thead>
							<tbody>
								<tr v-for="c in d.kit.cameras" :key="c.id">
									<th scope="row">{{ c.name }}<span v-if="c.loaded" class="live" title="Loaded now">●</span></th>
									<td class="num"><span class="spark" :style="{ '--v': c.rolls / d.kit.cameras[0].rolls }"></span>{{ c.rolls }}</td>
									<td class="num">{{ c.frames }}</td>
									<td class="num" :class="{ warn: (c.lost ?? 0) >= 4 }">{{ c.lost ?? '—' }}</td>
									<td class="num" :class="{ warn: (c.idle ?? 0) > 60 }">{{ c.loaded ? 'loaded' : c.idle != null ? `${c.idle} d` : '—' }}</td>
									<td class="num">{{ c.costPerRoll != null ? money(c.costPerRoll) : '—' }}</td>
									<td class="num" :title="c.lift != null ? `On the same film, against your other cameras (${c.liftN} scans)` : undefined">{{ c.lift != null ? `${signed(c.lift)}${c.lift >= 3 ? ' thin' : c.lift <= -2 ? ' dense' : ''}` : '—' }}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</Figure>
				<Figure v-for="l in d.kit.lenses" :key="l.id" :title="`${l.name}: the apertures you use`" :finding="`Over ${l.n} logged frames, most at ${formatAperture([...l.stops].sort((a, b) => b.n - a.n)[0].f)}.`">
					<Columns :labels="l.stops.map((s) => formatAperture(s.f)!)" :values="[l.stops.map((s) => s.n)]" :series="[{ key: 'a', label: 'Frames', color: 'oklch(64% 0.13 62)' }]" :format="(v: number) => `${v} frames`" :height="90" />
				</Figure>
			</div>
		</section>

		<!-- 7 · Labs -->
		<section id="labs" class="chapter" aria-labelledby="c-labs">
			<header><span class="no">7</span><h2 id="c-labs">Labs</h2></header>
			<div class="figs">
				<Figure title="Which lab, and when will scans arrive?" :finding="labFinding" :need="labRows.length ? null : 'Each lab’s turnaround appears once a roll goes from “sent” to “scans in” on the bench.'" :action="{ href: '/photography/lab/labs/', label: 'Open the post' }" has-table wide>
					<SpreadRows :rows="labRows" />
					<template #table>
						<table>
							<thead><tr><th>Lab</th><th class="num">Rolls timed</th><th class="num">Median</th><th class="num">Sent today, back</th><th class="num">A roll</th><th class="num">Scans vs same film</th></tr></thead>
							<tbody>
								<tr v-for="l in d.labs" :key="l.id">
									<td>{{ l.name }}</td>
									<td class="num">{{ l.days.length }}</td>
									<td class="num">{{ l.turnaround ? `${Math.round(l.turnaround.median)} d` : '—' }}</td>
									<td class="num">{{ l.ifToday?.text ?? '—' }}</td>
									<td class="num">{{ l.costCents != null ? money(l.costCents) : '—' }}</td>
									<td class="num">{{ l.lift != null ? signed(l.lift) : '—' }}</td>
								</tr>
							</tbody>
						</table>
					</template>
				</Figure>
			</div>
		</section>

		<!-- 8 · Money -->
		<section id="money" class="chapter" aria-labelledby="c-money">
			<header><span class="no">8</span><h2 id="c-money">Money</h2></header>
			<template v-if="d.money">
				<div class="tiles">
					<div class="tile"><b>{{ money(d.money.thisYear) }}</b><span>this year, film and lab</span></div>
					<div class="tile"><b>{{ d.money.projection != null ? money(d.money.projection) : '—' }}</b><span>by December, at this pace</span></div>
					<div class="tile"><b>{{ d.money.perMonth != null ? money(d.money.perMonth) : '—' }}</b><span>a month, lately</span></div>
					<div class="tile"><b>{{ money(d.money.total) }}</b><span>all told</span></div>
				</div>
				<div class="figs">
					<Figure title="What does it cost, month by month?" :finding="`Film counts the month you bought it, the lab the month you sent it.`" wide>
						<Columns
							v-bind="moneyCols"
							:series="[
								{ key: 'film', label: 'Film', color: 'var(--lab-stage-storage)' },
								{ key: 'lab', label: 'Lab', color: 'var(--lab-stage-lab)' },
							]"
							:format="(v: number) => money(v * 100)"
							:height="130"
						/>
					</Figure>
					<Figure title="What a frame costs, by film" :need="d.money.perFrame.length ? null : 'Needs rolls with both a price and a lab cost.'">
						<BarList :rows="d.money.perFrame.map((p) => ({ key: p.key, label: p.label, value: p.cents, n: p.rolls }))" :format="(v: number) => money(v)" unit="rolls" />
					</Figure>
				</div>
			</template>
			<p v-else class="lab-empty">Add what film and developing cost (on a roll’s page, or when you send it) and the spending shows here.</p>
		</section>

		<!-- 9 · Shelf life -->
		<section id="shelf" class="chapter" aria-labelledby="c-shelf">
			<header><span class="no">9</span><h2 id="c-shelf">Shelf life</h2></header>
			<div class="figs">
				<Figure
					title="Will I use the fridge in time?"
					:finding="d.shelf.rows.length ? `${d.shelf.monthsOfFilm != null ? `About ${formatMonths(d.shelf.monthsOfFilm)} of film at ${d.shelf.perMonth} rolls a month.` : ''} ${late.length ? `${plural(late.length, 'roll')} will pass ${late.length === 1 ? 'its' : 'their'} date before you reach ${late.length === 1 ? 'it' : 'them'}.` : 'Everything should be shot before its date.'}` : null"
					:tone="late.length ? 'warn' : null"
					:need="d.shelf.rows.length ? null : 'Rolls in the fridge with an expiry date show here.'"
					:action="{ href: '/photography/lab/fridge/', label: 'Open the fridge' }"
					wide
				>
					<ul v-if="shelfRange" class="shelf" role="list">
						<li v-for="r in d.shelf.rows" :key="r.id" :class="{ late: r.late, expired: r.expired }">
							<a class="lab-code" :href="`/photography/lab/rolls/${r.code}/`">{{ r.code }}</a>
							<span class="s-name">{{ r.stock }}</span>
							<span class="s-track" role="img" :aria-label="`${r.code}: expires ${formatDay(r.expires)}${r.reach ? `, you'd reach it around ${formatDay(r.reach)}` : ''}`">
								<span v-if="r.reach" class="s-wait" :style="{ width: shelfRange.x(r.reach) }"></span>
								<span class="s-exp" :style="{ left: shelfRange.x(r.expires) }" :title="`Expires ${formatDay(r.expires)}`"></span>
								<span v-if="r.reach" class="s-reach" :style="{ left: shelfRange.x(r.reach) }" :title="`You’d reach it around ${formatDay(r.reach)}`"></span>
							</span>
							<span class="s-when">{{ r.expired ? 'expired' : r.late ? `${formatDay(r.expires, false)} · too late` : formatDay(r.expires, false) }}</span>
						</li>
					</ul>
					<template #legend>
						<span class="s-key"><i class="k-reach"></i>when you’d reach it <i class="k-exp"></i>its date</span>
					</template>
				</Figure>
			</div>
		</section>
	</div>
</template>

<style scoped>
.almanac {
	display: grid;
	gap: clamp(2.5rem, 6vw, 4rem);
	min-width: 0;
}

/* ---------- findings first ---------- */
.headlines {
	display: grid;
	gap: 1rem;
}

.notes {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
	gap: 1rem;
	margin: 0;
	padding: 0;
	list-style: none;
	counter-reset: n;
}

/* Each finding on its own index card, pinned. */
.notes li {
	position: relative;
	counter-increment: n;
	padding: 1rem 1.1rem 1rem 3rem;
	border-radius: 2px;
	background: var(--lab-card);
	box-shadow: var(--lab-lift-1);
	rotate: calc((var(--r, 0) * 1deg));
}

.notes li:nth-child(odd) {
	--r: -0.5;
}

.notes li:nth-child(even) {
	--r: 0.6;
}

.notes li::before {
	content: counter(n);
	position: absolute;
	left: 1rem;
	top: 1rem;
	display: grid;
	place-items: center;
	width: 1.4rem;
	height: 1.4rem;
	border: 1.5px solid currentColor;
	border-radius: 50%;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--lab-note);
}

.notes li.warn::before {
	color: var(--lab-warn);
}

.notes li.good::before {
	color: var(--lab-ok);
}

.notes a {
	color: var(--gray-0);
	text-decoration: none;
	line-height: 1.45;
	text-wrap: pretty;
}

.notes a:hover {
	text-decoration: underline;
}

.toc {
	display: flex;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.toc a {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-height: 2.2rem;
	padding: 0.2rem 0.8rem 0.2rem 0.35rem;
	border: 1px solid var(--gray-800);
	border-radius: 999px;
	color: var(--gray-200);
	font-size: var(--text-sm);
	text-decoration: none;
}

.toc a:hover {
	color: var(--gray-0);
	border-color: var(--gray-600);
}

.toc b {
	display: grid;
	place-items: center;
	width: 1.45rem;
	height: 1.45rem;
	border-radius: 50%;
	background: var(--gray-900);
	font-family: var(--font-mono);
	font-size: 0.66rem;
	font-weight: 500;
}

/* ---------- chapters ---------- */
.chapter {
	display: grid;
	gap: 1.1rem;
	scroll-margin-top: 1.5rem;
}

.chapter > header {
	display: flex;
	align-items: baseline;
	gap: 0.8rem;
	padding-bottom: 0.6rem;
	border-bottom: 1px solid var(--gray-800);
}

.chapter h2 {
	font-family: var(--font-brand);
	font-style: italic;
	font-weight: 400;
	font-variation-settings: 'opsz' 144, 'SOFT' 60, 'WONK' 1;
	font-size: var(--text-3xl);
	line-height: 1;
}

.no {
	font-family: var(--font-mono);
	font-size: 0.8rem;
	color: var(--lab-edge-text);
}

.figs {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1.1rem;
}

.figs > :deep(.fig.wide) {
	grid-column: 1 / -1;
}

@media (max-width: 56em) {
	.figs {
		grid-template-columns: minmax(0, 1fr);
	}
}

.findings {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
	gap: 0.8rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

/* Taped index cards with a highlighter stroke on the headline. */
.findings li {
	display: grid;
	gap: 0.35rem;
	padding: 0.9rem 1rem;
	border-radius: 2px;
	background: var(--lab-card);
	box-shadow: var(--lab-lift-0);
}

.findings b {
	justify-self: start;
	font-weight: 600;
	background: linear-gradient(transparent 55%, color-mix(in oklch, var(--lab-stage-shot) 45%, transparent) 55% 92%, transparent 92%);
}

.findings li.warn b {
	background: linear-gradient(transparent 55%, color-mix(in oklch, var(--lab-stage-camera) 32%, transparent) 55% 92%, transparent 92%);
}

.findings li.good b {
	background: linear-gradient(transparent 55%, color-mix(in oklch, var(--lab-stage-scanned) 40%, transparent) 55% 92%, transparent 92%);
}

.findings p {
	font-size: var(--text-sm);
	line-height: 1.5;
	color: var(--gray-200);
}

.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
	gap: 0.8rem;
}

.tile {
	display: grid;
	gap: 0.15rem;
	padding: 0.85rem 1rem;
	border-radius: 0.7rem;
	background: var(--lab-card);
	box-shadow: 0 0 0 1px var(--gray-800);
}

.tile b {
	font-family: var(--font-brand);
	font-size: var(--text-2xl);
	font-weight: 500;
	font-variant-numeric: tabular-nums;
}

.tile span {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.multiples {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
	gap: 1.2rem 1.5rem;
}

.m-head {
	margin-bottom: 0.3rem;
	font-size: var(--text-sm);
	color: var(--gray-200);
}

.axis-note {
	font-size: 0.78rem;
	color: var(--gray-300);
}

/* ---------- the kit sheet ---------- */
.table.kit {
	overflow-x: auto;
}

.kit table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--text-sm);
}

.kit th,
.kit td {
	padding: 0.45rem 0.55rem;
	border-bottom: 1px solid var(--gray-800);
	text-align: left;
	white-space: nowrap;
}

.kit thead th {
	font-family: var(--font-mono);
	font-size: 0.64rem;
	font-weight: 500;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--lab-edge-text);
}

.kit .num {
	text-align: right;
	font-family: var(--font-mono);
	font-size: 0.8rem;
	font-variant-numeric: tabular-nums;
}

.kit .warn {
	color: var(--lab-warn);
}

.live {
	margin-left: 0.35rem;
	color: var(--lab-stage-camera);
	font-size: 0.6rem;
	vertical-align: 2px;
}

.spark {
	display: inline-block;
	width: calc(var(--v) * 3rem);
	height: 0.4rem;
	margin-right: 0.45rem;
	border-radius: 0 3px 3px 0;
	background: oklch(64% 0.13 62);
	vertical-align: 1px;
}

/* ---------- shelf life ---------- */
.shelf {
	display: grid;
	gap: 0.2rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.shelf li {
	display: grid;
	grid-template-columns: 3.6rem minmax(6rem, 11rem) minmax(0, 1fr) 7.5rem;
	align-items: center;
	gap: 0.7rem;
	min-height: 1.9rem;
}

.s-name {
	font-size: var(--text-sm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.s-track {
	position: relative;
	height: 1.1rem;
	border-bottom: 1px solid var(--gray-800);
}

.s-wait {
	position: absolute;
	left: 0;
	top: 50%;
	border-top: 2px dotted var(--gray-400);
}

.s-exp {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 3px;
	translate: -50% 0;
	border-radius: 2px;
	background: var(--gray-0);
}

.s-reach {
	position: absolute;
	top: 50%;
	width: 10px;
	height: 10px;
	translate: -50% -50%;
	border-radius: 50%;
	background: var(--lab-stage-storage);
	box-shadow: 0 0 0 2px var(--lab-card);
}

.late .s-reach {
	background: var(--lab-warn);
}

.s-when {
	font-family: var(--font-mono);
	font-size: 0.72rem;
	text-align: right;
	color: var(--gray-300);
}

.late .s-when,
.expired .s-when {
	color: var(--lab-warn);
}

.s-key {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.72rem;
	color: var(--gray-300);
}

.k-reach {
	width: 9px;
	height: 9px;
	border-radius: 50%;
	background: var(--lab-stage-storage);
}

.k-exp {
	width: 3px;
	height: 0.8rem;
	margin-left: 0.6rem;
	background: var(--gray-0);
}

@media (max-width: 40em) {
	.shelf li {
		grid-template-columns: 3.4rem minmax(0, 1fr) 5.5rem;
	}

	.s-name {
		display: none;
	}
}
</style>
