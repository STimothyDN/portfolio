<template>
	<section class="share" aria-labelledby="share-h">
		<header>
			<h2 id="share-h" class="lab-h2">On the portfolio</h2>
			<p class="lab-meta">What the public film desk’s lightbox shows for this roll. Exact locations never leave the lab.</p>
		</header>

		<label class="row">
			<span class="txt">
				<b>Exposure</b>
				<small>Aperture, shutter, lens and rated speed</small>
			</span>
			<button id="share-exposure" type="button" class="switch" role="switch" :aria-checked="f.shareExposure" aria-label="Show exposure in the lightbox" @click="f.shareExposure = !f.shareExposure"></button>
		</label>
		<label class="row">
			<span class="txt">
				<b>Frame notes</b>
				<small>As captions, where a scan has none</small>
			</span>
			<button id="share-notes" type="button" class="switch" role="switch" :aria-checked="f.shareNotes" aria-label="Show frame notes as captions" @click="f.shareNotes = !f.shareNotes"></button>
		</label>
		<label class="lab-field">
			<span>Place to show</span>
			<input id="share-place" v-model="f.sharePlace" class="lab-input" type="text" maxlength="80" placeholder="Durham, NC (leave empty for none)" />
		</label>

		<div class="preview" aria-live="polite">
			<span class="lab-edge-print">In the lightbox</span>
			<p v-if="previewLine">{{ previewLine }}</p>
			<p v-else class="none">{{ f.shareExposure && !matched ? 'No logged frame lines up with a scan yet.' : 'Nothing extra: scans show as they do now.' }}</p>
		</div>

		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>
		<div class="lab-actions">
			<button type="button" class="lab-btn lab-btn--quiet" :disabled="busy || !dirty" @click="save">{{ dirty ? 'Save' : 'Saved' }}</button>
			<button type="button" class="lab-btn" :disabled="busy || dirty" :title="dirty ? 'Save first' : undefined" @click="publishNow">Publish to portfolio</button>
		</div>
		<p class="lab-hint">{{ publishNote }}</p>
	</section>
</template>

<script setup lang="ts">
import { actions } from 'astro:actions';
import { computed, reactive, ref } from 'vue';

import { run } from '../../lib/lab/client';
import { exposureLine, publicExposure, type PublicExposure } from '../../lib/lab/alignment';
import type { RollView } from '../../lib/lab/inventory';

const props = defineProps<{
	roll: RollView;
	/** The first logged frame that lines up with a scan, for the preview. */
	sample: { aperture: number | null; shutter: string | null; focalLength: number | null; note: string | null; lensName: string | null } | null;
	lastPublished: string | null;
}>();
const emit = defineEmits<{ saved: [roll: RollView] }>();

const f = reactive({ shareExposure: props.roll.shareExposure, shareNotes: props.roll.shareNotes, sharePlace: props.roll.sharePlace ?? '' });
const savedState = ref({ ...f });
const busy = ref(false);
const error = ref('');
const lastPublished = ref(props.lastPublished);
const justPublished = ref(false);

const dirty = computed(
	() => f.shareExposure !== savedState.value.shareExposure || f.shareNotes !== savedState.value.shareNotes || f.sharePlace.trim() !== savedState.value.sharePlace.trim()
);
const matched = computed(() => !!props.sample);
const preview = computed<PublicExposure | null>(() =>
	publicExposure(props.sample ?? { aperture: null, shutter: null, focalLength: null, note: null }, props.sample?.lensName ?? null, {
		shareExposure: f.shareExposure && matched.value,
		sharePlace: f.sharePlace,
		shareNotes: f.shareNotes,
		ratedIso: props.roll.shotAtIso ?? props.roll.stock.iso,
	})
);
const previewLine = computed(() => [exposureLine(preview.value), preview.value?.nt ? `“${preview.value.nt}”` : ''].filter(Boolean).join(' · '));

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const publishNote = computed(() =>
	justPublished.value
		? 'Rebuilding the site: the film desk shows the changes in a minute or two.'
		: lastPublished.value
			? `Last published ${fmt(lastPublished.value)}. Saved changes go live when you publish.`
			: 'Saved changes go live when you publish (the site rebuilds in a minute or two).'
);

async function save() {
	busy.value = true;
	error.value = '';
	try {
		const view = await run(
			actions.lab.updateSharing({ rollId: props.roll.id, shareExposure: f.shareExposure, sharePlace: f.sharePlace, shareNotes: f.shareNotes })
		);
		savedState.value = { ...f };
		emit('saved', view);
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

async function publishNow() {
	busy.value = true;
	error.value = '';
	try {
		const r = await run(actions.lab.publishSite());
		lastPublished.value = r.at;
		justPublished.value = true;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.share {
	display: grid;
	gap: 0.9rem;
	padding: 1.25rem;
	border: 1px solid var(--gray-800);
	border-radius: 0.75rem;
	background: color-mix(in oklch, var(--gray-999) 92%, var(--gray-900));
}

.share header {
	display: grid;
	gap: 0.3rem;
}

.row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.txt {
	display: grid;
	gap: 0.05rem;
}

.txt b {
	color: var(--gray-0);
	font-weight: 600;
}

.txt small {
	font-size: var(--text-sm);
	color: var(--gray-300);
}

.switch {
	position: relative;
	flex: none;
	width: 2.6rem;
	height: 1.5rem;
	border: 0;
	border-radius: 999px;
	background: var(--gray-700);
	cursor: pointer;
}

.switch::after {
	content: '';
	position: absolute;
	top: 0.2rem;
	left: 0.2rem;
	width: 1.1rem;
	height: 1.1rem;
	border-radius: 50%;
	background: var(--gray-999);
	transition: translate 0.15s ease;
}

.switch[aria-checked='true'] {
	background: var(--accent-regular);
}

.switch[aria-checked='true']::after {
	translate: 1.1rem 0;
	background: var(--accent-text-over);
}

.switch:focus-visible {
	outline: 2px solid var(--accent-regular);
	outline-offset: 2px;
}

/* The line as the lightbox will show it, on the lightbox's dark plate. */
.preview {
	display: grid;
	gap: 0.3rem;
	padding: 0.75rem 0.9rem;
	border-radius: 0.5rem;
	background: oklch(16% 0.004 50);
}

.preview p {
	font-family: var(--font-mono);
	font-size: 0.78rem;
	color: oklch(92% 0.01 80);
	overflow-wrap: anywhere;
}

.preview .none {
	color: oklch(70% 0.01 80);
	font-family: var(--font-body);
	font-style: italic;
}

.preview .lab-edge-print {
	color: oklch(74% 0.13 62);
}
</style>
