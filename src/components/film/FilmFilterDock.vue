<template>
	<div ref="dockRef" class="dock" role="group" aria-label="Film controls" @keydown.esc="closeAndRefocus">
		<!-- The Digital ⇄ Film switch, passed in from the page. -->
		<template v-if="$slots.default">
			<slot />
			<span class="dock-rule" aria-hidden="true"></span>
		</template>

		<!-- Wide screens: one list per facet. -->
		<div v-for="facet in facets" :key="facet.key" class="facet facet--single">
			<button
				:ref="(el) => setTrigger(facet.key, el)"
				type="button"
				class="dock-btn"
				:class="{ 'is-active': activeCount(facet.key) > 0 }"
				:aria-expanded="open === facet.key"
				:aria-controls="`film-facet-${facet.key}`"
				@click="open = open === facet.key ? null : facet.key"
			>
				{{ facet.label }}
				<span v-if="activeCount(facet.key)" class="badge">{{ activeCount(facet.key) }}</span>
				<svg class="caret" viewBox="0 0 256 256" aria-hidden="true">
					<path d="m208 160-80-80-80 80" />
				</svg>
			</button>
			<div
				v-if="open === facet.key"
				:id="`film-facet-${facet.key}`"
				class="pop"
				role="group"
				:aria-label="facet.title"
			>
				<p class="pop-title" aria-hidden="true">{{ facet.title }}</p>
				<button
					v-for="opt in options[facet.key]"
					:key="opt.value"
					type="button"
					class="opt"
					:aria-pressed="opt.selected"
					:disabled="!opt.selected && opt.count === 0"
					@click="emit('toggle', facet.key, opt.value)"
				>
					<span class="check" aria-hidden="true"></span>
					<span class="opt-label">{{ opt.label }}</span>
					<span class="opt-count">{{ opt.count }}</span>
				</button>
			</div>
		</div>

		<!-- Phones: every facet in one sheet behind a single button. -->
		<div class="facet facet--all">
			<button
				:ref="(el) => setTrigger('all', el)"
				type="button"
				class="dock-btn"
				:class="{ 'is-active': hasFilters }"
				:aria-expanded="open === 'all'"
				aria-controls="film-facet-all"
				@click="open = open === 'all' ? null : 'all'"
			>
				<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M40 88h176M72 128h112M104 168h48" /></svg>
				Filters
				<span v-if="totalActive" class="badge">{{ totalActive }}</span>
			</button>
			<div v-if="open === 'all'" id="film-facet-all" class="pop pop--all">
				<div
					v-for="facet in facets"
					:key="facet.key"
					class="pop-section"
					role="group"
					:aria-labelledby="`film-all-${facet.key}`"
				>
					<p :id="`film-all-${facet.key}`" class="pop-title">{{ facet.title }}</p>
					<button
						v-for="opt in options[facet.key]"
						:key="opt.value"
						type="button"
						class="opt"
						:aria-pressed="opt.selected"
						:disabled="!opt.selected && opt.count === 0"
						@click="emit('toggle', facet.key, opt.value)"
					>
						<span class="check" aria-hidden="true"></span>
						<span class="opt-label">{{ opt.label }}</span>
						<span class="opt-count">{{ opt.count }}</span>
					</button>
				</div>
			</div>
		</div>

		<!-- Show every strip as color negatives (the lightbox then scans them in). -->
		<button
			type="button"
			class="dock-btn dock-neg"
			:aria-pressed="negative"
			title="Show the film as negatives"
			@click="emit('negative')"
		>
			<svg viewBox="0 0 256 256" aria-hidden="true">
				<circle cx="128" cy="128" r="88" />
				<path d="M128 40a88 88 0 0 1 0 176Z" fill="currentColor" stroke="none" />
			</svg>
			<span class="action-label">Negative</span>
		</button>
		<span class="dock-rule" aria-hidden="true"></span>
		<button v-if="hasFilters" type="button" class="dock-btn dock-action" @click="emit('clear')">
			<svg viewBox="0 0 256 256" aria-hidden="true"><path d="m56 56 144 144M200 56 56 200" /></svg>
			<span class="action-label">Back to the pile</span>
		</button>
		<button v-else type="button" class="dock-btn dock-action" @click="emit('toss')">
			<svg viewBox="0 0 256 256" aria-hidden="true">
				<path d="M24 184h40.6a32 32 0 0 0 26-13.4l74.8-104.8A32 32 0 0 1 191.4 52H232" />
				<path d="m208 28 24 24-24 24M24 72h40.6a32 32 0 0 1 26 13.4l7.4 10.4m60 84.4 7.4 10.4a32 32 0 0 0 26 13.4H232" />
				<path d="m208 180 24 24-24 24" />
			</svg>
			<span class="action-label">Toss again</span>
		</button>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { FacetKey, FacetOption } from './types';

const props = defineProps<{
	facets: { key: FacetKey; label: string; title: string }[];
	options: Record<string, FacetOption[]>;
	hasFilters: boolean;
	negative: boolean;
}>();

const emit = defineEmits<{
	toggle: [facet: FacetKey, value: string];
	clear: [];
	toss: [];
	negative: [];
}>();

type OpenList = FacetKey | 'all';
const open = ref<OpenList | null>(null);
const dockRef = ref<HTMLElement | null>(null);
const triggers = new Map<OpenList, HTMLElement>();

const setTrigger = (key: OpenList, el: unknown) => {
	if (el instanceof HTMLElement) triggers.set(key, el);
};

const activeCount = (key: FacetKey) => props.options[key]?.filter((o) => o.selected).length ?? 0;
const totalActive = computed(() => props.facets.reduce((n, f) => n + activeCount(f.key), 0));

