<template>
	<Teleport to="body">
		<Transition name="lightbox">
			<div
				v-if="isOpen"
				class="overlay"
				role="dialog"
				aria-modal="true"
				:aria-label="current?.caption || 'Photo viewer'"
				@click.self="close"
			>
				<button ref="closeButtonRef" type="button" class="control close" @click="close" aria-label="Close">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths.close"></svg>
				</button>

				<button type="button" class="control info-toggle" :class="{ active: showInfo }" @click="toggleInfo" aria-label="Toggle photo info">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths.info"></svg>
				</button>

				<button type="button" class="control nav prev" @click="prev" aria-label="Previous photo">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths['caret-left']"></svg>
				</button>
				<button type="button" class="control nav next" @click="next" aria-label="Next photo">
					<svg viewBox="0 0 256 256" class="icon" v-html="iconPaths['caret-right']"></svg>
				</button>

				<div class="stage" @touchstart="onTouchStart" @touchend="onTouchEnd">
					<div class="frame">
						<img
							:key="current?.fullUrl"
							:src="current?.fullUrl"
							:alt="current?.caption || ''"
							:style="current?.width && current?.height ? { aspectRatio: `${current.width} / ${current.height}` } : undefined"
						/>

						<div v-if="current?.caption" class="caption-scrim">
							<p class="caption">{{ current.caption }}</p>
						</div>

						<Transition name="info-panel">
							<div v-if="showInfo && current?.exif" class="info-panel">
								<dl>
									<template v-if="current.exif.camera">
										<dt>Camera</dt>
										<dd>{{ current.exif.camera }}</dd>
									</template>
									<template v-if="current.exif.lens">
										<dt>Lens</dt>
										<dd>{{ current.exif.lens }}</dd>
									</template>
									<template v-if="current.exif.focalLength">
										<dt>Focal Length</dt>
										<dd>{{ current.exif.focalLength }}</dd>
									</template>
									<template v-if="current.exif.aperture">
										<dt>Aperture</dt>
										<dd>{{ current.exif.aperture }}</dd>
									</template>
									<template v-if="current.exif.shutterSpeed">
										<dt>Shutter Speed</dt>
										<dd>{{ current.exif.shutterSpeed }}</dd>
									</template>
									<template v-if="current.exif.iso">
										<dt>ISO</dt>
										<dd>{{ current.exif.iso }}</dd>
									</template>
									<template v-if="current.exif.capturedAt">
										<dt>Captured</dt>
										<dd>{{ formattedCapturedAt }}</dd>
									</template>
								</dl>
							</div>
						</Transition>
					</div>
				</div>

				<div class="counter">{{ currentIndex + 1 }} / {{ photos.length }}</div>
			</div>
		</Transition>
	</Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { iconPaths } from './IconPaths';

const props = defineProps({
	photos: { type: Array, required: true },
});

const isOpen = ref(false);
const currentIndex = ref(0);
const showInfo = ref(false);
const closeButtonRef = ref(null);
let lastFocusedElement = null;
let touchStartX = 0;

const current = computed(() => props.photos[currentIndex.value]);

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

function preload(index) {
	const photo = props.photos[index];
	if (!photo) return;
	const img = new Image();
	img.src = photo.fullUrl;
}

function open(index) {
	lastFocusedElement = document.activeElement;
	currentIndex.value = index;
	showInfo.value = false;
	isOpen.value = true;
	document.body.style.overflow = 'hidden';
	preload(index + 1 >= props.photos.length ? 0 : index + 1);
	preload(index - 1 < 0 ? props.photos.length - 1 : index - 1);
	nextTick(() => closeButtonRef.value?.focus());
}

