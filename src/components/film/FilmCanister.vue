<template>
	<!-- A standing 35mm canister labeled with its film stock. Every dimension
	     follows --can-h, so the same can works in the roll selector and, much
	     larger, at the head of a roll's negatives on the desk. -->
	<span class="canister" :style="style" aria-hidden="true">
		<span class="can-spool"></span>
		<span class="can-cap"></span>
		<span class="can-body">
			<span class="can-label">
				<span v-for="(line, n) in label.lines" :key="n">{{ line }}</span>
			</span>
		</span>
		<span class="can-cap"></span>
		<span class="can-lip"></span>
	</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { canLabel, canisterColors } from './canister';

const props = defineProps<{ stock: string; stockLabel: string }>();

const label = computed(() => canLabel(props.stockLabel));
const style = computed(() => {
	const { can, ink } = canisterColors(props);
	return { '--can': can, '--can-ink': ink, '--label-fit': label.value.fit.toFixed(3) };
});
</script>

<style scoped>
.canister {
	/* Proportions of a real 35mm can, all from its height (set by the parent). */
	--can-w: calc(var(--can-h, 102px) * 0.43);
	--cap-h: calc(var(--can-h, 102px) * 0.069);
	--label-room: calc(var(--can-h, 102px) * 0.725);
	position: relative;
	display: flex;
	flex: none;
	flex-direction: column;
	align-items: center;
	width: var(--can-w);
	height: var(--can-h, 102px);
}

/* Cylinder shading shared by spool, caps and body. */
.can-cap,
.can-body,
.can-spool {
	background-image: linear-gradient(
		90deg,
		rgba(0, 0, 0, 0.32) 0%,
		rgba(255, 255, 255, 0.34) 28%,
		rgba(255, 255, 255, 0.08) 52%,
		rgba(0, 0, 0, 0.36) 100%
	);
}

.can-spool {
	flex: none;
	width: 34%;
	height: var(--cap-h);
	border-radius: 2px 2px 0 0;
	background-color: #3b3632;
}

.can-cap {
	flex: none;
	width: 100%;
	height: var(--cap-h);
	border-radius: calc(var(--cap-h) * 0.43);
	background-color: #b9b4aa;
}

.can-body {
	position: relative;
	display: grid;
	place-items: center;
	flex: 1;
	width: calc(100% - var(--can-w) * 0.09);
	overflow: hidden;
	background-color: var(--can);
}

.can-label {
	display: flex;
	flex-direction: column;
	align-items: center;
	writing-mode: vertical-rl;
	rotate: 180deg;
	color: var(--can-ink);
	font-family: var(--font-brand);
	font-size: calc(var(--label-room) * var(--label-fit));
	font-weight: 700;
	line-height: 1.05;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	white-space: nowrap;
}

/* Felt light-trap the film slides out through. */
.can-lip {
	position: absolute;
	top: calc(var(--can-h, 102px) * 0.196);
	bottom: calc(var(--can-h, 102px) * 0.118);
	right: calc(var(--can-w) * -0.045);
	width: calc(var(--can-w) * 0.115);
	border-radius: 2px;
	background: #120f0d;
}
</style>
