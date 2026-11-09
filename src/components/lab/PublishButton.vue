<template>
	<span class="publish">
		<button type="button" class="lab-btn" :class="{ 'lab-btn--quiet': quiet }" :disabled="busy || done" @click="publish">
			{{ done ? 'Publishing…' : 'Publish to portfolio' }}
		</button>
		<span v-if="message" class="lab-meta" :class="{ 'lab-error': failed }" role="status">{{ message }}</span>
	</span>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { ref } from 'vue';

import { run } from '../../lib/lab/client';

defineProps<{ quiet?: boolean }>();

const busy = ref(false);
const done = ref(false);
const failed = ref(false);
const message = ref('');

async function publish() {
	busy.value = true;
	failed.value = false;
	try {
		await run(actions.lab.publishSite());
		done.value = true;
		message.value = 'The film desk shows it in a minute or two.';
	} catch (e) {
		failed.value = true;
		message.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.publish {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem 0.75rem;
}
</style>
