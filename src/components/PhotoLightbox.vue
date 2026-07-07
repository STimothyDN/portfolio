<template>
	<Teleport to="body">
		<Transition name="lightbox">
			<div
				v-if="isOpen"
				ref="overlayRef"
				class="overlay"
				:class="{ 'chrome-hidden': !chromeVisible, 'info-open': showInfo && hasInfo }"
				role="dialog"
				aria-modal="true"
				:aria-label="current?.caption || 'Photo viewer'"
				@click.self="close"
				@mousemove="wakeChrome"
			>
				<!-- Darkroom ambience: the photo's own colors, projected out of focus
				     behind the print. Crossfades between photos via the cached thumb. -->
				<div class="backdrop" aria-hidden="true">
					<Transition name="ambient">
						<div
							class="ambient"
							:key="current?.thumbUrl"
							:style="{ backgroundImage: `url(${current?.thumbUrl})` }"
						></div>
					</Transition>
					<div class="backdrop-scrim"></div>
				</div>

				<button ref="closeButtonRef" type="button" class="control close" @click="close" aria-label="Close">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths.close"></svg>
				</button>

				<button
					v-if="hasInfo"
					type="button"
					class="control info-toggle"
					:class="{ active: showInfo }"
					:aria-expanded="showInfo"
					aria-controls="lightbox-info"
					@click="toggleInfo"
					aria-label="Toggle photo info"
				>
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths.info"></svg>
				</button>

				<button type="button" class="control nav prev" @click="prev" aria-label="Previous photo">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths['caret-left']"></svg>
				</button>
				<button type="button" class="control nav next" @click="next" aria-label="Next photo">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths['caret-right']"></svg>
				</button>

				<div class="stage" @click.self="close" @touchstart="onTouchStart" @touchend="onTouchEnd">
					<figure class="frame">
						<div class="print">
							<Transition :name="`photo-${direction}`">
								<div class="photo" :class="{ 'is-loaded': loadedSrc === current?.fullUrl }" :key="current?.fullUrl">
									<!-- Blur-up: the grid thumb holds the frame while the full
									     print decodes, then the sharp image fades over it. The
									     aspect-ratio keeps the box (and placeholder) sized
									     before the full image arrives. -->
									<div class="photo-thumb" :style="{ backgroundImage: `url(${current?.thumbUrl})` }"></div>
									<img
										:src="current?.fullUrl"
										:alt="current?.caption || ''"
										decoding="async"
										:style="current?.width && current?.height ? { aspectRatio: `${current.width} / ${current.height}` } : undefined"
										@load="loadedSrc = current?.fullUrl"
									/>
								</div>
							</Transition>
						</div>
						<figcaption class="plate-line">
							<span v-if="current?.caption" class="plate-caption">{{ current.caption }}</span>
							<span v-else class="plate-caption plate-caption--empty">Untitled</span>
							<span class="plate-counter">{{ pad(currentIndex + 1) }} — {{ pad(list.length) }}</span>
						</figcaption>
					</figure>
				</div>

				<!-- Metadata rail: beside the print on wide screens, a bottom sheet on
				     small ones — never over the photograph. -->
				<Transition name="rail">
					<aside v-if="showInfo && hasInfo" id="lightbox-info" class="rail">
						<header class="rail-head">
							<p class="rail-eyebrow">Plate {{ pad(currentIndex + 1) }} of {{ pad(list.length) }}</p>
							<h2 v-if="current?.caption" class="rail-caption">{{ current.caption }}</h2>
						</header>

						<div v-if="triad.length" class="rail-triad" :style="{ '--triad-cols': Math.min(triad.length, 2) }">
							<div v-for="t in triad" :key="t.label" class="triad-cell">
								<span class="triad-value">{{ t.value }}</span>
								<span class="triad-label">{{ t.label }}</span>
							</div>
						</div>

						<dl class="rail-specs">
							<div v-if="current?.exif?.camera" class="spec">
								<dt>Camera</dt>
								<dd>{{ current.exif.camera }}</dd>
							</div>
							<div v-if="current?.exif?.lens" class="spec">
								<dt>Lens</dt>
								<dd>{{ current.exif.lens }}</dd>
							</div>
							<div v-if="formattedCapturedAt" class="spec">
								<dt>Captured</dt>
								<dd>{{ formattedCapturedAt }}</dd>
							</div>
							<div v-if="formattedLocation" class="spec">
								<dt>Location</dt>
								<dd>
									{{ formattedLocation }}
									<a v-if="mapUrl" class="map-link" :href="mapUrl" target="_blank" rel="noopener">
										Open in Maps&nbsp;&#8599;
									</a>
								</dd>
							</div>
						</dl>
					</aside>
				</Transition>

				<div class="sr-only" aria-live="polite">
					Photo {{ currentIndex + 1 }} of {{ list.length }}{{ current?.caption ? `: ${current.caption}` : '' }}
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { iconPaths } from './IconPaths';

