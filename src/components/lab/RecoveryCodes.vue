<template>
	<div class="codes">
		<p class="lab-hint">
			If you can’t use a passkey (a lost phone, a borrowed computer, a preview deployment), sign in with your
			email and one of these. Each works once. They won’t be shown again.
		</p>
		<ol class="code-list lab-mono" aria-label="Recovery codes">
			<li v-for="c in codes" :key="c">{{ c }}</li>
		</ol>
		<div class="lab-actions">
			<button type="button" class="lab-btn lab-btn--quiet" @click="copy">{{ copied ? 'Copied' : 'Copy all' }}</button>
			<a class="lab-btn lab-btn--quiet" :href="fileHref" download="film-lab-recovery-codes.txt">Save as text file</a>
		</div>
		<label class="saved">
			<input id="lab-codes-saved" v-model="saved" type="checkbox" />
			<span>I’ve saved these somewhere safe</span>
		</label>
		<button type="button" class="lab-btn" :disabled="!saved" @click="emit('done')">{{ doneLabel }}</button>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ codes: string[]; doneLabel: string }>();
const emit = defineEmits<{ done: [] }>();

const saved = ref(false);
const copied = ref(false);
const text = computed(
	() => `Film Lab recovery codes (timo3.dev)\nEach code works once.\n\n${props.codes.join('\n')}\n`
);
const fileHref = computed(() => `data:text/plain;charset=utf-8,${encodeURIComponent(text.value)}`);

async function copy() {
	try {
		await navigator.clipboard.writeText(text.value);
		copied.value = true;
	} catch {
		copied.value = false;
	}
}
</script>

<style scoped>
.codes {
	display: grid;
	gap: 1rem;
	justify-items: start;
}

.code-list {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.5rem 1.5rem;
	width: 100%;
	padding: 1rem 1.25rem;
	list-style: none;
	border: 1px dashed var(--gray-600);
	border-radius: 0.6rem;
	font-size: 1rem;
	letter-spacing: 0.08em;
	color: var(--gray-0);
	font-variant-numeric: tabular-nums;
}

.saved {
	display: flex;
	gap: 0.6rem;
	align-items: center;
	font-size: var(--text-base);
}

.saved input {
	width: 1.1rem;
	height: 1.1rem;
	accent-color: var(--accent-regular);
}
</style>
