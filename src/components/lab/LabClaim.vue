<template>
	<div class="claim">
		<form v-if="stage !== 'codes'" class="lab-form" @submit.prevent="submit">
			<template v-if="stage === 'form'">
				<label v-if="kind === 'setup'" class="lab-field">
					<span>Setup code</span>
					<input
						id="lab-setup-code"
						v-model="setupCode"
						class="lab-input lab-mono"
						type="password"
						autocomplete="off"
						spellcheck="false"
						required
					/>
				</label>
				<label class="lab-field">
					<span>Your name</span>
					<input id="lab-claim-name" v-model="name" class="lab-input" type="text" autocomplete="name" required />
				</label>
				<label class="lab-field">
					<span>Email</span>
					<input id="lab-claim-email" v-model="email" class="lab-input" type="email" autocomplete="email" required />
					<small class="lab-hint">Used with recovery codes. Nothing gets emailed.</small>
				</label>
			</template>
			<p v-else class="lab-notice">
				Your account is ready, but no passkey was saved yet. Save one to finish.
			</p>

			<p v-if="error" class="lab-error" role="alert">{{ error }}</p>

			<button type="submit" class="lab-btn lab-btn--wide" :disabled="busy">
				{{ busy ? 'Waiting for your passkey…' : stage === 'form' ? 'Create account and save a passkey' : 'Save a passkey' }}
			</button>
		</form>

		<template v-else>
			<h2 class="lab-h2">Passkey saved. One last thing.</h2>
			<RecoveryCodes :codes="codes" done-label="Open Film Lab" @done="finish" />
		</template>
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

import { authClient, deviceLabel, friendlyError, labPost } from '../../lib/lab/auth-client';
import RecoveryCodes from './RecoveryCodes.vue';

const props = defineProps<{ kind: 'setup' | 'invite'; token?: string }>();

const stage = ref<'form' | 'passkey' | 'codes'>('form');
const busy = ref(false);
const error = ref('');
const setupCode = ref('');
const name = ref('');
const email = ref('');
const codes = ref<string[]>([]);

async function submit() {
	busy.value = true;
	error.value = '';
	try {
		if (stage.value === 'form') {
			await labPost('/film-lab/claim', {
				kind: props.kind,
				token: props.kind === 'setup' ? setupCode.value : props.token,
				name: name.value,
				email: email.value,
			});
			// Signed in from here on; a cancelled prompt can be retried.
			stage.value = 'passkey';
		}
		const added = await authClient.passkey.addPasskey({ name: deviceLabel() });
		if (added?.error) throw new Error(friendlyError(added.error));
		const result = await labPost<{ codes: string[] }>('/film-lab/recovery/generate');
		codes.value = result.codes;
		stage.value = 'codes';
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

function finish() {
	location.assign('/photography/lab/');
}
</script>

<style scoped>
.claim {
	display: grid;
	gap: 1.25rem;
	padding-top: 0.25rem;
}
</style>
