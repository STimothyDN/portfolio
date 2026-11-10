<script setup lang="ts">
/**
 * The SVG filters that turn scans into negatives (the film desk's own model,
 * negative.ts), one per film profile and exposure in use. Anything showing a
 * negative points at `url(#film-neg-…)`; this renders each filter once.
 */
import { computed } from 'vue';

import { negativeFilter, type NegativeProfileKey } from '../../film/negative';

const props = defineProps<{ uses: { profile: NegativeProfileKey; exposure: number }[] }>();

const filters = computed(() => {
	const seen = new Set<string>();
	const out: ReturnType<typeof negativeFilter>[] = [];
	for (const u of props.uses) {
		const key = `${u.profile}:${u.exposure}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(negativeFilter(u.profile, u.exposure));
	}
	return out;
});
</script>

<template>
	<svg v-if="filters.length" class="neg-defs" aria-hidden="true" focusable="false">
		<filter v-for="f in filters" :id="f.id" :key="f.id" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
			<feColorMatrix v-if="f.mono" type="saturate" values="0" />
			<feComponentTransfer>
				<feFuncR type="table" :tableValues="f.density[0]" />
				<feFuncG type="table" :tableValues="f.density[1]" />
				<feFuncB type="table" :tableValues="f.density[2]" />
			</feComponentTransfer>
			<feColorMatrix type="matrix" :values="f.matrix" />
			<feComponentTransfer>
				<feFuncR type="table" :tableValues="f.transmit[0]" />
				<feFuncG type="table" :tableValues="f.transmit[1]" />
				<feFuncB type="table" :tableValues="f.transmit[2]" />
			</feComponentTransfer>
		</filter>
	</svg>
</template>

<style scoped>
.neg-defs {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
}
</style>
