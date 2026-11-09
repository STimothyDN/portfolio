<template>
	<div class="ff">
		<label class="lab-field">
			<span>Frame</span>
			<input :id="`${uid}-n`" v-model.number="model.number" class="lab-input" type="number" min="-1" max="200" />
		</label>
		<label class="lab-field">
			<span>Aperture</span>
			<select :id="`${uid}-a`" v-model="model.aperture" class="lab-input lab-select">
				<option :value="null">Auto / not noted</option>
				<option v-for="a in APERTURES" :key="a" :value="a">{{ formatAperture(a) }}</option>
			</select>
		</label>
		<label class="lab-field">
			<span>Shutter</span>
			<select :id="`${uid}-s`" v-model="model.shutter" class="lab-input lab-select">
				<option :value="null">Auto / not noted</option>
				<option v-for="s in SHUTTERS" :key="s" :value="s">{{ s }}</option>
			</select>
		</label>
		<label v-if="lenses.length" class="lab-field">
			<span>Lens</span>
			<select :id="`${uid}-l`" v-model="model.lensId" class="lab-input lab-select">
				<option :value="null">Not noted</option>
				<option v-for="l in lenses" :key="l.id" :value="l.id">{{ l.name }}</option>
			</select>
		</label>
		<label class="check">
			<input :id="`${uid}-f`" v-model="model.flash" type="checkbox" />
			<span>Flash</span>
		</label>
		<label class="lab-field wide">
			<span>Note</span>
			<input :id="`${uid}-note`" v-model="model.note" class="lab-input" type="text" maxlength="500" />
		</label>
	</div>
</template>

<script lang="ts">
export interface FrameDraft {
	number: number;
	aperture: number | null;
	shutter: string | null;
	lensId: string | null;
	flash: boolean;
	note: string;
}
</script>

<script setup lang="ts">
import { useId } from 'vue';

import { APERTURES, formatAperture, SHUTTERS, type LensView } from '../../lib/lab/inventory';

defineProps<{ lenses: LensView[] }>();
const model = defineModel<FrameDraft>({ required: true });
const uid = useId();
</script>

<style scoped>
.ff {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
	gap: 0.75rem;
	align-items: end;
}

.wide {
	grid-column: 1 / -1;
}

.check {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	min-height: 2.9rem;
}

.check input {
	width: 1.1rem;
	height: 1.1rem;
	accent-color: var(--accent-regular);
}
</style>
