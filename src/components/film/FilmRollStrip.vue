<template>
	<!-- Open: canisters with their film pulled out. Rewound: the film winds
	     back into small canisters lined up on a shelf, each with just its
	     leader's tip showing. Put away: the cans slide off the shelf and it
	     fades, leaving only the counts and the toggle. Desktop starts open,
	     phones put away — set in CSS (is-open / is-rewound / is-away override
	     it), so neither flashes. -->
	<section
		class="rolls"
		:class="{
			'is-negative': negative,
			'is-open': state === 'open',
			'is-rewound': state === 'closed' || state === 'away',
			'is-away': state === 'away',
		}"
		aria-labelledby="film-rolls-label"
	>
		<h2 id="film-rolls-label" class="sr-only">Rolls</h2>
		<!-- Only rolls the active filters allow; the rest slide out of the row. -->
		<TransitionGroup
			id="film-roll-list"
			ref="listRef"
			tag="ul"
			name="can"
			class="roll-list"
			role="list"
			@before-leave="holdPlace"
		>
			<li v-for="(roll, i) in shown" :key="roll.id" :data-roll="roll.id">
				<button
					type="button"
					class="roll"
					:class="{ 'is-rewinding': rewinding.has(roll.id) }"
					@pointerleave="startRewind(roll.id)"
					@blur="startRewind(roll.id)"
					:style="{ '--i': i, ...negativeBaseVars(roll.negative) }"
					:title="roll.title"
					:aria-pressed="selected.includes(roll.id)"
					@click="emit('toggle', roll.id)"
				>
					<span class="roll-object" aria-hidden="true">
						<!-- A 35mm canister, standing, labeled with the film stock it held… -->
						<FilmCanister
							class="canister"
							:stock="roll.stock"
							:stock-label="roll.stockLabel"
							:stock-brand="roll.stockBrand"
						/>
						<!-- …and its film pulled out through the felt lip: a few favorite
						     frames, then the cut leader. -->
						<span class="film">
							<span class="strip">
								<span
									v-for="pv in roll.previews.slice(0, 3)"
									:key="pv.file"
									class="frame"
									:style="previewNegative(roll, pv)"
								>
									<img
										:src="previewUrl(roll, pv.file)"
										alt=""
										loading="lazy"
										decoding="async"
										draggable="false"
										@load="($event.target as HTMLImageElement).classList.add('is-loaded')"
									/>
								</span>
								<!-- Rewound, the leader carries the lab's sticker with the roll's
								     name; a tug on the can pulls it out into view. -->
								<span class="leader-tag" :style="{ '--tag-fs': `${tags[roll.id].fs}px` }">
									<span v-for="(line, n) in tags[roll.id].lines" :key="n">{{ line }}</span>
								</span>
								<span class="leader"></span>
							</span>
						</span>
					</span>
					<span class="roll-meta">{{ roll.title }}</span>
					<span class="sr-only">
						{{ roll.title }}, {{ roll.cameraLabel }}, {{ roll.stockLabel }}, {{ roll.count }} frames
					</span>
				</button>
			</li>
		</TransitionGroup>

		<!-- Rewound, the cans stand on a little wooden film shelf with a
		     label-maker tape on its edge. -->
		<div class="shelf" aria-hidden="true">
			<span class="shelf-label">{{ shown.length }} {{ shown.length === 1 ? 'roll' : 'rolls' }}</span>
		</div>

		<div class="rolls-foot">
			<p class="rolls-summary" aria-live="polite">
				<!-- On the shelf, the roll count is on its label tape instead. -->
				<span class="summary-rolls">{{ rollCount }} · </span>{{ status }}
			</p>
			<button
				type="button"
				class="rolls-toggle"
				:aria-expanded="current !== 'away'"
				aria-controls="film-roll-list"
				@click="emit('toggleOpen')"
			>
				<!-- A camera's rewind crank. -->
				<svg class="crank" viewBox="0 0 256 256" aria-hidden="true">
					<circle cx="128" cy="128" r="40" />
					<path d="M128 88V40h56M184 40v28" />
				</svg>
				<span class="when-open">Rewind film</span>
				<span class="when-rewound">Put away film</span>
				<span class="when-away">Pull out film</span>
				<svg class="chevron" viewBox="0 0 256 256" aria-hidden="true"><path d="m48 96 80 80 80-80" /></svg>
			</button>
		</div>
	</section>
