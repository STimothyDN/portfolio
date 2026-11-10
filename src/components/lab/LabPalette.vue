<script setup lang="ts">
/**
 * ⌘K (or Ctrl+K, or "/"): jump to any place or roll, or start a roll's next
 * move ("Send R-031") on the bench. A modal <dialog> holding the combobox
 * pattern: the input owns the listbox and points at the active option.
 * The roll list is fetched the first time it opens (one small read).
 */
import { actions } from 'astro:actions';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { nextStage, STATUS_LABEL, STEP_VERB, type RollStatus } from '../../lib/lab/inventory';

interface Item {
	id: string;
	title: string;
	sub?: string;
	href: string;
	group: 'Places' | 'Rolls' | 'Moves';
	keys: string;
}

const PLACES: Item[] = [
	['Bench', 'Everything in motion', '/photography/lab/', 'home table light'],
	['Fridge', 'Unshot film', '/photography/lab/fridge/', 'storage stock film'],
	['Kit', 'Cameras and lenses', '/photography/lab/gear/', 'gear camera lens battery'],
	['Post', 'Labs and envelopes', '/photography/lab/labs/', 'lab send mail develop'],
	['Binder', 'Every roll, filed', '/photography/lab/rolls/', 'rolls negatives archive line'],
	['Frames', 'Every frame you logged', '/photography/lab/frames/', 'frames search map field'],
	['Almanac', 'What your film says', '/photography/lab/almanac/', 'insight charts stats money'],
	['Shoot', 'Log frames on the phone', '/photography/lab/shoot/', 'shoot log meter'],
	['Labels', 'Print canister stickers', '/photography/lab/labels/', 'qr print sticker'],
	['Account', 'Passkeys and invites', '/photography/lab/account/', 'passkey invite sign out'],
].map(([title, sub, href, keys]) => ({ id: `p-${href}`, title, sub, href, group: 'Places', keys: `${title} ${sub} ${keys}`.toLowerCase() }));

/** A guest gets places and rolls, no moves (and not the pages that need an account). */
const props = defineProps<{ guest?: boolean }>();
const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const q = ref('');
const active = ref(0);
const rolls = ref<{ code: string; title: string | null; status: string; stock: string; camera: string | null }[] | null>(null);
const loading = ref(false);

const items = computed<Item[]>(() => {
	const list: Item[] = props.guest ? PLACES.filter((p) => !/shoot|labels|account/.test(p.href)) : [...PLACES];
	for (const r of rolls.value ?? []) {
		const label = r.title ?? r.stock;
		const keys = `${r.code} ${r.code.replace('-', '')} ${label} ${r.stock} ${r.camera ?? ''} ${STATUS_LABEL[r.status as RollStatus] ?? ''}`.toLowerCase();
		list.push({ id: `r-${r.code}`, title: `${r.code} · ${label}`, sub: [STATUS_LABEL[r.status as RollStatus], r.camera].filter(Boolean).join(' · '), href: `/photography/lab/rolls/${r.code}/`, group: 'Rolls', keys });
		const next = nextStage(r.status as RollStatus);
		if (next && !props.guest) list.push({ id: `m-${r.code}`, title: `${STEP_VERB[next]}: ${r.code}`, sub: label, href: `/photography/lab/?move=${r.code}`, group: 'Moves', keys: `${STEP_VERB[next]} ${keys}`.toLowerCase() });
	}
	return list;
});

const results = computed(() => {
	const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
	const hits = words.length ? items.value.filter((it) => words.every((w) => it.keys.includes(w))) : items.value.filter((it) => it.group !== 'Moves');
	const order = { Moves: words.length ? 0 : 2, Places: 1, Rolls: 2 } as const;
	return hits.sort((a, b) => order[a.group] - order[b.group]).slice(0, 40);
});
const groups = computed(() => {
	const out: { label: string; items: (Item & { i: number })[] }[] = [];
	results.value.forEach((it, i) => {
		const g = out.find((x) => x.label === it.group) ?? out[out.push({ label: it.group, items: [] }) - 1];
		g.items.push({ ...it, i });
	});
	return out;
});
watch(q, () => (active.value = 0));

