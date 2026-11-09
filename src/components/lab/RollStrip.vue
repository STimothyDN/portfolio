<template>
	<section class="strip-wrap" :class="[mode, { 'no-scans': !scans }]" :style="baseVars" aria-label="The roll as a strip of film">
		<header class="strip-head">
			<span class="lab-edge-print">{{ headline }}</span>
			<div v-if="scans" class="mode" role="group" aria-label="Show the frames as">
				<button type="button" :aria-pressed="mode === 'negative'" @click="mode = 'negative'">Negative</button>
				<button type="button" :aria-pressed="mode === 'positive'" @click="mode = 'positive'">Positive</button>
			</div>
		</header>

		<!-- The Negative look: one filter per exposure, from the film desk's own model (negative.ts). -->
		<svg v-if="scans && profile" class="filters" aria-hidden="true" focusable="false">
			<filter v-for="f in filters" :id="f.id" :key="f.id" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
				<feColorMatrix v-if="f.mono" type="saturate" values="0" />
				<feComponentTransfer>
					<feFuncR type="table" :tableValues="f.density[0]" />
					<feFuncG type="table" :tableValues="f.density[1]" />
					<feFuncB type="table" :tableValues="f.density[2]" />
				</feComponentTransfer>
				<feColorMatrix type="matrix" :values="f.matrix" />
				<feComponentTransfer>
					<feFuncR type="table" :tableValues="f.transmit[0]" />
					<feFuncG type="table" :tableValues="f.transmit[1]" />
					<feFuncB type="table" :tableValues="f.transmit[2]" />
				</feComponentTransfer>
			</filter>
		</svg>

		<div ref="track" class="strip" tabindex="0" :aria-label="scans ? `${scans.length} scans; scroll sideways` : 'Frames on this roll'">
			<template v-if="scans">
				<a v-for="s in scans" :key="s.frame" class="frame" :href="s.full" target="_blank" rel="noopener" :style="{ '--ar': s.w && s.h ? `${s.w} / ${s.h}` : '3 / 2' }">
					<span class="edge">{{ s.frame }} <span class="arrow">▸</span> {{ s.frame }}A</span>
					<span class="img">
						<img :src="s.src" alt="" loading="lazy" decoding="async" :width="s.w" :height="s.h" />
						<img
							v-if="profile"
							class="neg"
							:src="s.src"
							:alt="`Frame ${s.frame}`"
							loading="lazy"
							decoding="async"
							:width="s.w"
							:height="s.h"
							:style="{ filter: `url(#${negativeFilterId(profile, s.exposure)})` }"
						/>
					</span>
				</a>
			</template>
			<template v-else>
				<div v-for="n in exposures" :key="n" class="frame" :class="{ shot: logged.has(n) }">
					<span class="edge">{{ n }} <span class="arrow">▸</span> {{ n }}A</span>
					<span class="img"><span class="latent-img"></span></span>
					<span class="exp">{{ logged.get(n) ?? '' }}</span>
				</div>
			</template>
		</div>
	</section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { formatExposure } from '../../lib/lab/inventory';
import { negativeBaseVars, negativeFilter, negativeFilterId, type NegativeProfileKey } from '../film/negative';

interface Scan {
	src: string;
	full: string;
	frame: number;
	w?: number;
	h?: number;
	exposure: number;
}

const props = defineProps<{
	code: string;
	stockName: string;
	profile: NegativeProfileKey | null;
	scans: Scan[] | null;
	frames: { number: number; aperture: number | null; shutter: string | null; flash: boolean }[];
	exposures: number;
}>();

/* Scans open as negatives and print through to positives once (developing); then it's your call. */
const mode = ref<'negative' | 'positive'>(props.scans ? 'negative' : 'positive');
const track = ref<HTMLElement | null>(null);

const filters = computed(() => {
	if (!props.scans || !props.profile) return [];
	const seen = new Set<number>();
	return props.scans.filter((s) => !seen.has(s.exposure) && seen.add(s.exposure)).map((s) => negativeFilter(props.profile!, s.exposure));
});
const baseVars = computed(() => (props.profile ? negativeBaseVars(props.profile) : {}));
const logged = computed(() => new Map(props.frames.map((f) => [f.number, formatExposure(f)])));
const headline = computed(() =>
	props.scans
		? `${props.code} · ${props.stockName} · ${props.scans.length} scans`
		: `${props.code} · ${props.stockName} · ${logged.value.size} of ${props.exposures} frames logged`
);

