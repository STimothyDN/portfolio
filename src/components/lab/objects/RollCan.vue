<script setup lang="ts">
/**
 * One roll as a canister: the film desk's can, with its code on a strip of
 * masking tape (as written in marker) and, optionally, a note on a tag. Lying
 * down, it's a shot roll rolled loose in a tray.
 */
import FilmCanister from '../../film/FilmCanister.vue';
import type { RollView } from '../../../lib/lab/inventory';

withDefaults(
	defineProps<{
		roll: Pick<RollView, 'code' | 'stock'>;
		/** Canister height, px. */
		size?: number;
		lying?: boolean;
		tag?: string | null;
		tone?: 'warn' | 'soon' | null;
		/** Tilt, degrees (lying canisters land at an angle). */
		tilt?: number;
	}>(),
	{ size: 64, lying: false, tag: null, tone: null, tilt: 0 }
);
</script>

<template>
	<span class="roll-can" :class="{ lying }" :style="{ '--can-h': `${size}px`, '--tilt': `${tilt}deg` }">
		<span class="body">
			<FilmCanister :stock="roll.stock.token ?? roll.stock.id" :stock-label="roll.stock.name" :stock-brand="roll.stock.brand" />
			<span class="tape">{{ roll.code }}</span>
		</span>
		<span v-if="tag" class="tag" :class="tone">{{ tag }}</span>
	</span>
</template>

<style scoped>
.roll-can {
	position: relative;
	display: inline-grid;
	justify-items: center;
	gap: 0.3rem;
}

.body {
	position: relative;
	display: block;
	filter: drop-shadow(-2px 3px 2px oklch(20% 0.02 60 / 0.3));
	rotate: var(--tilt);
}

.lying .body {
	/* On its side, rolled a little. */
	rotate: calc(-90deg + var(--tilt));
	margin-block: calc(var(--can-h) * -0.28);
}

.tape {
	position: absolute;
	left: 50%;
	top: 74%;
	translate: -50% -50%;
	rotate: -4deg;
	padding: 0.05rem 0.3rem 0;
	background: oklch(93% 0.035 88 / 0.94);
	box-shadow: 0 1px 1px oklch(30% 0.03 60 / 0.25);
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: max(0.58rem, calc(var(--can-h) * 0.15));
	line-height: 1.15;
	color: oklch(20% 0.01 60);
	white-space: nowrap;
	clip-path: polygon(2% 8%, 98% 0, 100% 92%, 1% 100%);
}

.lying .tape {
	rotate: calc(90deg - var(--tilt) - 3deg);
}

.tag {
	font-family: var(--font-mono);
	font-size: 0.6rem;
	letter-spacing: 0.06em;
	white-space: nowrap;
	color: var(--lab-bench-ink, var(--gray-300));
}

.tag.warn {
	color: var(--lab-warn);
}

.tag.soon {
	color: var(--lab-edge-text);
}
</style>
