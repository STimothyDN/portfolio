<template>
	<!-- Which lens is on the camera: only lenses on its mount; the one it last shot with comes first. -->
	<label v-if="fits.length" class="lab-field lens-pick">
		<span>{{ label }}</span>
		<select :id="id" :value="modelValue ?? ''" :class="selectClass" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || null)">
			<option value="">Not noted</option>
			<option v-for="l in fits" :key="l.id" :value="l.id">{{ l.name }}{{ l.id === last ? ' · last used' : '' }}</option>
		</select>
	</label>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';

import { lensesFor } from '../../lib/lab/inventory';

const props = withDefaults(
	defineProps<{
		modelValue: string | null;
		lenses: { id: string; name: string; mount: string; status?: string }[];
		mount: string | null | undefined;
		/** The lens last used on this camera. */
		last?: string | null;
		id?: string;
		label?: string;
		selectClass?: string;
		/** Fill in the likely lens when none is chosen yet. */
		autofill?: boolean;
	}>(),
	{ last: null, id: 'lens-pick', label: 'Lens on it', selectClass: 'lab-input lab-select', autofill: true }
);
const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>();

const fits = computed(() => {
	const list = lensesFor(props.lenses, props.mount);
	return [...list].sort((a, b) => Number(b.id === props.last) - Number(a.id === props.last));
});

/** The likely lens: the one it last shot with, or the only one that fits. */
const likely = () => (props.last && fits.value.some((l) => l.id === props.last) ? props.last : fits.value.length === 1 ? fits.value[0].id : null);
onMounted(() => {
	if (props.autofill && !props.modelValue && likely()) emit('update:modelValue', likely());
});
defineExpose({ likely });
</script>