const props = defineProps({
	// Single-shoot mode (static shoot pages): one photo list.
	photos: { type: Array, default: () => [] },
	// Multi-shoot mode (photography index): slug → photo list. One lightbox
	// instance serves every inline shoot panel; open-lightbox events carry the
	// slug that picks the active set.
	photoSets: { type: Object, default: null },
	// In single-shoot mode, ignore events tagged for another shoot.
	shootSlug: { type: String, default: '' },
});

const isOpen = ref(false);
const currentIndex = ref(0);
const showInfo = ref(false);
const chromeVisible = ref(true);
const direction = ref('next');
const loadedSrc = ref('');
const closeButtonRef = ref(null);
const overlayRef = ref(null);
const activeSet = ref(null);
let lastFocusedElement = null;
let touchStartX = 0;
let idleTimer = null;

const canIdleHide =
	typeof window !== 'undefined' &&
	window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches;

const list = computed(() => activeSet.value ?? props.photos);
const current = computed(() => list.value[currentIndex.value]);
const hasInfo = computed(() => Boolean(current.value?.exif || current.value?.location));

const pad = (n) => String(n).padStart(2, '0');

// The photographic triad (+ focal length) — the numbers photographers reach
// for first, shown as a camera-style settings plate.
const triad = computed(() => {
	const exif = current.value?.exif;
	if (!exif) return [];
	return [
		{ label: 'Aperture', value: exif.aperture },
		{ label: 'Shutter', value: exif.shutterSpeed },
		{ label: 'ISO', value: exif.iso },
		{ label: 'Focal Length', value: exif.focalLength },
	].filter((t) => t.value);
});

const formattedCapturedAt = computed(() => {
	if (!current.value?.exif?.capturedAt) return '';
	const date = new Date(current.value.exif.capturedAt);
	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
});

const formattedLocation = computed(() => {
	const location = current.value?.location;
	if (!location) return '';
	if (location.name) return location.name;
	if (location.latitude === undefined || location.longitude === undefined) return '';
	return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
});

const mapUrl = computed(() => {
	const location = current.value?.location;
	if (!location || location.latitude === undefined || location.longitude === undefined) return '';
	return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
});

// The chrome (controls + plate line) sleeps after a beat of stillness so the
// photograph stands alone; any movement or key press wakes it.
function wakeChrome() {
	chromeVisible.value = true;
	if (!canIdleHide) return;
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		if (!showInfo.value) chromeVisible.value = false;
	}, 2400);
}

function preload(index) {
	const photo = list.value[index];
	if (!photo) return;
	const img = new Image();
	img.src = photo.fullUrl;
}

function open(index) {
	lastFocusedElement = document.activeElement;
	currentIndex.value = index;
	direction.value = 'next';
	showInfo.value = false;
	isOpen.value = true;
	document.body.style.overflow = 'hidden';
	preload(index + 1 >= list.value.length ? 0 : index + 1);
	preload(index - 1 < 0 ? list.value.length - 1 : index - 1);
	wakeChrome();
	nextTick(() => closeButtonRef.value?.focus());
}