async function open() {
	if (!dialog.value || dialog.value.open) return;
	q.value = '';
	dialog.value.showModal();
	await nextTick();
	input.value?.focus();
	if (!rolls.value && !loading.value) {
		loading.value = true;
		try {
			const { data } = await actions.lab.paletteIndex();
			rolls.value = data?.rolls ?? [];
		} catch {
			rolls.value = [];
		} finally {
			loading.value = false;
		}
	}
}
const close = () => dialog.value?.close();
function go(it: Item | undefined) {
	if (!it) return;
	close();
	location.href = it.href;
}
function onKeydown(e: KeyboardEvent) {
	if (e.key === 'ArrowDown') {
		e.preventDefault();
		active.value = Math.min(results.value.length - 1, active.value + 1);
	} else if (e.key === 'ArrowUp') {
		e.preventDefault();
		active.value = Math.max(0, active.value - 1);
	} else if (e.key === 'Enter') {
		e.preventDefault();
		go(results.value[active.value]);
	}
}
watch(active, (i) => void nextTick(() => dialog.value?.querySelector(`#lab-pal-${i}`)?.scrollIntoView({ block: 'nearest' })));

function onGlobalKey(e: KeyboardEvent) {
	const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
	if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
		e.preventDefault();
		void open();
	}
}
const onOpenEvent = () => void open();
onMounted(() => {
	addEventListener('keydown', onGlobalKey);
	addEventListener('lab:palette', onOpenEvent);
});
onBeforeUnmount(() => {
	removeEventListener('keydown', onGlobalKey);
	removeEventListener('lab:palette', onOpenEvent);
});
</script>

<template>
	<dialog ref="dialog" class="lab-palette" aria-label="Find in Film Lab" @click.self="close">
		<div class="box">
			<label class="field">
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
				<span class="sr-only">Find a place, a roll or a move</span>
				<input
					id="lab-palette-q"
					ref="input"
					v-model="q"
					type="search"
					role="combobox"
					aria-controls="lab-palette-list"
					aria-expanded="true"
					:aria-activedescendant="results.length ? `lab-pal-${active}` : undefined"
					autocomplete="off"
					placeholder="R-031, portra, send, fridge…"
					enterkeyhint="go"
					@keydown="onKeydown"
				/>
				<kbd>esc</kbd>
			</label>
			<div id="lab-palette-list" class="list" role="listbox" aria-label="Results">
				<template v-for="g in groups" :key="g.label">
					<p class="group" role="presentation">{{ g.label }}</p>
					<a
						v-for="it in g.items"
						:id="`lab-pal-${it.i}`"
						:key="it.id"
						:href="it.href"
						role="option"
						:aria-selected="it.i === active"
						class="opt"
						tabindex="-1"
						@mousemove="active = it.i"
						@click.prevent="go(it)"
					>
						<b>{{ it.title }}</b>
						<small v-if="it.sub">{{ it.sub }}</small>
					</a>
				</template>
				<p v-if="!results.length" class="none">{{ loading ? 'Reading the logbook…' : 'Nothing by that name.' }}</p>
			</div>
		</div>
	</dialog>
</template>

<style scoped>
.lab-palette {
	width: min(36rem, calc(100vw - 2rem));
	max-height: min(32rem, calc(100dvh - 4rem));
	margin: 12vh auto auto;
	padding: 0;
	border: 0;
	border-radius: 0.9rem;
	background: var(--lab-card, var(--gray-999));
	color: var(--gray-0);
	box-shadow:
		0 0 0 1px var(--gray-800),
		0 30px 70px -20px rgb(0 0 0 / 0.5);
	overflow: hidden;
}

.lab-palette::backdrop {
	background: oklch(15% 0.01 50 / 0.45);
	backdrop-filter: blur(2px);
}

.box {
	display: grid;
	grid-template-rows: auto minmax(0, 1fr);
	max-height: inherit;
}

.field {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.8rem 1rem;
	border-bottom: 1px solid var(--gray-800);
}

.field svg {
	width: 1.2rem;
	height: 1.2rem;
	fill: none;
	stroke: var(--gray-300);
	stroke-width: 1.6;
	stroke-linecap: round;
}

input {
	flex: 1;
	min-width: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	font-size: 1.05rem;
	outline: none;
}

kbd {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	padding: 0.1rem 0.4rem;
	border: 1px solid var(--gray-700);
	border-radius: 0.3rem;
	color: var(--gray-300);
}

.list {
	overflow: auto;
	padding: 0.4rem;
}

.group {
	padding: 0.6rem 0.6rem 0.25rem;
	font-family: var(--font-mono);
	font-size: 0.66rem;
	letter-spacing: 0.12em;
	font-variant-caps: all-small-caps;
	font-size: 0.8rem;
	color: var(--lab-edge-text);
}

.opt {
	display: grid;
	gap: 0.05rem;
	padding: 0.5rem 0.7rem;
	border-radius: 0.45rem;
	color: inherit;
	text-decoration: none;
}

.opt[aria-selected='true'] {
	background: var(--gray-900);
}

.opt b {
	font-weight: 500;
}

.opt small {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.none {
	padding: 1rem;
	color: var(--gray-300);
}
</style>
