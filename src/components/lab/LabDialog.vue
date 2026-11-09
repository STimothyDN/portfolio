<template>
	<!-- Native <dialog>: it opens in the top layer, so no Teleport (see the
	     Teleport hydration trap) and the browser handles focus and Esc. -->
	<dialog ref="el" class="lab-dialog" :class="{ wide }" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @click="onBackdrop">
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
.lab-dialog {
	/* The site's reset zeroes margins; the browser centres modal dialogs with margin: auto. */
	margin: auto;
	width: min(32rem, calc(100vw - 1.5rem));
	max-height: calc(100dvh - 2rem);
	padding: 0;
	border: 1px solid var(--gray-800);
	border-radius: 1rem;
	background: var(--gray-999);
	color: var(--gray-200);
	box-shadow: var(--shadow-lg);
	overflow: auto;
}

.lab-dialog.wide {
	width: min(46rem, calc(100vw - 1.5rem));
}

.lab-dialog::backdrop {
	background: rgb(0 0 0 / 0.35);
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
	.lab-dialog[open] {
		animation: rise 0.22s cubic-bezier(0.33, 1, 0.68, 1);
	}

	@keyframes rise {
		from {
			opacity: 0;
			translate: 0 8px;
		}
	}
}
</style>
