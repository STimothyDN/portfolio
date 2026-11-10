<template>
	<!-- Native <dialog>: it opens in the top layer, so no Teleport (see the
	     Teleport hydration trap) and the browser handles focus and Esc. -->
	<dialog ref="el" class="lab-dialog" :class="{ wide }" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @close="!props.open || emit('close')" @click="onBackdrop">
		<div class="dialog-card">
			<header class="dialog-head">
				<h2 :id="titleId" class="lab-h2">{{ title }}</h2>
				<button type="button" class="dialog-x" aria-label="Close" @click="emit('close')">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</header>
			<slot />
		</div>
	</dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, useId, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const el = ref<HTMLDialogElement | null>(null);
const titleId = useId();

function sync() {
	const d = el.value;
	if (!d) return;
	if (props.open && !d.open) d.showModal();
	else if (!props.open && d.open) d.close();
}

watch(() => props.open, sync);
onMounted(sync);

// A click on the backdrop (the dialog element itself, outside the card) closes it.
function onBackdrop(e: MouseEvent) {
	if (e.target === el.value) emit('close');
}
</script>

<style scoped>
/* A slip off the lab's pad: warm card stock under a strip of leader. */
.lab-dialog {
	/* The site's reset zeroes margins; the browser centres modal dialogs with margin: auto. */
	margin: auto;
	width: min(32rem, calc(100vw - 1.5rem));
	max-height: calc(100dvh - 2rem);
	padding: 0;
	border: 0;
	border-radius: 0.6rem;
	background:
		radial-gradient(circle at 1px 1px, oklch(0% 0 0 / 0.02) 0.6px, transparent 1px) 0 0 / 3px 3px,
		color-mix(in oklch, var(--gray-999) 94%, oklch(92% 0.04 85));
	color: var(--gray-200);
	box-shadow:
		0 0 0 1px color-mix(in oklch, var(--gray-0) 8%, transparent),
		0 30px 60px -24px rgb(0 0 0 / 0.55);
	overflow: auto;
}

:root.theme-dark .lab-dialog {
	background:
		radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.025) 0.6px, transparent 1px) 0 0 / 3px 3px,
		oklch(17% 0.008 60);
	box-shadow:
		0 0 0 1px oklch(100% 0 0 / 0.07),
		0 30px 60px -20px rgb(0 0 0 / 0.9);
}

.lab-dialog::before {
	content: '';
	position: sticky;
	top: 0;
	z-index: 1;
	display: block;
	height: 0.85rem;
	background:
		repeating-linear-gradient(90deg, oklch(84% 0.01 80) 0 0.42rem, transparent 0.42rem 0.9rem) center 0.2rem / calc(100% - 0.6rem) 0.2rem no-repeat,
		repeating-linear-gradient(90deg, oklch(84% 0.01 80) 0 0.42rem, transparent 0.42rem 0.9rem) center calc(100% - 0.2rem) / calc(100% - 0.6rem) 0.2rem no-repeat,
		var(--lab-film);
}

.lab-dialog.wide {
	width: min(46rem, calc(100vw - 1.5rem));
}

/* The room dims, as if the safelight came on. */
.lab-dialog::backdrop {
	background: radial-gradient(120% 90% at 50% 40%, oklch(20% 0.03 40 / 0.35), oklch(12% 0.04 30 / 0.6));
	backdrop-filter: blur(2px);
}

.dialog-card {
	display: grid;
	gap: 1.1rem;
	padding: 1.25rem 1.4rem 1.4rem;
}

.dialog-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.dialog-x {
	display: grid;
	place-items: center;
	width: 2.25rem;
	height: 2.25rem;
	border: 0;
	border-radius: 50%;
	background: none;
	color: var(--gray-200);
	cursor: pointer;
}

.dialog-x:hover {
	background: var(--gray-900);
}

.dialog-x:focus-visible {
	outline: 2px solid var(--accent-regular);
}

.dialog-x svg {
	width: 1.1rem;
	height: 1.1rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: round;
}

@media (prefers-reduced-motion: no-preference) {
	/* Fed up out of the pad, settling square. */
	.lab-dialog[open] {
		animation: rise 0.36s cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes rise {
		from {
			opacity: 0;
			translate: 0 18px;
			rotate: -1.2deg;
		}
	}

	.lab-dialog[open]::backdrop {
		animation: dim 0.3s ease-out;
	}

	@keyframes dim {
		from {
			opacity: 0;
		}
	}
}
</style>