onMounted(() => {
	if (!props.scans) return;
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
		mode.value = 'positive';
		return;
	}
	setTimeout(() => (mode.value = 'positive'), 1400);
});
</script>

<style scoped>
.strip-wrap {
	--base: var(--lab-film);
	--rail: var(--lab-film);
	--ink: var(--lab-edge-ink);
	display: grid;
	gap: 0.6rem;
	min-width: 0;
}

/* As negatives, the strip takes on the stock's own base: orange for color film, gray for black-and-white. */
.strip-wrap.negative {
	--base: var(--stock-frame, var(--lab-film));
	--rail: var(--stock-rail, var(--lab-film));
	--ink: var(--stock-ink, var(--lab-edge-ink));
}

.strip-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem 1rem;
}

.mode {
	display: inline-flex;
	padding: 0.2rem;
	border-radius: 999px;
	box-shadow: inset 0 0 0 1px var(--gray-700);
}

.mode button {
	min-height: 2rem;
	padding: 0 0.85rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-300);
	font: inherit;
	font-size: var(--text-sm);
	letter-spacing: 0.08em;
	font-variant-caps: all-small-caps;
	cursor: pointer;
}

.mode button[aria-pressed='true'] {
	background: var(--accent-regular);
	color: var(--accent-text-over);
}

.mode button:focus-visible,
.strip:focus-visible,
.frame:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

.filters {
	position: absolute;
	width: 0;
	height: 0;
}

.strip {
	position: relative;
	display: flex;
	gap: 0.35rem;
	padding: 1.1rem 0.5rem;
	overflow-x: auto;
	border-radius: 3px;
	background: var(--rail);
	scroll-snap-type: x proximity;
	scrollbar-width: thin;
	transition: background-color 0.9s ease;
}

/* Sprocket holes run the length of the strip, top and bottom, and scroll with it. */
.strip-wrap .strip {
	background-image:
		repeating-linear-gradient(90deg, var(--sprocket-hole) 0 0.5rem, transparent 0.5rem 1.05rem),
		repeating-linear-gradient(90deg, var(--sprocket-hole) 0 0.5rem, transparent 0.5rem 1.05rem);
	background-size:
		100% 0.38rem,
		100% 0.38rem;
	background-position:
		0 0.32rem,
		0 calc(100% - 0.32rem);
	background-repeat: repeat-x;
	background-attachment: local;
	--sprocket-hole: color-mix(in oklch, var(--gray-999) 88%, transparent);
}

.frame {
	position: relative;
	flex: none;
	display: grid;
	gap: 0.25rem;
	scroll-snap-align: start;
	color: inherit;
	text-decoration: none;
}

.edge {
	font-family: var(--font-mono);
	font-size: 0.62rem;
	letter-spacing: 0.1em;
	color: var(--ink);
	transition: color 0.9s ease;
}

.arrow {
	font-size: 0.8em;
}

.img {
	position: relative;
	display: block;
	height: 6.5rem;
	aspect-ratio: var(--ar, 3 / 2);
	max-width: 11rem;
	border-radius: 1px;
	overflow: hidden;
	background: var(--base);
	transition: background-color 0.9s ease;
}

.img img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

/* The negative sits over the positive; printing fades it away. */
.img img.neg {
	transition: opacity 0.9s ease;
}

.positive .img img.neg {
	opacity: 0;
}

.frame:hover .img {
	box-shadow: 0 0 0 2px var(--lab-lit);
}

/* No scans yet: frames as latent images, exposed ones with their settings. */
.latent-img {
	position: absolute;
	inset: 0;
	background: var(--lab-film-frame);
}

.strip-wrap.no-scans .img {
	height: 4.4rem;
	aspect-ratio: 3 / 2;
}

.frame.shot .latent-img {
	background:
		radial-gradient(80% 70% at 40% 45%, oklch(70% 0.12 60 / 0.9), transparent 70%),
		linear-gradient(180deg, oklch(60% 0.12 55), oklch(50% 0.11 48));
}

.exp {
	min-height: 1em;
	font-family: var(--font-mono);
	font-size: 0.6rem;
	color: oklch(84% 0.02 80);
	white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
	/* The strip pulls out from the left as the page opens. */
	.strip {
		animation: pull 1.1s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: 0.15s;
	}

	@keyframes pull {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
}

@media (prefers-reduced-motion: reduce) {
	.strip,
	.edge,
	.img,
	.img img.neg {
		transition: none;
	}
}
</style>
