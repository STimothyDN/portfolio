<script setup lang="ts">
/**
 * The contact sheet for a roll, drawn on a canvas so it downloads as a PNG
 * and prints as one page: strips of six, edge numbers, each frame's
 * settings, grease-pencil marks. With no scans yet, it's a shooting log of
 * the frames you logged (latent frames, as bright as their light).
 */
import { onMounted, reactive, ref, watch } from 'vue';

import { drawSheet, loadImage, sheetFonts, type SheetData, type SheetOptions } from '../../lib/lab/contact-sheet';

const props = defineProps<{ sheet: SheetData; hasScans: boolean }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const opts = reactive<SheetOptions>({ paper: 'letter', negative: false, settings: true, marks: true });
const images = ref<(HTMLImageElement | null)[]>([]);
const loading = ref(true);
const failed = ref(0);
const url = ref('');

function draw() {
	if (!canvas.value) return;
	drawSheet(canvas.value, props.sheet, images.value, opts);
	try {
		url.value = canvas.value.toDataURL('image/png');
	} catch {
		url.value = '';
	}
}

onMounted(async () => {
	await sheetFonts();
	images.value = await Promise.all(props.sheet.frames.map((f) => (f.src ? loadImage(f.src) : Promise.resolve(null))));
	failed.value = props.sheet.frames.filter((f, i) => f.src && !images.value[i]).length;
	loading.value = false;
	draw();
});
watch(opts, draw);

function download() {
	if (!canvas.value) return;
	canvas.value.toBlob((blob) => {
		if (!blob) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${props.sheet.code}-contact-sheet.png`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	}, 'image/png');
}
const print = () => window.print();
</script>

<template>
	<div class="sheet-page">
		<header class="sheet-head">
			<a class="lab-edge" :href="`/photography/lab/rolls/${sheet.code}/`">← {{ sheet.code }}</a>
			<h1 class="lab-title">Contact sheet</h1>
			<p class="lab-lede">{{ hasScans ? 'Every scan in strips of six, with what each frame was shot at and your grease-pencil marks.' : 'No scans yet: a shooting log of the frames you’ve logged, to slip in the sleeve.' }}</p>
		</header>

		<div class="controls" role="group" aria-label="Sheet options">
			<span class="seg" role="group" aria-label="Paper">
				<button type="button" :aria-pressed="opts.paper === 'letter'" @click="opts.paper = 'letter'">Letter</button>
				<button type="button" :aria-pressed="opts.paper === 'a4'" @click="opts.paper = 'a4'">A4</button>
			</span>
			<span v-if="hasScans" class="seg" role="group" aria-label="Frames as">
				<button type="button" :aria-pressed="!opts.negative" @click="opts.negative = false">Positive</button>
				<button type="button" :aria-pressed="opts.negative" @click="opts.negative = true">Negative</button>
			</span>
			<label><input id="sheet-settings" v-model="opts.settings" type="checkbox" /> Settings and notes</label>
			<label v-if="hasScans"><input id="sheet-marks" v-model="opts.marks" type="checkbox" /> Grease-pencil marks</label>
			<span class="push"></span>
			<button id="sheet-download" type="button" class="lab-btn" :disabled="loading" @click="download">Download PNG</button>
			<button type="button" class="lab-btn lab-btn--quiet" :disabled="loading" @click="print">Print</button>
		</div>

		<p v-if="loading" class="lab-meta" role="status">Developing the sheet…</p>
		<p v-if="failed" class="lab-notice">{{ failed }} {{ failed === 1 ? 'scan' : 'scans' }} didn’t load, so {{ failed === 1 ? 'it shows' : 'they show' }} as blank frames.</p>
		<div class="paper">
			<canvas ref="canvas" class="sheet-canvas" :aria-label="`Contact sheet for ${sheet.code}`" role="img"></canvas>
		</div>
		<!-- What the printer gets: the drawing alone, filling the page. -->
		<img v-if="url" class="print-only" :src="url" alt="" />
	</div>
</template>

<style scoped>
.sheet-page {
	display: grid;
	gap: 1.2rem;
}

.sheet-head {
	display: grid;
	gap: 0.3rem;
}

.controls {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.6rem 1rem;
	font-size: var(--text-sm);
}

.push {
	flex: 1;
}

.seg {
	display: inline-flex;
	padding: 2px;
	border: 1px solid var(--gray-700);
	border-radius: 999px;
}

.seg button {
	padding: 0.3rem 0.8rem;
	border: 0;
	border-radius: 999px;
	background: none;
	color: var(--gray-200);
	font: inherit;
	cursor: pointer;
}

.seg button[aria-pressed='true'] {
	background: var(--gray-0);
	color: var(--gray-999);
}

.paper {
	padding: clamp(0.5rem, 2vw, 1.5rem);
	border-radius: 0.6rem;
	background: var(--gray-900);
	box-shadow: inset 0 0 0 1px var(--gray-800);
}

.sheet-canvas {
	display: block;
	width: 100%;
	max-width: 52rem;
	height: auto;
	margin-inline: auto;
	box-shadow: 0 20px 40px -24px rgb(0 0 0 / 0.7);
}

.print-only {
	display: none;
}

@media print {
	:global(body *) {
		visibility: hidden;
	}

	.print-only {
		display: block;
		visibility: visible;
		position: fixed;
		inset: 0;
		width: 100%;
		height: auto;
	}
}
</style>
