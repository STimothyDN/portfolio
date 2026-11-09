<template>
	<div class="import">
		<button type="button" class="lab-btn" :class="{ 'lab-btn--ghost': quiet }" :disabled="busy || done" @click="importNow">
			{{ busy ? 'Importing…' : done ? 'Imported' : `Import ${count} ${count === 1 ? 'roll' : 'rolls'} from the film desk` }}
		</button>
		<p v-if="summary" class="lab-hint" role="status">{{ summary }}</p>
		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
	</div>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { ref } from 'vue';

import { run } from '../../lib/lab/client';

defineProps<{ count: number; quiet?: boolean }>();

const busy = ref(false);
const done = ref(false);
const summary = ref('');
const error = ref('');

async function importNow() {
	busy.value = true;
	error.value = '';
	try {
		const r = await run(actions.lab.importFromDesk());
		done.value = true;
		summary.value = `Added ${r.rolls} rolls, ${r.cameras} cameras, ${r.stocks} film stocks and ${r.labs} labs. Reloading…`;
		setTimeout(() => location.reload(), 900);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.import {
	display: grid;
	gap: 0.6rem;
	justify-items: start;
}
</style>