function closeAndRefocus() {
	if (!open.value) return;
	triggers.get(open.value)?.focus();
	open.value = null;
}

// A click anywhere outside the dock puts the open list away.
function onPointerDown(e: PointerEvent) {
	if (open.value && !dockRef.value?.contains(e.target as Node)) open.value = null;
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown));
</script>

<style scoped>
.dock {
	position: relative;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 0.15rem;
	width: fit-content;
	max-width: calc(100% - 2rem);
	margin-inline: auto;
	padding: 0.3rem;
	border: 1px solid var(--gray-800);
	border-radius: 1.4rem;
	background: color-mix(in srgb, var(--gray-999) 82%, transparent);
	backdrop-filter: blur(16px) saturate(1.3);
	-webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: var(--shadow-md);
}

.facet {
	position: relative;
}

.dock-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	min-height: 2.5rem;
	padding: 0 0.95rem;
	border: 0;
	border-radius: 999rem;
	background: none;
	color: var(--gray-200);
	font: inherit;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	cursor: pointer;
	transition:
		background-color 200ms ease,
		color 200ms ease;
}

.dock-btn:hover,
.dock-btn[aria-expanded='true'] {
	background: var(--gray-900);
	color: var(--gray-0);
}

.dock-btn.is-active {
	color: var(--gray-0);
}

.dock-neg[aria-pressed='true'] {
	background: var(--accent-regular);
	color: var(--accent-text-over);
}

.dock-btn:focus-visible,
.opt:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.dock-btn svg {
	width: 0.9rem;
	height: 0.9rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 16;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.caret {
	transition: transform 200ms ease;
}

.dock-btn[aria-expanded='true'] .caret {
	transform: rotate(180deg);
}

.badge {
	display: inline-grid;
	place-items: center;
	min-width: 1.15rem;
	height: 1.15rem;
	padding: 0 0.3rem;
	border-radius: 999rem;
	background: var(--accent-regular);
	color: var(--accent-text-over);
	font-size: 0.72rem;
	font-variant-caps: normal;
	font-variant-numeric: tabular-nums;
	letter-spacing: 0;
	line-height: 1;
}

.dock-rule {
	width: 1px;
	height: 1.25rem;
	margin-inline: 0.2rem;
	background: var(--gray-700);
}

/* Option lists open upward, out of the dock. */
.pop {
	position: absolute;
	bottom: calc(100% + 0.75rem);
	left: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	min-width: 15rem;
	max-height: min(22rem, 55svh);
	overflow-y: auto;
	padding: 0.4rem;
	border: 1px solid var(--gray-800);
	border-radius: 1rem;
	background: var(--gray-999);
	box-shadow: var(--shadow-lg);
	animation: pop-in 220ms cubic-bezier(0.33, 1, 0.68, 1);
}

@keyframes pop-in {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
}

.pop-title {
	padding: 0.35rem 0.6rem 0.4rem;
	font-size: var(--text-sm);
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--gray-300);
}

.opt {
	display: flex;
	align-items: center;
	gap: 0.65rem;
	width: 100%;
	padding: 0.5rem 0.6rem;
	border: 0;
	border-radius: 0.6rem;
	background: none;
	color: var(--gray-100);
	font: inherit;
	font-size: var(--text-base);
	text-align: left;
	cursor: pointer;
}

.opt:hover:not(:disabled) {
	background: var(--gray-900);
}

.opt:disabled {
	color: var(--gray-500);
	cursor: default;
}

.check {
	flex: none;
	display: grid;
	place-items: center;
	width: 1rem;
	height: 1rem;
	border: 1.5px solid var(--gray-400);
	border-radius: 0.25rem;
	transition:
		background-color 150ms ease,
		border-color 150ms ease;
}

.opt[aria-pressed='true'] .check {
	border-color: var(--accent-regular);
	background:
		center / 0.7rem no-repeat
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M40 144l56 56L216 80' fill='none' stroke='white' stroke-width='28' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"),
		var(--accent-regular);
}

:root.theme-dark .opt[aria-pressed='true'] .check {
	background:
		center / 0.7rem no-repeat
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath d='M40 144l56 56L216 80' fill='none' stroke='black' stroke-width='28' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"),
		var(--accent-regular);
}

.opt-label {
	flex: 1;
}

.opt-count {
	font-size: var(--text-sm);
	font-variant-numeric: tabular-nums;
	color: var(--gray-300);
}

.opt:disabled .opt-count {
	color: var(--gray-500);
}

/* The combined sheet only exists on phones. */
.facet--all {
	display: none;
}

.pop-section + .pop-section {
	margin-top: 0.35rem;
	padding-top: 0.35rem;
	border-top: 1px solid var(--gray-800);
}

/* Phones: one Filters button whose sheet spans the dock's full width. */
@media (max-width: 40em) {
	.facet--single {
		display: none;
	}

	.facet--all {
		display: block;
		position: static;
	}

	.pop {
		left: 0;
		right: 0;
		min-width: 0;
		max-height: min(30rem, 62svh);
	}

	.dock {
		flex-wrap: nowrap;
		gap: 0;
		max-width: calc(100% - 1rem);
	}

	.dock-btn {
		gap: 0.25rem;
		padding: 0 0.6rem;
		letter-spacing: 0.05em;
	}

	/* Icon-only actions on phones; the labels stay for screen readers. */
	.dock-action,
	.dock-neg {
		padding-inline: 0.7rem;
	}

	.action-label {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.dock-action svg,
	.dock-neg svg {
		width: 1.1rem;
		height: 1.1rem;
	}
}

@media (prefers-reduced-motion: reduce) {
	.pop {
		animation: none;
	}
}
</style>