</template>

<script setup lang="ts">
import { type ComponentPublicInstance, computed, onBeforeUnmount, ref, watch } from 'vue';

import { bunnyUrl } from '../../utils/bunny';
import { bestSplit } from './canister';
import FilmCanister from './FilmCanister.vue';
import { negativeBaseVars, negativeFilterId } from './negative';
import type { FilmRollData, RollsState } from './types';

const props = defineProps<{
	rolls: FilmRollData[];
	selected: string[];
	/** Frames each roll would show under the other active filters. */
	counts: Record<string, number>;
	status: string;
	/** Show the pulled-out film as negatives. */
	negative: boolean;
	/** The viewer's choice; null = the default for the screen size. */
	state: RollsState | null;
	/** The state actually showing (the choice, or the screen's default). */
	current: RollsState;
}>();

const emit = defineEmits<{ toggle: [id: string]; toggleOpen: [] }>();

const rollCount = computed(() => {
	const total = props.rolls.length;
	return shown.value.length < total ? `${shown.value.length} of ${total} rolls` : `${total} rolls`;
});

const previewUrl = (roll: FilmRollData, file: string) =>
	bunnyUrl(`${roll.folder}/${file}`, { width: 160, format: 'webp', quality: 60 });

/** A preview frame's negative: its scan, through its stock and exposure's filter (FilmDesk renders them). */
const previewNegative = (roll: FilmRollData, pv: FilmRollData['previews'][number]) => ({
	'--scan': `url("${previewUrl(roll, pv.file)}")`,
	'--neg': `url(#${negativeFilterId(roll.negative, pv.exposure)})`,
});

// The leader sticker's writing: the title in marker on up to two lines, as
// large as a ~124×22px label allows (the marker face runs ~0.6em a character).
const tags = computed(() =>
	Object.fromEntries(
		props.rolls.map((roll) => {
			const { lines, score } = bestSplit(roll.title, 2, (ls) =>
				Math.min(22 / (ls.length * 1.08), 120 / (Math.max(...ls.map((l) => l.length)) * 0.6), 11)
			);
			return [roll.id, { lines, fs: Math.max(6.5, Math.round(score * 10) / 10) }];
		})
	)
);

// A can whose leader is winding back in stays above everything — including a
// neighbour the pointer has just moved onto — until the leader is home. The
// strip's own translate (520ms) trails --stub (420ms), so the leader is still
// moving for roughly the sum of the two.
const REWIND_MS = 960;
const rewinding = ref(new Set<string>());
const rewindTimers = new Map<string, number>();
function startRewind(id: string) {
	window.clearTimeout(rewindTimers.get(id));
	rewinding.value = new Set(rewinding.value).add(id);
	rewindTimers.set(
		id,
		window.setTimeout(() => {
			const next = new Set(rewinding.value);
			next.delete(id);
			rewinding.value = next;
			rewindTimers.delete(id);
		}, REWIND_MS)
	);
}
onBeforeUnmount(() => rewindTimers.forEach((t) => window.clearTimeout(t)));

