<template>
	<span class="count-up">{{ shown }}</span>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

/** A number that winds up to its value once, like a frame counter after loading film. */
const props = defineProps<{ value: number; format?: (n: number) => string }>();
const fmt = (n: number) => (props.format ? props.format(n) : Math.round(n).toLocaleString('en-US'));
const shown = ref(fmt(props.value));

function run(from: number, to: number) {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) {
		shown.value = fmt(to);
		return;
	}
	const start = performance.now();
	const dur = 900;
	const tick = (now: number) => {
		const t = Math.min(1, (now - start) / dur);
		const eased = 1 - (1 - t) ** 3;
		shown.value = fmt(from + (to - from) * eased);
		if (t < 1) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

onMounted(() => run(0, props.value));
watch(
	() => props.value,
	(to, from) => run(from ?? 0, to)
);
</script>

<style scoped>
.count-up {
	font-variant-numeric: tabular-nums;
}
</style>