function close() {
	isOpen.value = false;
	showInfo.value = false;
	document.body.style.overflow = '';
	if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function next() {
	currentIndex.value = (currentIndex.value + 1) % props.photos.length;
	showInfo.value = false;
	preload(currentIndex.value + 1 >= props.photos.length ? 0 : currentIndex.value + 1);
}

function prev() {
	currentIndex.value = (currentIndex.value - 1 + props.photos.length) % props.photos.length;
	showInfo.value = false;
	preload(currentIndex.value - 1 < 0 ? props.photos.length - 1 : currentIndex.value - 1);
}

function toggleInfo() {
	showInfo.value = !showInfo.value;
}

function onKeydown(e) {
	if (!isOpen.value) return;
	if (e.key === 'Escape') close();
	else if (e.key === 'ArrowLeft') prev();
	else if (e.key === 'ArrowRight') next();
	else if (e.key === 'i' || e.key === '?') toggleInfo();
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

function onOpenLightbox(e) {
	open(e.detail.index);
}

onMounted(() => {
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('open-lightbox', onOpenLightbox);
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('open-lightbox', onOpenLightbox);
	document.body.style.overflow = '';
});
</script>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	z-index: 100000;
	display: grid;
	grid-template-rows: 1fr auto;
	place-items: center;
	background: rgba(9, 11, 17, 0.92);
	backdrop-filter: blur(4px);
}

.stage {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 100%;
	padding: 4rem 1.5rem;
}

.frame {
	position: relative;
	display: inline-flex;
	max-width: 100%;
	max-height: 100%;
}

.frame img {
	display: block;
	max-width: 100%;
	max-height: calc(100vh - 8rem);
	object-fit: contain;
	border-radius: 0.5rem;
	box-shadow: var(--shadow-lg);
}

.caption-scrim {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 3rem 1.5rem 1.25rem;
	background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
	opacity: 0.85;
	pointer-events: none;
	border-radius: 0 0 0.5rem 0.5rem;
}

.caption {
	margin: 0;
	color: var(--gray-0, #fff);
	font-family: var(--font-brand);
	font-size: var(--text-md);
	text-align: center;
}

.control {
	position: absolute;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 0;
	border-radius: 999rem;
	padding: 0.625rem;
	color: var(--gray-100, #eee);
	background: radial-gradient(var(--gray-900, #222), var(--gray-800, #333) 150%);
	box-shadow: var(--shadow-md);
	cursor: pointer;
	transition: color var(--theme-transition, 0.2s ease-in-out);
	z-index: 1;
}

.control:hover,
.control:focus-visible {
	color: var(--gray-0, #fff);
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
	right: 4.5rem;
}

.info-toggle.active {
	color: var(--accent-text-over, #fff);
	background: var(--accent-regular, #7c5cff);
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

.counter {
	padding-bottom: 1rem;
	color: var(--gray-400, #999);
	font-family: var(--font-brand);
	font-size: var(--text-sm);
}

.info-panel {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	max-height: 60%;
	overflow-y: auto;
	padding: 1.5rem;
	background: var(--gray-999, #0a0a0f);
	border-top: 1px solid var(--gray-800, #333);
	border-radius: 0.75rem 0.75rem 0 0;
}

.info-panel dl {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.5rem 1.5rem;
	margin: 0;
	font-size: var(--text-sm);
}

.info-panel dt {
	color: var(--gray-400, #999);
}

.info-panel dd {
	margin: 0;
	color: var(--gray-100, #eee);
	text-align: right;
}

.lightbox-enter-active,
.lightbox-leave-active {
	transition: opacity 0.2s ease-in-out;
}

.lightbox-enter-from,
.lightbox-leave-to {
	opacity: 0;
}

.info-panel-enter-active,
.info-panel-leave-active {
	transition: transform 0.2s ease-in-out, opacity 0.2s ease-in-out;
}

.info-panel-enter-from,
.info-panel-leave-to {
	transform: translateY(100%);
	opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
	.lightbox-enter-active,
	.lightbox-leave-active,
	.info-panel-enter-active,
	.info-panel-leave-active {
		transition: none;
	}
}

@media (min-width: 50em) {
	.stage {
		padding: 5rem 6rem;
	}
}
</style>
