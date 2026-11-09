<template>
	<div class="account">
		<p v-if="recovered" class="lab-notice" role="status">
			You signed in with a recovery code. {{ remaining }} unused {{ remaining === 1 ? 'code is' : 'codes are' }} left.
			If this is your device, save a passkey on it below.
		</p>

		<!-- Passkeys -->
		<section class="lab-section" aria-labelledby="pk-h">
			<header>
				<h2 id="pk-h" class="lab-h2">Passkeys</h2>
				<p class="lab-meta">
					Sign in with Face ID, Touch ID or your device PIN. Passkeys saved to iCloud Keychain or Google Password
					Manager follow you to your other devices.
				</p>
			</header>
			<ul class="lab-rows">
				<li v-for="pk in keys" :key="pk.id">
					<div class="lab-grow">
						<form v-if="renaming === pk.id" class="rename" @submit.prevent="saveName(pk.id)">
							<input
								:id="`lab-pk-name-${pk.id}`"
								ref="renameInput"
								v-model="draftName"
								class="lab-input"
								type="text"
								maxlength="60"
								aria-label="Passkey name"
							/>
							<button type="submit" class="lab-btn lab-btn--quiet" :disabled="busy">Save</button>
							<button type="button" class="lab-btn lab-btn--quiet" @click="renaming = null">Cancel</button>
						</form>
						<template v-else>
							<strong class="pk-name">{{ pk.name || 'Unnamed passkey' }}</strong>
							<span class="lab-meta">
								Added {{ formatDate(pk.createdAt) }}
								<span v-if="pk.backedUp" class="lab-chip lab-chip--ok">synced</span>
							</span>
						</template>
					</div>
					<div v-if="renaming !== pk.id" class="lab-actions">
						<template v-if="confirmingDelete === pk.id">
							<span class="lab-meta">Remove this passkey?</span>
							<button type="button" class="lab-btn lab-btn--quiet lab-btn--danger" :disabled="busy" @click="remove(pk.id)">
								Remove
							</button>
							<button type="button" class="lab-btn lab-btn--quiet" @click="confirmingDelete = null">Keep</button>
						</template>
						<template v-else>
							<button type="button" class="lab-btn lab-btn--quiet" @click="startRename(pk)">Rename</button>
							<button
								type="button"
								class="lab-btn lab-btn--quiet"
								:disabled="keys.length < 2"
								:title="keys.length < 2 ? 'Add another passkey before removing this one' : undefined"
								@click="confirmingDelete = pk.id"
							>
								Remove
							</button>
						</template>
					</div>
				</li>
				<li v-if="!keys.length"><span class="lab-meta">No passkeys yet.</span></li>
			</ul>
			<div class="lab-actions">
				<button type="button" class="lab-btn" :disabled="busy" @click="addKey">Save a passkey on this device</button>
			</div>
			<p v-if="keyError" class="lab-error" role="alert">{{ keyError }}</p>
		</section>

		<!-- Recovery codes -->
		<section class="lab-section" aria-labelledby="rc-h">
			<header>
				<h2 id="rc-h" class="lab-h2">Recovery codes</h2>
				<p class="lab-meta">For when no passkey is at hand. Keep them somewhere other than your phone.</p>
			</header>
			<template v-if="freshCodes.length">
				<RecoveryCodes :codes="freshCodes" done-label="Done" @done="freshCodes = []" />
			</template>
			<template v-else>
				<p>
					<span class="lab-mono">{{ remaining }}</span> of 10 codes unused.
					<span v-if="remaining <= 3" class="lab-chip lab-chip--warn">running low</span>
				</p>
				<div class="lab-actions">
					<template v-if="confirmingCodes">
						<span class="lab-meta">This replaces every current code.</span>
						<button type="button" class="lab-btn lab-btn--quiet" :disabled="busy" @click="newCodes">Make new codes</button>
						<button type="button" class="lab-btn lab-btn--quiet" @click="confirmingCodes = false">Cancel</button>
					</template>
					<button v-else type="button" class="lab-btn lab-btn--quiet" @click="confirmingCodes = true">
						Make new codes
					</button>
				</div>
			</template>
			<p v-if="codeError" class="lab-error" role="alert">{{ codeError }}</p>
		</section>

		<!-- Invites (owner) -->
		<section v-if="inviteList" class="lab-section" aria-labelledby="inv-h">
			<header>
				<h2 id="inv-h" class="lab-h2">Invites</h2>
				<p class="lab-meta">
					Each link makes one account and expires after a week. Everyone keeps their own separate logbook.
				</p>
			</header>
			<form class="invite-form" @submit.prevent="createInvite">
				<label class="lab-field invite-note">
					<span>Who it’s for (optional)</span>
					<input id="lab-invite-note" v-model="inviteNote" class="lab-input" type="text" maxlength="80" />
				</label>
				<button type="submit" class="lab-btn" :disabled="busy">Create invite link</button>
			</form>
			<div v-if="newLink" class="lab-notice new-link">
				<p>Send this link yourself. It’s only shown now.</p>
				<code class="lab-mono">{{ newLink }}</code>
				<button type="button" class="lab-btn lab-btn--quiet" @click="copyLink">{{ linkCopied ? 'Copied' : 'Copy link' }}</button>
			</div>
			<ul v-if="inviteList.length" class="lab-rows">
				<li v-for="inv in inviteList" :key="inv.id">
					<div class="lab-grow">
						<strong>{{ inv.note || 'Invite' }}</strong>
						<span class="lab-meta">
							<template v-if="inv.status === 'used'">Used{{ inv.usedByName ? ` by ${inv.usedByName}` : '' }}</template>
							<template v-else-if="inv.status === 'open'">Expires {{ formatDate(inv.expiresAt) }}</template>
							<template v-else>{{ inv.status === 'revoked' ? 'Withdrawn' : 'Expired' }}</template>
						</span>
					</div>
					<span class="lab-chip" :class="{ 'lab-chip--ok': inv.status === 'used' }">{{ inv.status }}</span>
					<button
						v-if="inv.status === 'open'"
						type="button"
						class="lab-btn lab-btn--quiet lab-btn--danger"
						:disabled="busy"
						@click="revoke(inv.id)"
					>
						Withdraw
					</button>
				</li>
			</ul>
			<p v-if="inviteError" class="lab-error" role="alert">{{ inviteError }}</p>
		</section>

		<section class="lab-section" aria-labelledby="so-h">
			<header>
				<h2 id="so-h" class="lab-h2">This device</h2>
			</header>
			<p v-if="unsynced" class="lab-notice" role="alert">
				{{ unsynced }} {{ unsynced === 1 ? 'frame or move' : 'frames or moves' }} from shooting mode haven’t synced yet. Open
				<a class="lab-link" href="/photography/lab/shoot/">shooting mode</a> while online to send them, or sign out anyway (they stay on this
				phone and send next time you sign in).
			</p>
			<div class="lab-actions">
				<button type="button" class="lab-btn lab-btn--ghost" :disabled="busy" @click="signOut">
					{{ unsynced ? 'Sign out anyway' : 'Sign out' }}
				</button>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';

