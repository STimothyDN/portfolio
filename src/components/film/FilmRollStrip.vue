<template>
	<section class="rolls" aria-labelledby="film-rolls-label">
		<div class="rolls-head">
			<h2 id="film-rolls-label" class="rolls-label">
				Rolls
				<span class="rolls-count">
					{{ shown.length < rolls.length ? `${shown.length} of ${rolls.length}` : rolls.length }}
				</span>
			</h2>
			<p class="rolls-status" aria-live="polite">{{ status }}</p>
		</div>
		<!-- Only rolls the active filters allow; the rest slide out of the row. -->
		<TransitionGroup
			ref="listRef"
			tag="ul"
			name="can"
			class="roll-list"
			role="list"
			@before-leave="holdPlace"
		>
			<li v-for="({ roll, label }, i) in shown" :key="roll.id" :data-roll="roll.id">
				<button
					type="button"
					class="roll"
					:style="canStyle(roll, label, i)"
					:aria-pressed="selected.includes(roll.id)"
					@click="emit('toggle', roll.id)"
				>
					<span class="roll-object" aria-hidden="true">
						<!-- A 35mm canister, standing, labeled with the film stock it held… -->
						<span class="canister">
							<span class="can-spool"></span>
							<span class="can-cap"></span>
							<span class="can-body">
								<span class="can-label">
									<span v-for="(line, n) in label.lines" :key="n">{{ line }}</span>
								</span>
							</span>
							<span class="can-cap"></span>
							<span class="can-lip"></span>
						</span>
						<!-- …and its film pulled out through the felt lip: a few favorite
						     frames, then the cut leader. -->
						<span class="film">
							<span class="strip">
								<span v-for="file in roll.previews.slice(0, 3)" :key="file" class="frame">
									<img
										:src="previewUrl(roll, file)"
										alt=""
										loading="lazy"
										decoding="async"
										draggable="false"
									/>
								</span>
								<span class="leader"></span>
							</span>
						</span>
					</span>
					<span class="roll-meta">{{ shortDate(roll.developed) }} · {{ roll.title }}</span>
					<span class="sr-only">
						{{ roll.title }}, {{ roll.cameraLabel }}, {{ roll.stockLabel }}, {{ roll.count }} frames
					</span>
				</button>
			</li>
		</TransitionGroup>
	</section>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance, computed, ref, watch } from 'vue';

import { bunnyUrl } from '../../utils/bunny';
import type { FilmRollData } from './types';

const props = defineProps<{
	rolls: FilmRollData[];
	selected: string[];
	/** Frames each roll would show under the other active filters. */
	counts: Record<string, number>;
	status: string;
}>();

const emit = defineEmits<{ toggle: [id: string] }>();

const previewUrl = (roll: FilmRollData, file: string) =>
	bunnyUrl(`${roll.folder}/${file}`, { width: 160, format: 'webp', quality: 60 });

const shortDate = (iso: string) =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC',
	});

/** Every way to break `words` into `k` lines, in order. */
function splits(words: string[], k: number): string[][] {
	if (k === 1) return [[words.join(' ')]];
	const out: string[][] = [];
	for (let i = 1; i <= words.length - k + 1; i++) {
		for (const rest of splits(words.slice(i), k - 1)) out.push([words.slice(0, i).join(' '), ...rest]);
	}
	return out;
}

/**
 * Lay the film stock's name out along the canister in up to three lines,
 * picking whichever split prints largest. `fit` is the type size as a fraction
 * of the label's length (--label-room), so it holds at every canister size:
 * capped overall, by the longest line's length, and by the lines' combined
 * thickness across the body.
 */
