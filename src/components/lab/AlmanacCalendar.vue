<template>
	<div class="cal" role="group" aria-label="Rolls by month">
		<div class="cols">
			<div v-for="(col, ci) in columns" :key="col.month" class="col" :class="{ now: col.month === thisMonth, picked: active?.kind === 'month' && active.value === col.month }">
				<div class="stack">
					<a
						v-for="(c, i) in col.cells"
						:key="c.id"
						class="cell"
						:class="{ live: c.status === 'camera', lost: c.status === 'lost', dim: dimmed(c) }"
						:href="`/photography/lab/rolls/${c.code}/`"
						:style="{ '--c': c.color, '--i': Math.min(ci * 3 + i, 60) }"
						:aria-label="`${c.code}, ${c.title}`"
						@mouseenter="emit('hover', describe(c))"
						@focus="emit('hover', describe(c))"
						@mouseleave="emit('hover', null)"
						@blur="emit('hover', null)"
					></a>
				</div>
				<button
					type="button"
					class="month"
					:aria-pressed="active?.kind === 'month' && active.value === col.month"
					:aria-label="`${monthLabel(col.month, true)}: ${col.cells.length} ${col.cells.length === 1 ? 'roll' : 'rolls'}`"
					@click="emit('filter', { kind: 'month', value: col.month, label: monthLabel(col.month, true) })"
					@mouseenter="emit('hover', `${monthLabel(col.month, true)} · ${col.cells.length} ${col.cells.length === 1 ? 'roll' : 'rolls'}`)"
					@mouseleave="emit('hover', null)"
				>
					<span class="n">{{ col.cells.length || '' }}</span>
					<span class="m">{{ monthLabel(col.month).slice(0, 1) }}<span class="rest">{{ monthLabel(col.month).slice(1) }}</span></span>
					<span v-if="col.month.endsWith('-01') || ci === 0" class="y">{{ col.month.slice(0, 4) }}</span>
				</button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { monthLabel, monthsBetween, rollMonth, type Facet, type Milestones } from '../../lib/lab/almanac';
import { STATUS_LABEL, type RollView } from '../../lib/lab/inventory';
import { canisterColors } from '../film/canister';

const props = defineProps<{ rolls: RollView[]; milestones: Milestones; today: string; active: Facet | null }>();
const emit = defineEmits<{ filter: [facet: Facet]; hover: [text: string | null] }>();

const thisMonth = props.today.slice(0, 7);

interface Cell {
	id: string;
	code: string;
	title: string;
	status: RollView['status'];
	stockId: string;
	color: string;
	month: string;
}

const cells = computed<Cell[]>(() =>
	props.rolls
		.map((r) => {
			const month = rollMonth(r, props.milestones);
			if (!month) return null;
			return {
				id: r.id,
				code: r.code,
				title: r.title || r.stock.name,
				status: r.status,
				stockId: r.stock.id,
				color: canisterColors({ stock: r.stock.token ?? r.stock.id, stockLabel: r.stock.name, stockBrand: r.stock.brand }).can,
				month,
			};
		})
		.filter((c): c is Cell => !!c)
);

/** At least the last twelve months, back to the first roll. */
const columns = computed(() => {
	const [y, m] = thisMonth.split('-').map(Number);
	const yearAgo = `${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
	const first = cells.value.reduce((min, c) => (c.month < min ? c.month : min), yearAgo);
	return monthsBetween(first, thisMonth).map((month) => ({
		month,
		cells: cells.value.filter((c) => c.month === month).sort((a, b) => a.code.localeCompare(b.code)),
	}));
});

const describe = (c: Cell) => `${c.code} · ${c.title} · ${STATUS_LABEL[c.status].toLowerCase()}`;

/** With a stock (or other) filter on, the rolls outside it fade back. */
function dimmed(c: Cell) {
	const f = props.active;
	if (!f || f.kind === 'month') return false;
	const r = props.rolls.find((x) => x.id === c.id);
	if (!r) return false;
	if (f.kind === 'stock') return r.stock.id !== f.value;
	if (f.kind === 'camera') return r.camera?.id !== f.value;
	if (f.kind === 'lab') return r.lab?.id !== f.value;
	return false;
}
</script>

<style scoped>
.cal {
	overflow-x: auto;
	padding-bottom: 0.25rem;
	scrollbar-width: thin;
}

.cols {
	display: flex;
	align-items: flex-end;
	gap: 0.35rem;
	min-width: max-content;
	min-height: 9.5rem;
}

.col {
	display: grid;
	justify-items: center;
	gap: 0.4rem;
	width: 1.9rem;
}

/* Frames stack from the bottom up, like a bar of negatives. */
.stack {
	display: flex;
	flex-direction: column-reverse;
	gap: 3px;
	padding: 3px;
	border-radius: 2px;
	background: var(--lab-film);
	min-height: 0.5rem;
}

.stack:empty {
	width: 1.35rem;
	min-height: 0;
	height: 2px;
	padding: 0;
	background: var(--gray-800);
}

.col.now .stack {
	box-shadow: 0 0 0 1px var(--lab-edge-ink);
}

.cell {
	display: block;
	width: 1.35rem;
	height: 0.95rem;
	border-radius: 1.5px;
	background: var(--c);
	box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
	transition:
		transform 0.15s ease,
		opacity 0.2s ease;
}

.cell:hover,
.cell:focus-visible {
	transform: scale(1.18);
	outline: none;
	box-shadow:
		inset 0 0 0 1px rgb(255 255 255 / 0.5),
		0 0 0 2px var(--lab-lit);
}

/* Still in a camera: a frame not yet developed. */
.cell.live {
	background: transparent;
	box-shadow: inset 0 0 0 1.5px var(--c);
}

.cell.lost {
	opacity: 0.35;
	background: repeating-linear-gradient(45deg, var(--c) 0 3px, transparent 3px 6px);
}

.cell.dim {
	opacity: 0.18;
}

.month {
	display: grid;
	justify-items: center;
	gap: 0.05rem;
	min-width: 2rem;
	padding: 0.15rem 0;
	border: 0;
	border-radius: 0.3rem;
	background: none;
	color: var(--gray-300);
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
}

.month:hover,
.month[aria-pressed='true'] {
	background: var(--gray-900);
	color: var(--gray-0);
}

.month:focus-visible {
	outline: 2px solid var(--accent-regular);
}

.n {
	color: var(--gray-0);
	font-size: 0.68rem;
	min-height: 0.9em;
}

.rest {
	display: none;
}

.y {
	color: var(--lab-edge-text);
}

@media (min-width: 60em) {
	.col {
		width: 2.3rem;
	}

	.rest {
		display: inline;
		text-transform: lowercase;
	}
}

@media (prefers-reduced-motion: no-preference) {
	.cell {
		animation: develop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(var(--i) * 14ms + 0.2s);
	}

	/* An image coming up in the developer: from nothing, through a warm cast, to its color. */
	@keyframes develop {
		from {
			opacity: 0.001;
			filter: sepia(1) brightness(1.6);
			scale: 0.6;
		}
	}

	.cell.live {
		animation:
			develop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both,
			live 2.4s ease-in-out 1s infinite;
	}

	@keyframes live {
		50% {
			box-shadow: inset 0 0 0 1.5px var(--c), 0 0 8px 0 var(--c);
		}
	}
}
</style>