import { authClient, deviceLabel, friendlyError, labPost } from '../../lib/lab/auth-client';
import { clearLabCaches, pendingCount } from '../../lib/lab/offline';
import type { InviteSummary, PasskeySummary } from '../../lib/lab/server/plugin';
import RecoveryCodes from './RecoveryCodes.vue';

const props = defineProps<{
	passkeys: PasskeySummary[];
	recoveryRemaining: number;
	invites: InviteSummary[] | null;
	recovered: boolean;
}>();

const busy = ref(false);
const keys = ref<PasskeySummary[]>([...props.passkeys]);
const keyError = ref('');
const renaming = ref<string | null>(null);
const draftName = ref('');
const renameInput = ref<HTMLInputElement[] | null>(null);
const confirmingDelete = ref<string | null>(null);

const remaining = ref(props.recoveryRemaining);
const freshCodes = ref<string[]>([]);
const confirmingCodes = ref(false);
const codeError = ref('');

const inviteList = ref<InviteSummary[] | null>(props.invites ? [...props.invites] : null);
const inviteNote = ref('');
const newLink = ref('');
const linkCopied = ref(false);
const inviteError = ref('');

// UTC so the server render and the browser agree.
const formatDate = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
		: 'some time ago';

async function run(fn: () => Promise<void>, errorRef: { value: string }) {
	busy.value = true;
	errorRef.value = '';
	try {
		await fn();
	} catch (e) {
		errorRef.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

async function refreshKeys() {
	const { data, error } = await authClient.passkey.listUserPasskeys();
	if (error) throw new Error(friendlyError(error));
	keys.value = (data ?? []).map((pk) => ({
		id: pk.id,
		name: pk.name ?? null,
		createdAt: pk.createdAt ? new Date(pk.createdAt).toISOString() : null,
		backedUp: pk.backedUp,
	}));
}

const addKey = () =>
	run(async () => {
		const result = await authClient.passkey.addPasskey({ name: deviceLabel() });
		if (result?.error) throw new Error(friendlyError(result.error));
		await refreshKeys();
	}, keyError);

async function startRename(pk: PasskeySummary) {
	renaming.value = pk.id;
	draftName.value = pk.name ?? '';
	await nextTick();
	renameInput.value?.[0]?.focus();
}

const saveName = (id: string) =>
	run(async () => {
		const { error } = await authClient.passkey.updatePasskey({ id, name: draftName.value.trim() || 'Passkey' });
		if (error) throw new Error(friendlyError(error));
		renaming.value = null;
		await refreshKeys();
	}, keyError);

const remove = (id: string) =>
	run(async () => {
		const { error } = await authClient.passkey.deletePasskey({ id });
		confirmingDelete.value = null;
		if (error) throw new Error(friendlyError(error));
		await refreshKeys();
	}, keyError);

const newCodes = () =>
	run(async () => {
		const { codes } = await labPost<{ codes: string[] }>('/film-lab/recovery/generate');
		freshCodes.value = codes;
		remaining.value = codes.length;
		confirmingCodes.value = false;
	}, codeError);

const createInvite = () =>
	run(async () => {
		const created = await labPost<{ id: string; token: string; note: string | null; expiresAt: string }>(
			'/film-lab/invites/create',
			{ note: inviteNote.value.trim() || undefined }
		);
		newLink.value = `${location.origin}/photography/lab/invite/${created.token}/`;
		linkCopied.value = false;
		inviteNote.value = '';
		inviteList.value = [
			{ id: created.id, note: created.note, expiresAt: created.expiresAt, status: 'open', usedByName: null },
			...(inviteList.value ?? []),
		];
	}, inviteError);

async function copyLink() {
	try {
		await navigator.clipboard.writeText(newLink.value);
		linkCopied.value = true;
	} catch {
		linkCopied.value = false;
	}
}

const revoke = (id: string) =>
	run(async () => {
		await labPost('/film-lab/invites/revoke', { id });
		inviteList.value = (inviteList.value ?? []).map((inv) => (inv.id === id ? { ...inv, status: 'revoked' } : inv));
	}, inviteError);

const unsynced = ref(0);

async function signOut() {
	// Frames logged offline that haven't reached the server yet would stay on this phone.
	if (!unsynced.value) {
		unsynced.value = await pendingCount().catch(() => 0);
		if (unsynced.value) return;
	}
	busy.value = true;
	await authClient.signOut();
	await clearLabCaches().catch(() => {});
	location.assign('/photography/lab/sign-in/');
}
</script>

<style scoped>
.account {
	display: grid;
	gap: clamp(2.5rem, 6vw, 3.5rem);
	max-width: 46rem;
}

.pk-name {
	color: var(--gray-0);
	font-weight: 600;
}

.lab-meta {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}

.rename {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	align-items: center;
}

.rename .lab-input {
	flex: 1 1 12rem;
	min-height: 2.4rem;
}

.invite-form {
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	gap: 0.75rem;
}

.invite-note {
	flex: 1 1 16rem;
}

.new-link {
	display: grid;
	gap: 0.6rem;
	justify-items: start;
}

.new-link code {
	max-width: 100%;
	overflow-wrap: anywhere;
	color: var(--gray-0);
}
</style>