function canLabel(name: string): { lines: string[]; fit: number } {
	const words = name.trim().split(/\s+/);
	let best = { lines: [name], fit: 0 };
	for (let k = 1; k <= Math.min(3, words.length); k++) {
		for (const lines of splits(words, k)) {
			const longest = Math.max(...lines.map((l) => l.length));
			const fit = Math.min(0.17, 1 / (longest * 0.74), 0.44 / (k * 1.08));
			// Ties go to fewer lines.
			if (fit > best.fit + 0.002) best = { lines, fit };
		}
	}
	return { lines: best.lines, fit: Math.max(0.085, best.fit) };
}

const labels = computed(() => props.rolls.map((roll) => canLabel(roll.stockLabel)));

const shown = computed(() =>
	props.rolls
		.map((roll, i) => ({ roll, label: labels.value[i] }))
		.filter(({ roll }) => props.counts[roll.id] > 0 || props.selected.includes(roll.id))
);

// A leaving roll is taken out of flow so its neighbours can slide over, and
// pinned where it stood (a flex row would otherwise drop it at the start).
// Positions are read before the list re-renders: rolls leave one by one, so
// measuring in the leave hook would see earlier leavers already gone.
const listRef = ref<ComponentPublicInstance | null>(null);
const places = new Map<string, { left: number; top: number; width: number }>();

watch(
	shown,
	() => {
		const ul = listRef.value?.$el as HTMLElement | undefined;
		if (!ul) return;
		for (const li of ul.children as HTMLCollectionOf<HTMLElement>) {
			const id = li.dataset.roll;
			if (id) places.set(id, { left: li.offsetLeft, top: li.offsetTop, width: li.offsetWidth });
		}
	},
	{ flush: 'pre' }
);

function holdPlace(el: Element) {
	const li = el as HTMLElement;
	const place = places.get(li.dataset.roll ?? '');
	if (!place) return;
	li.style.left = `${place.left}px`;
	li.style.top = `${place.top}px`;
	li.style.width = `${place.width}px`;
}

// Canister colors by film brand (read from the stock's display name), so a
// row of rolls reads like a real drawer of them. Unknown brands get a stable hue.
const BRANDS: [RegExp, string, string][] = [
	[/kodak|portra|ektar|gold|ultramax|colorplus|tri-?x/i, '#f2b705', '#2a1a05'],
	[/fuji|superia|velvia|provia/i, '#1d8a4c', '#f4f1e8'],
	[/lucky/i, '#c4262e', '#fbf3e6'],
	[/ilford|hp5|delta|fp4/i, '#ece9e2', '#151515'],
	[/cinestill/i, '#1b1b1d', '#e8392c'],
	[/lomo/i, '#2f5fb3', '#f4f1e8'],
];

function canStyle(roll: FilmRollData, label: { fit: number }, i: number) {
	const brand = BRANDS.find(([re]) => re.test(roll.stockLabel));
	let can = brand?.[1];
	let ink = brand?.[2];
	if (!can) {
		const hue = [...roll.stock].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
		can = `oklch(58% 0.12 ${hue})`;
		ink = '#f7f4ee';
	}
	return { '--can': can, '--can-ink': ink, '--label-fit': label.fit.toFixed(3), '--i': i };
}
</script>

<style scoped>
.rolls {
	--can-w: 44px;
	--can-h: 102px;
	/* Length of the label along the canister body, for fitting names. */
	--label-room: 74px;
	--frame-w: 66px;
	--frame-h: 44px;
	--rail: 10px;
	--leader-w: 34px;
	--base: #211a14;
}

:root.theme-dark .rolls {
	--base: #2c241d;
}

.rolls-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
	padding-inline: var(--film-gutter);
	margin-bottom: 0.5rem;
}

.rolls-label,
.rolls-status {
	font-family: var(--font-body);
	font-size: var(--text-sm);
	font-weight: 500;
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	font-variant-numeric: tabular-nums;
	color: var(--gray-300);
}

.rolls-count {
	margin-left: 0.35rem;
}

.rolls-status {
	font-weight: 400;
	text-align: right;
}

