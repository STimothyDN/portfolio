<template>
	<div class="sign-in">
		<button type="button" class="lab-btn lab-btn--wide" :disabled="busy" @click="signInWithPasskey">
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="9" cy="8" r="4" />
				<path d="M2.5 20a6.5 6.5 0 0 1 10.2-5.3" />
				<circle cx="17.5" cy="14" r="2.5" />
				<path d="M17.5 16.5V22m0-2h2" />
			</svg>
			{{ busy && !showRecovery ? 'Waiting for your passkey…' : 'Sign in with a passkey' }}
		</button>

		<p v-if="error" class="lab-error" role="alert">{{ error }}</p>

		<button
			v-if="!showRecovery"
			type="button"
			class="lab-link recovery-toggle"
			@click="openRecovery"
		>
			Use a recovery code instead
		</button>

		<form v-else class="lab-form" @submit.prevent="signInWithCode">
			<p class="lab-hint">
				Each recovery code works once. After signing in, add a passkey on this device from your account page.
			</p>
			<label class="lab-field">
				<span>Email</span>
				<input
					id="lab-recovery-email"
					ref="emailInput"
					v-model="email"
					class="lab-input"
					type="email"
					autocomplete="email"
					required
				/>
			</label>
			<label class="lab-field">
				<span>Recovery code</span>
				<input
					id="lab-recovery-code"
					v-model="code"
					class="lab-input lab-mono"
					type="text"
					inputmode="text"
					autocomplete="one-time-code"
					autocapitalize="characters"
					spellcheck="false"
					placeholder="XXXXX-XXXXX"
					required
				/>
			</label>
			<button type="submit" class="lab-btn lab-btn--ghost" :disabled="busy">Sign in with code</button>
		</form>

		<p v-if="setupOpen" class="lab-hint">
			First time here? <a class="lab-link" href="/photography/lab/setup/">Set up Film Lab</a>
		</p>
	</div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';

import { authClient, friendlyError, labPost, nextPath } from '../../lib/lab/auth-client';

defineProps<{ setupOpen: boolean }>();

const busy = ref(false);
const error = ref('');
const showRecovery = ref(false);
const email = ref('');
const code = ref('');
const emailInput = ref<HTMLInputElement | null>(null);

async function signInWithPasskey() {
	busy.value = true;
	error.value = '';
	const result = await authClient.signIn.passkey();
	busy.value = false;
	if (result.error) {
		error.value = friendlyError(result.error);
		return;
	}
	location.assign(nextPath());
}

async function openRecovery() {
	showRecovery.value = true;
	error.value = '';
	await nextTick();
	emailInput.value?.focus();
}

async function signInWithCode() {
	busy.value = true;
	error.value = '';
	try {
		await labPost('/film-lab/recovery/sign-in', { email: email.value, code: code.value });
		location.assign('/photography/lab/account/?recovered');
	} catch (e) {
		error.value = (e as Error).message;
		busy.value = false;
	}
}
</script>

<style scoped>
.sign-in {
	display: grid;
	gap: 1rem;
	padding-top: 0.5rem;
}

svg {
	width: 1.25rem;
	height: 1.25rem;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.6;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.recovery-toggle {
	justify-self: start;
	font-size: var(--text-sm);
}
</style>