const shown = computed(() =>
	props.rolls.filter((roll) => props.counts[roll.id] > 0 || props.selected.includes(roll.id))
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

/** The row's right edge fades out under its mask (4rem). */
const FADE_PX = 64;

/**
 * Bring a roll picked from elsewhere (the lightbox's "View entire roll") into
 * view in the row. Scrolls only the row itself, only if the roll isn't fully
 * visible already, and lands on the roll's own snap position so the row's
 * scroll snapping doesn't nudge it afterwards.
 */
function reveal(id: string) {
	const ul = listRef.value?.$el as HTMLElement | undefined;
	const li = ul?.querySelector<HTMLElement>(`li[data-roll="${CSS.escape(id)}"]`);
	if (!ul || !li) return;
	// The row's side padding is the gutter its snap positions are inset by.
	const gutter = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
	const start = li.offsetLeft;
	const end = start + li.offsetWidth;
	if (start >= ul.scrollLeft + gutter && end <= ul.scrollLeft + ul.clientWidth - FADE_PX) return;
	const left = Math.max(0, Math.min(start - gutter, ul.scrollWidth - ul.clientWidth));
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	ul.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
}

defineExpose({ reveal });
</script>

<style scoped>
/* Registered so the open ⇄ rewound sizes animate. */
@property --can-h {
	syntax: '<length>';
	inherits: true;
	initial-value: 102px;
}

@property --frame-h {
	syntax: '<length>';
	inherits: true;
	initial-value: 44px;
}

@property --stub {
	syntax: '<length>';
	inherits: true;
	initial-value: 0px;
}

@property --rest {
	syntax: '<length>';
	inherits: true;
	initial-value: 0px;
}

@property --leader-w {
	syntax: '<length>';
	inherits: true;
	initial-value: 34px;
}

@property --rail {
	syntax: '<length>';
	inherits: true;
	initial-value: 10px;
}

.rolls {
	/* The row of cans, then the counts and toggle. The first row folds to
	   nothing when the film is put away (fr rows interpolate, so it eases). */
	display: grid;
	grid-template-rows: 1fr auto;
	--can-h: 102px;
	--frame-w: 66px;
	--frame-h: 44px;
	--rail: 10px;
	--leader-w: 34px;
	--base: #211a14;
	/* How bright the light table behind the negatives is. */
	--neg-light: brightness(1);
}

:root.theme-dark .rolls {
	--base: #2c241d;
	--neg-light: brightness(0.84);
}

@media (prefers-reduced-motion: no-preference) {
	.rolls {
		transition:
			--can-h 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--frame-h 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--rail 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--leader-w 520ms cubic-bezier(0.65, 0, 0.35, 1),
			grid-template-rows 520ms cubic-bezier(0.65, 0, 0.35, 1);
	}
}

.roll-list {
	min-height: 0;
	position: relative;
	display: flex;
	gap: 1.75rem;
	transition:
		gap 520ms cubic-bezier(0.65, 0, 0.35, 1),
		padding 520ms cubic-bezier(0.65, 0, 0.35, 1);
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
	/* As wide as the canister and its film; the title wraps beneath them. */
	width: min-content;
	padding: 0 0 0.5rem;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition:
		opacity 300ms ease,
		--stub 420ms cubic-bezier(0.33, 1, 0.68, 1);
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
	position: relative;
	display: flex;
	align-items: center;
	filter: drop-shadow(0 6px 6px rgba(17, 16, 16, 0.22));
	transform-origin: 50% 100%;
	transition:
		transform 300ms cubic-bezier(0.33, 1, 0.68, 1),
		rotate 520ms cubic-bezier(0.65, 0, 0.35, 1),
		filter 520ms ease;
}

/* Contact shadow where the can meets the shelf (shown when rewound). */
.roll-object::before {
	content: '';
	position: absolute;
	left: calc(var(--can-h) * 0.02);
	bottom: -3px;
	width: calc(var(--can-h) * 0.4);
	height: 6px;
	border-radius: 50%;
	background: radial-gradient(closest-side, rgba(30, 20, 10, 0.45), transparent);
	opacity: 0;
	transition:
		opacity 360ms ease,
		scale 300ms ease;
}

:root.theme-dark .roll-object {
	filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.8));
}

.roll[aria-pressed='true'] .roll-object {
	transform: translateY(-3px);
}

/* ── The canister (FilmCanister.vue draws it; this is how it sits here) ── */

.canister {
	z-index: 2;
	transform-origin: 50% 85%;
	transition: rotate 300ms cubic-bezier(0.33, 1, 0.68, 1);
}

/* ── The film ── */

/* Starts under the canister and clips there, so the strip appears to slide
   out of the lip; every other side is left open for the shadow. */
.film {
	position: relative;
	z-index: 1;
	max-width: 24rem;
	margin-left: calc(var(--can-h) * -0.157);
	clip-path: inset(-20px -60px -20px 0);
	transition:
		max-width 520ms cubic-bezier(0.65, 0, 0.35, 1),
		clip-path 520ms cubic-bezier(0.65, 0, 0.35, 1);
}

