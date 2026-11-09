<template>
	<div class="dial-wrap">
		<div class="dial-label">
			<span :id="labelId">{{ label }}</span>
			<span>{{ hint }}</span>
		</div>
		<div ref="track" class="dial" role="radiogroup" :aria-labelledby="labelId" @keydown="onKey">
			<button
				v-for="(opt, i) in options"
				:key="String(opt.value)"
				type="button"
				role="radio"
				:aria-checked="isSelected(opt.value)"
				:tabindex="isSelected(opt.value) || (selectedIndex === -1 && i === 0) ? 0 : -1"
				:data-i="i"
				@click="choose(opt.value)"
			>
				{{ opt.label }}
			</button>
		</div>
	</div>
</template>

<script setup lang="ts" generic="T extends string | number | null">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';

const props = defineProps<{ label: string; hint?: string; options: { value: T; label: string }[]; modelValue: T }>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();

const track = ref<HTMLElement | null>(null);
const labelId = useId();
const isSelected = (v: T) => v === props.modelValue;
const selectedIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

function choose(v: T) {
	emit('update:modelValue', v);
}

/** Keep the chosen value in the middle of the strip, like a dial's index mark. */
function center(smooth = true) {
	const el = track.value?.querySelector<HTMLElement>(`[data-i="${selectedIndex.value}"]`);
	if (!el || !track.value) return;
	const left = el.offsetLeft - (track.value.clientWidth - el.clientWidth) / 2;
	track.value.scrollTo({ left, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}

function onKey(e: KeyboardEvent) {
	const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
	if (!step) return;
	e.preventDefault();
	const i = Math.min(props.options.length - 1, Math.max(0, selectedIndex.value + step));
	choose(props.options[i].value);
	nextTick(() => track.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus());
}

watch(() => props.modelValue, () => nextTick(() => center()));
watch(() => props.options, () => nextTick(() => center(false)));
onMounted(() => center(false));
</script>

<style scoped>
.dial-wrap {
	display: grid;
	gap: 0.3rem;
}

.dial-label {
	display: flex;
	justify-content: space-between;
	font-size: var(--text-sm);
	letter-spacing: 0.1em;
	font-variant-caps: all-small-caps;
	color: var(--shoot-meta);
}

.dial {
	/* Offsets for centring are measured from the strip itself. */
	position: relative;
	display: flex;
	gap: 0.15rem;
	overflow-x: auto;
	scrollbar-width: none;
	padding-inline: 40%;
	border-block: 1px solid var(--shoot-line);
	/* Tick marks along the bottom, like a dial's scale. */
	background: repeating-linear-gradient(90deg, var(--shoot-line) 0 1px, transparent 1px 8px) bottom / 100% 5px no-repeat;
	-webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
	mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}

.dial::-webkit-scrollbar {
	display: none;
}

.dial button {
	flex: none;
	min-width: 3.1rem;
	min-height: 2.9rem;
	padding: 0 0.3rem;
	border: 0;
	background: none;
	color: var(--shoot-meta);
	font-family: var(--font-mono);
	font-size: 0.95rem;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
}

.dial button[aria-checked='true'] {
	color: var(--shoot-ink);
	font-size: 1.15rem;
	font-weight: 600;
	box-shadow: inset 0 -2px 0 var(--shoot-mark);
}

.dial button:focus-visible {
	outline: 2px solid var(--shoot-mark);
	outline-offset: -2px;
}
</style>