.roll-list {
	position: relative;
	display: flex;
	gap: 1.75rem;
	margin: 0;
	padding: 0.5rem var(--film-gutter) 0.75rem;
	list-style: none;
	overflow-x: auto;
	scroll-snap-type: x proximity;
	scroll-padding-inline: var(--film-gutter);
	scrollbar-width: none;
	mask-image: linear-gradient(90deg, transparent, #000 1.5rem, #000 calc(100% - 4rem), transparent);
}

.roll-list::-webkit-scrollbar {
	display: none;
}

.roll-list > li {
	flex: none;
	scroll-snap-align: start;
}

.roll {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.4rem;
	padding: 0 0 0.5rem;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: opacity 300ms ease;
}

/* Selected: an ink rule draws in under the roll. */
.roll::after {
	content: '';
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	height: 2px;
	border-radius: 2px;
	background: var(--accent-regular);
	transform: scaleX(0);
	transform-origin: left center;
	transition: transform 350ms cubic-bezier(0.33, 1, 0.68, 1);
}

.roll[aria-pressed='true']::after {
	transform: scaleX(1);
}

.roll:focus-visible {
	outline: 2px dashed var(--accent-regular);
	outline-offset: 4px;
	border-radius: 4px;
}

.roll-object {
	display: flex;
	align-items: center;
	filter: drop-shadow(0 6px 6px rgba(17, 16, 16, 0.22));
	transition: transform 300ms cubic-bezier(0.33, 1, 0.68, 1);
}

:root.theme-dark .roll-object {
	filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.8));
}

.roll[aria-pressed='true'] .roll-object {
	transform: translateY(-3px);
}

/* ── The canister ── */

.canister {
	position: relative;
	z-index: 2;
	display: flex;
	flex: none;
	flex-direction: column;
	align-items: center;
	width: var(--can-w);
	height: var(--can-h);
	transform-origin: 50% 85%;
	transition: rotate 300ms cubic-bezier(0.33, 1, 0.68, 1);
}

/* Cylinder shading shared by spool, caps and body. */
.can-cap,
.can-body,
.can-spool {
	background-image: linear-gradient(
		90deg,
		rgba(0, 0, 0, 0.32) 0%,
		rgba(255, 255, 255, 0.34) 28%,
		rgba(255, 255, 255, 0.08) 52%,
		rgba(0, 0, 0, 0.36) 100%
	);
}

.can-spool {
	flex: none;
	width: 34%;
	height: 7px;
	border-radius: 2px 2px 0 0;
	background-color: #3b3632;
}

.can-cap {
	flex: none;
	width: 100%;
	height: 7px;
	border-radius: 3px;
	background-color: #b9b4aa;
}

.can-body {
	position: relative;
	display: grid;
	place-items: center;
	flex: 1;
	width: calc(100% - 4px);
	overflow: hidden;
	background-color: var(--can);
}

.can-label {
	display: flex;
	flex-direction: column;
	align-items: center;
	writing-mode: vertical-rl;
	rotate: 180deg;
	color: var(--can-ink);
	font-family: var(--font-brand);
	font-size: calc(var(--label-room) * var(--label-fit));
	font-weight: 700;
	line-height: 1.05;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	white-space: nowrap;
}

/* Felt light-trap the film slides out through. */
.can-lip {
	position: absolute;
	top: 20px;
	bottom: 12px;
	right: -2px;
	width: 5px;
	border-radius: 2px;
	background: #120f0d;
}

/* ── The film ── */

/* Starts under the canister and clips there, so the strip appears to slide
   out of the lip; every other side is left open for the shadow. */
.film {
	position: relative;
	z-index: 1;
	margin-left: -16px;
	clip-path: inset(-20px -60px -20px 0);
}

