<script setup lang="ts">
/**
 * The negative binder, standing on the shelf: a ring binder seen from the
 * end, its spine labelled with how many rolls are filed, and the newest
 * glassine sleeves peeking out of the top with their codes.
 */
withDefaults(defineProps<{ count: number; recent?: { id: string; code: string; color?: string }[]; label?: string }>(), { recent: () => [], label: 'Negatives' });
</script>

<template>
	<span class="binder">
		<span class="sleeves" aria-hidden="true">
			<span v-for="(r, i) in recent.slice(0, 4)" :key="r.id" class="sleeve" :data-roll="r.id" :style="{ '--i': i, '--c': r.color ?? 'var(--lab-stage-negatives)' }">
				<b>{{ r.code }}</b>
			</span>
		</span>
		<span class="cover">
			<span class="spine">
				<span class="label">
					<b>{{ label }}</b>
					<i>{{ count }} {{ count === 1 ? 'roll' : 'rolls' }}</i>
				</span>
				<span class="ring-hole" aria-hidden="true"></span>
			</span>
		</span>
	</span>
</template>

<style scoped>
.binder {
	position: relative;
	display: grid;
	justify-items: center;
	width: 100%;
	max-width: 13rem;
	padding-top: 2.2rem;
}

.sleeves {
	position: absolute;
	inset: 0 0.8rem auto;
	height: 3.4rem;
	display: flex;
	justify-content: center;
	gap: 0.25rem;
}

/* Glassine: translucent, a strip of film showing through. */
.sleeve {
	position: relative;
	flex: 1;
	max-width: 2.6rem;
	height: 100%;
	padding-top: 0.25rem;
	border-radius: 2px 2px 0 0;
	background:
		linear-gradient(90deg, transparent 18%, color-mix(in oklch, var(--c) 45%, transparent) 18% 82%, transparent 82%),
		oklch(97% 0.01 85 / 0.82);
	box-shadow: 0 0 0 1px oklch(70% 0.02 80 / 0.4);
	translate: 0 calc(var(--i) * 0.28rem);
	rotate: calc((var(--i) - 1.5) * 2deg);
	text-align: center;
}

.sleeve b {
	font-family: 'Permanent Marker', 'Marker Felt', cursive;
	font-size: 0.55rem;
	font-weight: 400;
	color: oklch(25% 0.01 60);
}

.cover {
	position: relative;
	z-index: 1;
	display: block;
	width: 100%;
	padding: 0.5rem 0.6rem;
	border-radius: 0.35rem;
	background:
		linear-gradient(90deg, oklch(100% 0 0 / 0.08), transparent 30%, oklch(0% 0 0 / 0.15)),
		var(--lab-stage-negatives);
	box-shadow: var(--lab-lift-1);
}

.spine {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
}

.label {
	display: grid;
	flex: 1;
	padding: 0.3rem 0.55rem;
	border-radius: 2px;
	background: oklch(96% 0.012 85);
	color: oklch(22% 0.01 60);
	box-shadow: inset 0 0 0 1px oklch(80% 0.02 80);
}

.label b {
	font-family: var(--font-brand);
	font-size: 0.85rem;
	font-weight: 600;
	font-variant-caps: all-small-caps;
	letter-spacing: 0.06em;
}

.label i {
	font-family: var(--font-mono);
	font-size: 0.66rem;
	font-style: normal;
}

.ring-hole {
	flex: none;
	width: 0.9rem;
	height: 0.9rem;
	border-radius: 50%;
	background: oklch(18% 0.01 270);
	box-shadow:
		inset 0 1px 2px rgb(0 0 0 / 0.6),
		0 0 0 2px oklch(75% 0.01 270 / 0.5);
}
</style>