function close() {
	isOpen.value = false;
	showInfo.value = false;
	clearTimeout(idleTimer);
	document.body.style.overflow = '';
	if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function next() {
	direction.value = 'next';
	currentIndex.value = (currentIndex.value + 1) % list.value.length;
	preload(currentIndex.value + 1 >= list.value.length ? 0 : currentIndex.value + 1);
	wakeChrome();
}

function prev() {
	direction.value = 'prev';
	currentIndex.value = (currentIndex.value - 1 + list.value.length) % list.value.length;
	preload(currentIndex.value - 1 < 0 ? list.value.length - 1 : currentIndex.value - 1);
	wakeChrome();
}

function toggleInfo() {
	showInfo.value = !showInfo.value;
	wakeChrome();
}

// Keep Tab cycling inside the dialog while it is open.
function trapFocus(e) {
	const root = overlayRef.value;
	if (!root) return;
	const focusables = [...root.querySelectorAll('button, a[href]')].filter(
		(el) => !el.disabled && el.getClientRects().length
	);
	if (!focusables.length) return;
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

function onKeydown(e) {
	if (!isOpen.value) return;
	if (e.key === 'Escape') {
		// Layered: first Escape puts the rail away, the next leaves the room.
		if (showInfo.value) showInfo.value = false;
		else close();
	} else if (e.key === 'ArrowLeft') prev();
	else if (e.key === 'ArrowRight') next();
	else if (e.key === 'i' || e.key === '?') toggleInfo();
	else if (e.key === 'Tab') trapFocus(e);
	if (e.key !== 'Tab') wakeChrome();
}

function onTouchStart(e) {
	touchStartX = e.changedTouches[0].clientX;
}

function onTouchEnd(e) {
	const delta = e.changedTouches[0].clientX - touchStartX;
	if (Math.abs(delta) < 50) return;
	if (delta < 0) next();
	else prev();
}

function resolveAndOpen(detail) {
	if (props.photoSets) {
		const set = detail?.shootSlug ? props.photoSets[detail.shootSlug] : null;
		if (!set) return false;
		activeSet.value = set;
	} else if (props.shootSlug && detail?.shootSlug && detail.shootSlug !== props.shootSlug) {
		return false;
	}
	open(detail?.index ?? 0);
	return true;
}

function onOpenLightbox(e) {
	if (resolveAndOpen(e.detail)) window.__pendingLightbox = null;
}

onMounted(() => {
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('open-lightbox', onOpenLightbox);
	// A tile clicked before this island hydrated buffers its request
	// (PhotoGrid.astro); honor it now so the click isn't silently lost.
	const pending = window.__pendingLightbox;
	if (pending && Date.now() - pending.t < 5000 && resolveAndOpen(pending)) {
		window.__pendingLightbox = null;
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('open-lightbox', onOpenLightbox);
	clearTimeout(idleTimer);
	document.body.style.overflow = '';
});
</script>

<style scoped>
/*
 * The lightbox is deliberately theme-independent: photographs are viewed in a
 * darkroom regardless of the page's light/dark choice, so every surface here
 * uses fixed warm-black ink values instead of the palette tokens.
 */
.overlay {
	position: fixed;
	inset: 0;
	z-index: 100000;
	background: #0c0b0a;
}

.backdrop {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
}

.ambient {
	position: absolute;
	inset: -10%;
	background-position: center;
	background-size: cover;
	filter: blur(64px) saturate(1.25) brightness(0.4);
	transform: scale(1.1);
}

.backdrop-scrim {
	position: absolute;
	inset: 0;
	background: radial-gradient(ellipse 120% 100% at 50% 45%, rgba(12, 11, 10, 0.25) 40%, rgba(12, 11, 10, 0.72) 100%);
}

.stage {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 4rem 1.25rem 2.5rem;
}

.frame {
	display: flex;
	flex-direction: column;
	align-items: center;
	max-width: 100%;
	max-height: 100%;
	min-height: 0;
	margin: 0;
}

/* Shrink-to-fit chain: print and photo hug the rendered image box, so the
 * shadow, placeholder, and plate line track portrait and landscape frames. */
.print {
	position: relative;
	display: inline-flex;
	justify-content: center;
	max-width: 100%;
	min-height: 0;
}

.photo {
	position: relative;
	display: inline-flex;
	overflow: hidden;
	background: #17130f;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 32px 80px rgba(0, 0, 0, 0.55);
}

.photo img {
	position: relative;
	display: block;
	max-width: 100%;
	max-height: calc(100svh - 11rem);
	object-fit: contain;
	opacity: 0;
	transition: opacity 0.45s ease;
}

.photo.is-loaded img {
	opacity: 1;
}

/* Blur-up placeholder under the print */
.photo-thumb {
	position: absolute;
	inset: 0;
	background-position: center;
	background-size: cover;
	filter: blur(20px);
	transform: scale(1.06);
	transition: opacity 0.45s ease;
}

.photo.is-loaded .photo-thumb {
	opacity: 0;
}

/* Caption + counter live under the print, never on it */
.plate-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 2rem;
	width: 100%;
	min-width: 0;
	margin-top: 0.85rem;
	transition: opacity 0.4s ease;
}

.plate-caption {
	font-family: var(--font-body, Georgia, serif);
	font-style: italic;
	font-size: var(--text-md, 1.125rem);
	color: rgba(243, 239, 233, 0.82);
}

.plate-caption--empty {
	color: rgba(243, 239, 233, 0.4);
}

.plate-counter {
	flex-shrink: 0;
	font-size: var(--text-sm, 0.875rem);
	font-variant-caps: all-small-caps;
	letter-spacing: 0.14em;
	color: rgba(243, 239, 233, 0.55);
}

/* ── Controls: frosted glass, asleep when the cursor is ── */

.control {
	position: absolute;
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2.75rem;
	height: 2.75rem;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 999rem;
	padding: 0;
	color: #f3efe9;
	background: rgba(20, 18, 16, 0.45);
	backdrop-filter: blur(14px) saturate(1.4);
	-webkit-backdrop-filter: blur(14px) saturate(1.4);
	cursor: pointer;
	transition: opacity 0.4s ease, background 0.2s ease, border-color 0.2s ease;
}

.control:hover,
.control:focus-visible {
	background: rgba(32, 28, 24, 0.7);
	border-color: rgba(255, 255, 255, 0.3);
}

.control:focus-visible {
	outline: 2px solid rgba(243, 239, 233, 0.9);
	outline-offset: 2px;
}

.control .icon {
	width: 1.25rem;
	height: 1.25rem;
	fill: currentColor;
	stroke: currentColor;
}

.close {
	top: 1.25rem;
	right: 1.25rem;
}

.info-toggle {
	top: 1.25rem;
	right: 4.75rem;
}

.info-toggle.active {
	color: #17130f;
	background: rgba(243, 239, 233, 0.92);
	border-color: transparent;
}

.nav {
	top: 50%;
	transform: translateY(-50%);
}

.prev {
	left: 1.25rem;
}

.next {
	right: 1.25rem;
}

.chrome-hidden .control,
.chrome-hidden .plate-line {
	opacity: 0;
	pointer-events: none;
}

/* ── Metadata rail ── */

.rail {
	position: absolute;
	z-index: 4;
	right: 0;
	left: 0;
	bottom: 0;
	max-height: 62%;
	overflow-y: auto;
	padding: 1.5rem 1.5rem 2rem;
	background: rgba(18, 16, 14, 0.78);
	backdrop-filter: blur(24px) saturate(1.4);
	-webkit-backdrop-filter: blur(24px) saturate(1.4);
	border-top: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 1rem 1rem 0 0;
}

/* Sheet handle (mobile affordance) */
.rail::before {
	content: '';
	display: block;
	width: 2.25rem;
	height: 3px;
	margin: 0 auto 1.1rem;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.22);
}

.rail-eyebrow {
	margin: 0 0 0.35rem;
	font-size: 0.72rem;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.16em;
	color: rgba(243, 239, 233, 0.5);
}

.rail-caption {
	margin: 0;
	font-family: var(--font-brand, Georgia, serif);
	font-weight: 480;
	font-size: var(--text-xl, 1.4rem);
	line-height: 1.2;
	color: #f3efe9;
}

.rail-triad {
	display: grid;
	grid-template-columns: repeat(var(--triad-cols, 2), 1fr);
	gap: 1px;
	margin-top: 1.25rem;
	background: rgba(255, 255, 255, 0.1);
	border: 1px solid rgba(255, 255, 255, 0.1);
}

.triad-cell {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	padding: 0.85rem 0.9rem;
	background: rgba(14, 12, 11, 0.82);
}

.triad-value {
	font-family: var(--font-brand, Georgia, serif);
	font-size: 1.15rem;
	color: #f3efe9;
}

.triad-label {
	font-size: 0.68rem;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.14em;
	color: rgba(243, 239, 233, 0.5);
}

.rail-specs {
	display: grid;
	gap: 0.9rem;
	margin: 1.25rem 0 0;
}

.spec {
	padding-top: 0.9rem;
	border-top: 1px solid rgba(255, 255, 255, 0.09);
}

.spec dt {
	font-size: 0.72rem;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.16em;
	color: rgba(243, 239, 233, 0.5);
}

.spec dd {
	margin: 0.2rem 0 0;
	font-size: var(--text-sm, 0.875rem);
	line-height: 1.5;
	color: rgba(243, 239, 233, 0.88);
}

.map-link {
	display: inline-block;
	margin-left: 0.5rem;
	color: rgba(243, 239, 233, 0.65);
	text-decoration: 1px solid underline;
	text-underline-offset: 0.2em;
	transition: color 0.2s ease;
}

.map-link:hover,
.map-link:focus-visible {
	color: #f3efe9;
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

/* ── Transitions ── */

.lightbox-enter-active,
.lightbox-leave-active {
	transition: opacity 0.28s ease;
}

.lightbox-enter-active .frame {
	transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.lightbox-enter-from,
.lightbox-leave-to {
	opacity: 0;
}

.lightbox-enter-from .frame {
	transform: scale(0.975) translateY(10px);
}

.ambient-enter-active,
.ambient-leave-active {
	transition: opacity 0.7s ease;
}

.ambient-enter-from,
.ambient-leave-to {
	opacity: 0;
}

/* Direction-aware photo swap: incoming slides from the travel direction,
 * outgoing recedes underneath (absolute, so the frame tracks the new photo). */
.photo-next-enter-active,
.photo-prev-enter-active {
	transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.photo-next-leave-active,
.photo-prev-leave-active {
	position: absolute;
	inset: 0;
	transition: opacity 0.24s ease, transform 0.24s ease;
}

.photo-next-enter-from {
	opacity: 0;
	transform: translateX(26px);
}

.photo-prev-enter-from {
	opacity: 0;
	transform: translateX(-26px);
}

.photo-next-leave-to {
	opacity: 0;
	transform: translateX(-18px);
}

.photo-prev-leave-to {
	opacity: 0;
	transform: translateX(18px);
}

.rail-enter-active,
.rail-leave-active {
	transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease;
}

.rail-enter-from,
.rail-leave-to {
	transform: translateY(100%);
	opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
	.lightbox-enter-active,
	.lightbox-leave-active,
	.lightbox-enter-active .frame,
	.ambient-enter-active,
	.ambient-leave-active,
	.photo-next-enter-active,
	.photo-prev-enter-active,
	.photo-next-leave-active,
	.photo-prev-leave-active,
	.rail-enter-active,
	.rail-leave-active {
		transition: none;
	}
}

/* ── Wide screens: the rail stands beside the print ── */

@media (min-width: 50em) {
	.stage {
		padding: 5rem 6rem 3rem;
		transition: padding-right 0.35s cubic-bezier(0.32, 0.72, 0, 1);
	}

	.info-open .stage {
		padding-right: calc(min(21rem, 40vw) + 4rem);
	}

	/* The next-arrow steps aside as the rail slides in. */
	.next {
		transition: right 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.4s ease, background 0.2s ease,
			border-color 0.2s ease;
	}

	.info-open .next {
		right: calc(min(21rem, 40vw) + 1.25rem);
	}

	.rail {
		left: auto;
		top: 0;
		bottom: 0;
		width: min(21rem, 40vw);
		max-height: none;
		padding: 5rem 1.75rem 2rem;
		border-top: 0;
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0;
	}

	.rail::before {
		display: none;
	}

	.rail-enter-from,
	.rail-leave-to {
		transform: translateX(100%);
		opacity: 1;
	}
}
</style>