.strip {
	--holes:
		linear-gradient(90deg, #000 0 5px, transparent 5px) 2px 3px / 9px 4px repeat-x,
		linear-gradient(90deg, #000 0 5px, transparent 5px) 2px calc(100% - 3px) / 9px 4px repeat-x;
	position: relative;
	display: flex;
	align-items: center;
	gap: 4px;
	height: calc(var(--frame-h) + var(--rail) * 2);
	padding: 0 0 0 22px;
	/* Real sprocket holes: punched out of the base, not painted on. */
	-webkit-mask: var(--holes), linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask: var(--holes), linear-gradient(#000 0 0);
	mask-composite: exclude;
	transition: translate 350ms cubic-bezier(0.33, 1, 0.68, 1);
}

/* The film base, stopping where the leader's own (cut) shape takes over. */
.strip::before {
	content: '';
	position: absolute;
	inset: 0 calc(var(--leader-w) - 8px) 0 0;
	z-index: -1;
	background: var(--base);
}

.frame {
	flex: none;
	width: var(--frame-w);
	height: var(--frame-h);
	overflow: hidden;
	border-radius: 1px;
	background: #3a3029;
}

.frame img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	pointer-events: none;
}

/* The cut tongue at the end of a 35mm leader. */
.leader {
	flex: none;
	align-self: stretch;
	width: var(--leader-w);
	margin-left: -4px;
	background: var(--base);
	clip-path: path('M0 0 H6 C13 0 12 30 21 30 H30 Q34 30 34 34 V64 H0 Z');
}

/* Pulling on it: the film slides a little further out and the can tips. */
.roll:hover .strip,
.roll:focus-visible .strip {
	translate: 10px 0;
}

.roll[aria-pressed='true'] .strip {
	translate: 16px 0;
}

.roll:hover .canister {
	rotate: -4deg;
}

.roll-meta {
	padding-left: 2px;
	font-size: var(--text-sm);
	letter-spacing: 0.06em;
	font-variant-caps: all-small-caps;
	white-space: nowrap;
	color: var(--gray-300);
	transition: color 200ms ease;
}

.roll[aria-pressed='true'] .roll-meta {
	color: var(--gray-0);
}

.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border-width: 0;
}

/* Rolls coming and going as filters change. */
.can-move,
.can-enter-active,
.can-leave-active {
	transition:
		transform 450ms cubic-bezier(0.33, 1, 0.68, 1),
		opacity 300ms ease;
}

.can-enter-from,
.can-leave-to {
	opacity: 0;
	transform: translateY(14px) scale(0.94);
}

.can-leave-active {
	position: absolute;
}

/* First load: each roll unspools in turn. */
@media (prefers-reduced-motion: no-preference) {
	.strip {
		animation: unspool 900ms calc(250ms + var(--i) * 70ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
	}

	.canister {
		animation: tug 900ms calc(250ms + var(--i) * 70ms) ease-out backwards;
	}

	/* A roll brought back by a filter change unspools right away. */
	.can-enter-active .strip,
	.can-enter-active .canister {
		animation-delay: 120ms;
	}

	@keyframes unspool {
		from {
			transform: translateX(calc(-100% + 8px));
		}
	}

	@keyframes tug {
		0% {
			transform: rotate(0deg);
		}
		25% {
			transform: rotate(-5deg);
		}
		55% {
			transform: rotate(2deg);
		}
		100% {
			transform: rotate(0deg);
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.strip,
	.canister,
	.roll-object,
	.roll::after,
	.can-move,
	.can-enter-active,
	.can-leave-active {
		transition: none;
	}
}

@media (max-width: 40em) {
	.rolls {
		--can-w: 36px;
		--can-h: 84px;
		--label-room: 60px;
		--frame-w: 52px;
		--frame-h: 35px;
		--rail: 9px;
	}

	.roll-list {
		gap: 1.25rem;
	}

	.rolls {
		--leader-w: 28px;
	}

	.leader {
		clip-path: path('M0 0 H5 C11 0 10 25 17 25 H24 Q28 25 28 29 V53 H0 Z');
	}

	.can-lip {
		top: 17px;
		bottom: 10px;
	}
}
</style>