.strip {
	--holes:
		linear-gradient(90deg, #000 0 5px, transparent 5px) 2px 3px / 9px 4px repeat-x,
		linear-gradient(90deg, #000 0 5px, transparent 5px) 2px calc(100% - 3px) / 9px 4px repeat-x;
	position: relative;
	display: flex;
	align-items: center;
	gap: 4px;
	/* Its natural length, even while the visible film is cut short (rewound). */
	width: max-content;
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
	position: relative;
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

/* Negative view: each roll's film turns to its stock's bare base, and its
   frames to their negatives (negative.ts); pulling on a roll shows the
   positives. The negative is the same scan over the frame, through its
   stock's filter, fading rather than easing (a filter can't ease to none). */
.rolls.is-negative .roll {
	--base: var(--stock-rail);
}

:root.theme-dark .rolls.is-negative .roll {
	--base: color-mix(in srgb, var(--stock-rail) 84%, #000);
}

.is-negative .frame {
	background: var(--stock-frame);
}

:root.theme-dark .is-negative .frame {
	background: color-mix(in srgb, var(--stock-frame) 84%, #000);
}

.frame:has(> img.is-loaded)::after {
	content: '';
	position: absolute;
	inset: 0;
	background: var(--scan) center / cover;
	filter: var(--neg) var(--neg-light);
	opacity: 0;
	pointer-events: none;
	transition: opacity 650ms cubic-bezier(0.33, 1, 0.68, 1);
}

.is-negative .frame:has(> img.is-loaded)::after {
	opacity: 1;
}

@starting-style {
	.is-negative .frame:has(> img.is-loaded)::after {
		opacity: 0;
	}
}

.is-negative .roll:hover .frame::after,
.is-negative .roll:focus-visible .frame::after {
	opacity: 0;
}

/* The lab's sticker on the leader — only there once the film is rewound. */
.leader-tag {
	display: none;
	flex: none;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 128px;
	height: calc(var(--frame-h) + var(--rail) * 2 - 6px);
	margin: 0 4px 0 14px;
	overflow: hidden;
	border-radius: 2px;
	background:
		linear-gradient(170deg, rgba(255, 255, 255, 0.55), transparent 45%),
		#efe8d6;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
	color: #18191d;
	font-family: 'Permanent Marker', var(--font-brand), cursive;
	font-size: var(--tag-fs);
	line-height: 1.05;
	white-space: nowrap;
	rotate: -2deg;
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
	/* Long titles wrap under the film (up to three lines) instead of running
	   into the next roll. */
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	overflow: hidden;
	padding-left: 2px;
	font-size: var(--text-sm);
	line-height: 1.35;
	letter-spacing: 0.06em;
	font-variant-caps: all-small-caps;
	overflow-wrap: anywhere;
	color: var(--gray-300);
	max-height: 4.2em;
	transition:
		color 200ms ease,
		max-height 420ms cubic-bezier(0.65, 0, 0.35, 1),
		opacity 300ms ease;
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


/* ── Below the row: the counts, and the rewind crank that folds it away ── */

/* ── The film shelf (rewound state) ── */

.rolls {
	position: relative;
}

.roll-list {
	z-index: 1;
}

.shelf {
	--wood-top: linear-gradient(180deg, #e6cca8, #cda578);
	--wood-edge: linear-gradient(180deg, #ab7f51, #86613d);
	position: absolute;
	left: calc(var(--film-gutter) - 0.75rem);
	right: calc(var(--film-gutter) - 0.75rem);
	/* The top surface ends where the cans' bases sit. */
	top: calc(0.6rem + var(--can-h) - 6px);
	height: 20px;
	z-index: 0;
	opacity: 0;
	translate: 0 10px;
	pointer-events: none;
	transition:
		opacity 360ms ease,
		translate 520ms cubic-bezier(0.65, 0, 0.35, 1);
}

:root.theme-dark .shelf {
	--wood-top: linear-gradient(180deg, #7a5d40, #634a32);
	--wood-edge: linear-gradient(180deg, #503a26, #3d2c1c);
}

/* Top surface, lit from above… */
.shelf::before {
	content: '';
	position: absolute;
	inset: 0 0 auto;
	height: 6px;
	border-radius: 3px 3px 0 0;
	background: var(--wood-top);
}

/* …and the front edge, with the shelf's own shadow below. */
.shelf::after {
	content: '';
	position: absolute;
	inset: 6px 0 0;
	border-radius: 0 0 3px 3px;
	background: var(--wood-edge);
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.18),
		0 10px 16px -8px rgba(40, 25, 10, 0.45);
}

/* Label-maker tape: embossed white capitals on black. */
.shelf-label {
	position: absolute;
	z-index: 1;
	left: 0.9rem;
	top: 7.5px;
	padding: 1px 6px 0;
	border-radius: 2px;
	background: linear-gradient(180deg, #2a2a2d, #141416);
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
	color: #f2f2f2;
	font-family: var(--font-body);
	font-size: 8.5px;
	font-weight: 700;
	line-height: 11px;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	text-shadow:
		0 1px 0 rgba(0, 0, 0, 0.7),
		0 -1px 0 rgba(255, 255, 255, 0.22);
	rotate: -1deg;
}

.rolls-foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 0 var(--film-gutter);
}

.rolls-summary {
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	font-family: var(--font-body);
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	font-variant-numeric: tabular-nums;
	color: var(--gray-300);
}

.rolls-toggle {
	flex: none;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.25rem 0.7rem 0.25rem 0.55rem;
	border: 1px solid var(--gray-700);
	border-radius: 999rem;
	background: color-mix(in srgb, var(--gray-999) 70%, transparent);
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

.rolls-toggle:hover {
	background: var(--gray-900);
	color: var(--gray-0);
}

.rolls-toggle:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.rolls-toggle svg {
	width: 0.95rem;
	height: 0.95rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 16;
	stroke-linecap: round;
	stroke-linejoin: round;
	transition: rotate 520ms cubic-bezier(0.65, 0, 0.35, 1);
}

.rolls-toggle .chevron {
	width: 0.8rem;
	height: 0.8rem;
}

/* Rewound on request (any screen)… */
.rolls.is-rewound {
	--can-h: 52px;
	--frame-h: 20px;
	--rail: 7px;
}

.rolls.is-rewound .roll-list {
	gap: 0.75rem;
	padding-top: 0.6rem;
	padding-bottom: 1.5rem;
}

/* The film winds back in, leaving the cut tip of its leader showing;
   pointing at a can pulls the leader out — sticker and all — across the
   shelf. --rest is the tip's reach past the felt lip (it sets the layout
   width); --stub is how far the film actually reaches, revealed by the
   clip without nudging the neighbouring cans. */
.rolls.is-rewound {
	--leader-w: 22px;
}

.rolls.is-rewound .roll {
	--rest: calc(var(--can-h) * 0.157 + 16px);
	--stub: var(--rest);
	z-index: 1;
}

.rolls.is-rewound .roll:hover,
.rolls.is-rewound .roll:focus-visible {
	--stub: calc(var(--can-h) * 0.157 + 176px);
	/* Pulled out over its neighbours… */
	z-index: 3;
}

/* …and kept above everything while the leader winds back in. */
.rolls.is-rewound .roll.is-rewinding {
	z-index: 4;
}

.rolls.is-rewound .roll[aria-pressed='true'] {
	--stub: calc(var(--can-h) * 0.157 + 28px);
}

.rolls.is-rewound .film {
	max-width: var(--rest);
	clip-path: inset(-20px calc(var(--rest) - var(--stub)) -20px 0);
}

.rolls.is-rewound .leader-tag {
	display: flex;
}

/* Slide the strip so its leader end, not its start, sits at the lip. */
.rolls.is-rewound .strip,
.rolls.is-rewound .roll:hover .strip,
.rolls.is-rewound .roll:focus-visible .strip,
.rolls.is-rewound .roll[aria-pressed='true'] .strip {
	translate: calc(var(--stub) - 100%) 0;
	transition: translate 520ms cubic-bezier(0.65, 0, 0.35, 1);
}

/* The tongue's cut, drawn to scale at this small size. */
.rolls.is-rewound .leader {
	clip-path: polygon(0 0, 18% 0, 30% 12%, 38% 38%, 50% 47%, 88% 47%, 97% 49%, 100% 55%, 100% 100%, 0 100%);
}

.rolls.is-rewound .roll:hover .canister {
	rotate: 0deg;
}

.rolls.is-rewound .roll {
	gap: 0;
}

.rolls.is-rewound .roll-meta {
	max-height: 0;
	opacity: 0;
}

.rolls.is-rewound .summary-rolls {
	display: none;
}

.rolls.is-rewound .shelf {
	opacity: 1;
	translate: 0 0;
}

/* Standing on the shelf: a tight shadow. */
.rolls.is-rewound .roll-object {
	filter: drop-shadow(0 1px 1px rgba(17, 16, 16, 0.3));
}

.rolls.is-rewound .roll-object::before {
	opacity: 1;
}

/* The chosen roll is lifted off the shelf. */
.rolls.is-rewound .roll[aria-pressed='true'] .roll-object {
	transform: translateY(-7px);
}

.rolls.is-rewound .roll[aria-pressed='true'] .roll-object::before {
	bottom: -10px;
	opacity: 0.55;
	scale: 1.25;
}

.rolls.is-rewound .roll::after {
	display: none;
}

/* …and on phones unless opened, since they start put away (below), which
   builds on the rewound look. */
@media (max-width: 40em) {
	.rolls:not(.is-open) {
		--can-h: 48px;
		--frame-h: 18px;
		--rail: 6px;
	}

	.rolls:not(.is-open) .roll-list {
		gap: 0.75rem;
		padding-top: 0.6rem;
		padding-bottom: 1.5rem;
	}

	/* The film winds back in, leaving the cut tip of its leader showing;
	   pointing at a can pulls the leader out — sticker and all — across the
	   shelf. --rest is the tip's reach past the felt lip (it sets the layout
	   width); --stub is how far the film actually reaches, revealed by the
	   clip without nudging the neighbouring cans. */
	.rolls:not(.is-open) {
		--leader-w: 20px;
	}

	.rolls:not(.is-open) .roll {
		--rest: calc(var(--can-h) * 0.157 + 16px);
		--stub: var(--rest);
		z-index: 1;
	}

	.rolls:not(.is-open) .roll:hover,
	.rolls:not(.is-open) .roll:focus-visible {
		--stub: calc(var(--can-h) * 0.157 + 176px);
		/* Pulled out over its neighbours… */
		z-index: 3;
	}

	/* …and kept above everything while the leader winds back in. */
	.rolls:not(.is-open) .roll.is-rewinding {
		z-index: 4;
	}

	.rolls:not(.is-open) .roll[aria-pressed='true'] {
		--stub: calc(var(--can-h) * 0.157 + 28px);
	}

	.rolls:not(.is-open) .film {
		max-width: var(--rest);
		clip-path: inset(-20px calc(var(--rest) - var(--stub)) -20px 0);
	}

	.rolls:not(.is-open) .leader-tag {
		display: flex;
	}

	/* Slide the strip so its leader end, not its start, sits at the lip. */
	.rolls:not(.is-open) .strip,
	.rolls:not(.is-open) .roll:hover .strip,
	.rolls:not(.is-open) .roll:focus-visible .strip,
	.rolls:not(.is-open) .roll[aria-pressed='true'] .strip {
		translate: calc(var(--stub) - 100%) 0;
		transition: translate 520ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	/* The tongue's cut, drawn to scale at this small size. */
	.rolls:not(.is-open) .leader {
		clip-path: polygon(0 0, 18% 0, 30% 12%, 38% 38%, 50% 47%, 88% 47%, 97% 49%, 100% 55%, 100% 100%, 0 100%);
	}

	.rolls:not(.is-open) .roll:hover .canister {
		rotate: 0deg;
	}

	.rolls:not(.is-open) .roll {
		gap: 0;
	}

	.rolls:not(.is-open) .roll-meta {
		max-height: 0;
		opacity: 0;
	}

	.rolls:not(.is-open) .summary-rolls {
		display: none;
	}

	.rolls:not(.is-open) .shelf {
		opacity: 1;
		translate: 0 0;
	}

	/* Standing on the shelf: a tight shadow. */
	.rolls:not(.is-open) .roll-object {
		filter: drop-shadow(0 1px 1px rgba(17, 16, 16, 0.3));
	}

	.rolls:not(.is-open) .roll-object::before {
		opacity: 1;
	}

	/* The chosen roll is lifted off the shelf. */
	.rolls:not(.is-open) .roll[aria-pressed='true'] .roll-object {
		transform: translateY(-7px);
	}

	.rolls:not(.is-open) .roll[aria-pressed='true'] .roll-object::before {
		bottom: -10px;
		opacity: 0.55;
		scale: 1.25;
	}

	.rolls:not(.is-open) .roll::after {
		display: none;
	}
}

/* ── Put away: the cans slide off the end of the shelf, the shelf goes, and
   the row folds up, leaving the counts and the toggle — every bit of the
   screen for the pictures. On request anywhere (is-away, which also carries
   is-rewound so the cans are small as they leave)… ── */

.when-rewound,
.when-away {
	display: none;
}

.rolls.is-rewound .when-open {
	display: none;
}

.rolls.is-rewound .when-rewound {
	display: inline;
}

.rolls.is-rewound .crank {
	rotate: -270deg;
}

.rolls.is-away .when-rewound {
	display: none;
}

.rolls.is-away .when-away {
	display: inline;
}

.rolls.is-away {
	grid-template-rows: 0fr auto;
}

.rolls.is-away .roll-list {
	padding-block: 0;
	visibility: hidden;
}

.rolls.is-away .roll {
	translate: calc(-100vw - 100%) 0;
}

.rolls.is-away .shelf {
	opacity: 0;
	translate: 0 6px;
}

/* Nothing on the shelf to read the count off any more. */
.rolls.is-away .summary-rolls {
	display: inline;
}

.rolls.is-away .crank {
	rotate: -540deg;
}

.rolls.is-away .chevron {
	rotate: 180deg;
}

/* …and by default on phones, until the toggle is used. */
@media (max-width: 40em) {
	.rolls:not(.is-open):not(.is-rewound) {
		grid-template-rows: 0fr auto;
	}

	.rolls:not(.is-open):not(.is-rewound) .roll-list {
		padding-block: 0;
		visibility: hidden;
	}

	.rolls:not(.is-open):not(.is-rewound) .roll {
		translate: calc(-100vw - 100%) 0;
	}

	.rolls:not(.is-open):not(.is-rewound) .shelf {
		opacity: 0;
		translate: 0 6px;
	}

	.rolls:not(.is-open):not(.is-rewound) .summary-rolls {
		display: inline;
	}

	.rolls:not(.is-open):not(.is-rewound) .when-open {
		display: none;
	}

	.rolls:not(.is-open):not(.is-rewound) .when-away {
		display: inline;
	}

	.rolls:not(.is-open):not(.is-rewound) .crank {
		rotate: -540deg;
	}

	.rolls:not(.is-open):not(.is-rewound) .chevron {
		rotate: 180deg;
	}
}

@media (prefers-reduced-motion: no-preference) {
	/* Coming back, the cans slide in one after another as the row opens. */
	.rolls .roll {
		transition:
			opacity 300ms ease,
			--stub 420ms cubic-bezier(0.33, 1, 0.68, 1),
			translate 560ms cubic-bezier(0.33, 1, 0.68, 1) calc(120ms + min(var(--i), 8) * 40ms);
	}

	/* Leaving, they accelerate off the end of the shelf, left to right; then
	   the shelf goes, then the row folds up. */
	.rolls.is-away .roll {
		transition:
			opacity 300ms ease,
			--stub 420ms cubic-bezier(0.33, 1, 0.68, 1),
			translate 460ms cubic-bezier(0.55, 0, 0.85, 0.35) calc(min(var(--i), 8) * 35ms);
	}

	.rolls.is-away .shelf {
		transition:
			opacity 320ms ease 300ms,
			translate 420ms cubic-bezier(0.65, 0, 0.35, 1) 300ms;
	}

	.rolls.is-away {
		transition:
			--can-h 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--frame-h 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--rail 520ms cubic-bezier(0.65, 0, 0.35, 1),
			--leader-w 520ms cubic-bezier(0.65, 0, 0.35, 1),
			grid-template-rows 420ms cubic-bezier(0.65, 0, 0.35, 1) 480ms;
	}

	.rolls.is-away .roll-list {
		transition:
			gap 520ms cubic-bezier(0.65, 0, 0.35, 1),
			padding 420ms cubic-bezier(0.65, 0, 0.35, 1) 480ms,
			visibility 0s linear 920ms;
	}
}

@media (max-width: 40em) {
	.rolls {
		--can-h: 84px;
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
}
</style>
