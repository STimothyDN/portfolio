/**
 * Film Lab's own Better Auth endpoints (served under /api/auth/film-lab/…).
 *
 * Nobody can sign up on their own. An account comes from one of two one-time
 * doors, and the browser adds a passkey straight after:
 *   - setup: the FILM_LAB_SETUP_TOKEN env var creates the owner, and stops
 *     working once the owner has a passkey;
 *   - invite: a link the owner generates (single use, 7 days).
 * Recovery codes are the fallback for a lost or unavailable passkey (and the
 * way into Vercel preview deployments, where timo3.dev passkeys don't apply).
 */
import type { BetterAuthPlugin } from 'better-auth';
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	sessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';

import type { LabConfig } from './config';
import { getDb } from './db/client';
import { invite, passkey, recoveryCode, user } from './db/schema';

const INVITE_DAYS = 7;
const RECOVERY_CODE_COUNT = 10;
// No 0/O, 1/I/L: codes get copied by hand.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Keyed hash: a leaked database alone can't be brute-forced back into codes. */
async function keyedHash(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

/** Constant-time string comparison (via equal-length hashes). */
async function safeEqual(secret: string, a: string, b: string): Promise<boolean> {
	const [x, y] = await Promise.all([keyedHash(secret, `cmp:${a}`), keyedHash(secret, `cmp:${b}`)]);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
	return diff === 0;
}

function randomCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
	return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');

const forbidden = (message: string) => new APIError('FORBIDDEN', { message });

export function filmLab(config: LabConfig) {
	const db = () => getDb(config);

	const hasPasskey = async (userIds: string[]) => {
		if (!userIds.length) return false;
		const [row] = await (await db())
			.select({ n: count() })
			.from(passkey)
			.where(inArray(passkey.userId, userIds));
		return (row?.n ?? 0) > 0;
	};

	return {
		id: 'film-lab',
		endpoints: {
			/** Create (or resume) an account through the setup code or an invite. */
			filmLabClaim: createAuthEndpoint(
				'/film-lab/claim',
				{
					method: 'POST',
					body: z.object({
						kind: z.enum(['setup', 'invite']),
						token: z.string().trim().min(1).max(200),
						name: z.string().trim().min(1).max(80),
						email: z.email().max(200),
					}),
				},
				async (ctx) => {
					const { kind, token, name } = ctx.body;
					const email = ctx.body.email.trim().toLowerCase();
					const d = await db();
					const adapter = ctx.context.internalAdapter;

					// An account that exists but never got a passkey (the browser
					// prompt was cancelled) can come back through the same door.
					let resumeId: string | undefined;
					let role = 'member';
					let inviteId: string | undefined;

					if (kind === 'setup') {
						if (!config.setupToken || !(await safeEqual(config.secret, token, config.setupToken))) {
							throw forbidden('That setup code isn’t right.');
						}
						const owners = await d.select({ id: user.id, email: user.email }).from(user).where(eq(user.role, 'owner'));
						if (await hasPasskey(owners.map((o) => o.id))) {
							throw forbidden('Film Lab is already set up. Sign in instead.');
						}
						if (owners.length) {
							const owner = owners.find((o) => o.email === email);
							if (!owner) throw forbidden('Setup was started with a different email address.');
							resumeId = owner.id;
						} else {
							role = 'owner';
						}
					} else {
						const tokenHash = await keyedHash(config.secret, `invite:${token}`);
						const [inv] = await d.select().from(invite).where(eq(invite.tokenHash, tokenHash));
						if (!inv || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) {
							throw forbidden('This invite link has expired or been revoked.');
						}
						if (inv.usedAt) {
							const [prior] = inv.usedBy
								? await d.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, inv.usedBy))
								: [];
							if (!prior || prior.email !== email || (await hasPasskey([prior.id]))) {
								throw forbidden('This invite link has already been used.');
							}
							resumeId = prior.id;
						} else {
							// Claim the invite first, so two tabs can't both use it.
							const claimed = await d
								.update(invite)
								.set({ usedAt: new Date() })
								.where(and(eq(invite.id, inv.id), isNull(invite.usedAt)))
								.returning({ id: invite.id });
							if (!claimed.length) throw forbidden('This invite link has already been used.');
							role = inv.role;
							inviteId = inv.id;
						}
					}

					let account = resumeId ? await adapter.findUserById(resumeId) : null;
					if (!account) {
						if (await adapter.findUserByEmail(email)) {
							if (inviteId) await d.update(invite).set({ usedAt: null }).where(eq(invite.id, inviteId));
							throw new APIError('BAD_REQUEST', { message: 'That email already has an account. Sign in instead.' });
						}
						account = await adapter.createUser(
							{ name, email, emailVerified: false },
							{ method: kind === 'setup' ? 'film-lab-setup' : 'film-lab-invite' }
						);
						// Role is server-only (input: false), so it's written here.
						await d.update(user).set({ role }).where(eq(user.id, account.id));
						if (inviteId) await d.update(invite).set({ usedBy: account.id }).where(eq(invite.id, inviteId));
					}

					const session = await adapter.createSession(account.id);
					await setSessionCookie(ctx, { session, user: account });
					return ctx.json({ ok: true });
				}
			),

			/** Replace the signed-in user's recovery codes. Shown once. */
			filmLabRecoveryGenerate: createAuthEndpoint(
				'/film-lab/recovery/generate',
				{ method: 'POST', use: [sessionMiddleware] },
				async (ctx) => {
					const userId = ctx.context.session.user.id;
					const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
					const rows = await Promise.all(
						codes.map(async (code) => ({
							id: crypto.randomUUID(),
							userId,
							codeHash: await keyedHash(config.secret, `recovery:${normalizeCode(code)}`),
						}))
					);
					const d = await db();
					await d.batch([
						d.delete(recoveryCode).where(eq(recoveryCode.userId, userId)),
						d.insert(recoveryCode).values(rows),
					]);
					return ctx.json({ codes });
				}
			),

			/** Sign in with an email address and one unused recovery code. */
			filmLabRecoverySignIn: createAuthEndpoint(
				'/film-lab/recovery/sign-in',
				{
					method: 'POST',
					body: z.object({ email: z.email().max(200), code: z.string().min(6).max(40) }),
				},
				async (ctx) => {
					const email = ctx.body.email.trim().toLowerCase();
					const codeHash = await keyedHash(config.secret, `recovery:${normalizeCode(ctx.body.code)}`);
					const d = await db();
					const fail = () =>
						new APIError('UNAUTHORIZED', {
							message: 'That email and code don’t match an unused recovery code.',
						});

					const [row] = await d
						.select({ id: recoveryCode.id, userId: recoveryCode.userId, usedAt: recoveryCode.usedAt, email: user.email })
						.from(recoveryCode)
						.innerJoin(user, eq(user.id, recoveryCode.userId))
						.where(eq(recoveryCode.codeHash, codeHash));
					if (!row || row.usedAt || row.email !== email) throw fail();

					const used = await d
						.update(recoveryCode)
						.set({ usedAt: new Date() })
						.where(and(eq(recoveryCode.id, row.id), isNull(recoveryCode.usedAt)))
						.returning({ id: recoveryCode.id });
					if (!used.length) throw fail();

					const account = await ctx.context.internalAdapter.findUserById(row.userId);
					if (!account) throw fail();
					const session = await ctx.context.internalAdapter.createSession(account.id);
					await setSessionCookie(ctx, { session, user: account });
					return ctx.json({ ok: true });
				}
			),

			/** Owner only: a new single-use invite link. The token is shown once. */
			filmLabInviteCreate: createAuthEndpoint(
				'/film-lab/invites/create',
				{
					method: 'POST',
					use: [sessionMiddleware],
					body: z.object({ note: z.string().trim().max(80).optional() }),
				},
				async (ctx) => {
					const me = ctx.context.session.user as { id: string; role?: string };
					if (me.role !== 'owner') throw forbidden('Only the owner can invite people.');
					const token = randomToken();
					const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
					const id = crypto.randomUUID();
					await (await db()).insert(invite).values({
						id,
						tokenHash: await keyedHash(config.secret, `invite:${token}`),
						note: ctx.body.note || null,
						createdBy: me.id,
						expiresAt,
					});
					return ctx.json({ id, token, note: ctx.body.note || null, expiresAt: expiresAt.toISOString() });
				}
			),

			/** Owner only: withdraw an unused invite. */
			filmLabInviteRevoke: createAuthEndpoint(
				'/film-lab/invites/revoke',
				{ method: 'POST', use: [sessionMiddleware], body: z.object({ id: z.string().min(1).max(64) }) },
				async (ctx) => {
					const me = ctx.context.session.user as { id: string; role?: string };
					if (me.role !== 'owner') throw forbidden('Only the owner can manage invites.');
					await (await db())
						.update(invite)
						.set({ revokedAt: new Date() })
						.where(and(eq(invite.id, ctx.body.id), isNull(invite.usedAt)));
					return ctx.json({ ok: true });
				}
			),
		},
		hooks: {
			before: [
				{
					// Deleting your only passkey would lock you out: add another first.
					matcher: (ctx) => ctx.path === '/passkey/delete-passkey',
					handler: createAuthMiddleware(async (ctx) => {
						const session = await getSessionFromCtx(ctx);
						if (!session) return;
						const [row] = await (await db())
							.select({ n: count() })
							.from(passkey)
							.where(eq(passkey.userId, session.user.id));
						if ((row?.n ?? 0) <= 1) {
							throw new APIError('BAD_REQUEST', { message: 'Add another passkey before removing your last one.' });
						}
					}),
				},
			],
		},
		rateLimit: [
			{
				pathMatcher: (path) => path === '/film-lab/claim' || path === '/film-lab/recovery/sign-in',
				window: 600,
				max: 8,
			},
		],
	} satisfies BetterAuthPlugin;
}

/* ---------- reads for server-rendered pages ---------- */

export interface InviteSummary {
	id: string;
	note: string | null;
	expiresAt: string;
	status: 'open' | 'used' | 'expired' | 'revoked';
	usedByName: string | null;
}

export async function listInvites(config: LabConfig, ownerId: string): Promise<InviteSummary[]> {
	const d = await getDb(config);
	const rows = await d
		.select({
			id: invite.id,
			note: invite.note,
			expiresAt: invite.expiresAt,
			usedAt: invite.usedAt,
			revokedAt: invite.revokedAt,
			usedByName: user.name,
		})
		.from(invite)
		.leftJoin(user, eq(user.id, invite.usedBy))
		.where(eq(invite.createdBy, ownerId))
		.orderBy(desc(invite.createdAt))
		.limit(20);
	return rows.map((r) => ({
		id: r.id,
		note: r.note,
		expiresAt: r.expiresAt.toISOString(),
		status: r.usedAt ? 'used' : r.revokedAt ? 'revoked' : r.expiresAt.getTime() < Date.now() ? 'expired' : 'open',
		usedByName: r.usedByName,
	}));
}

export async function remainingRecoveryCodes(config: LabConfig, userId: string): Promise<number> {
	const [row] = await (await getDb(config))
		.select({ n: count() })
		.from(recoveryCode)
		.where(and(eq(recoveryCode.userId, userId), isNull(recoveryCode.usedAt)));
	return row?.n ?? 0;
}

/** Whether an invite link can still be used, checked before showing its form. */
export async function inviteUsable(config: LabConfig, token: string): Promise<boolean> {
	const d = await getDb(config);
	const [inv] = await d
		.select({ usedAt: invite.usedAt, usedBy: invite.usedBy, revokedAt: invite.revokedAt, expiresAt: invite.expiresAt })
		.from(invite)
		.where(eq(invite.tokenHash, await keyedHash(config.secret, `invite:${token}`)));
	if (!inv || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) return false;
	if (!inv.usedAt) return true;
	// Used, but its account never got a passkey: the form can resume it.
	if (!inv.usedBy) return false;
	const [row] = await d.select({ n: count() }).from(passkey).where(eq(passkey.userId, inv.usedBy));
	return (row?.n ?? 0) === 0;
}

export interface PasskeySummary {
	id: string;
	name: string | null;
	createdAt: string | null;
	backedUp: boolean;
}

export async function listPasskeys(config: LabConfig, userId: string): Promise<PasskeySummary[]> {
	const rows = await (await getDb(config))
		.select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt, backedUp: passkey.backedUp })
		.from(passkey)
		.where(eq(passkey.userId, userId))
		.orderBy(passkey.createdAt);
	return rows.map((r) => ({ ...r, createdAt: r.createdAt?.toISOString() ?? null }));
}

/** Whether the setup door is still open (no owner with a passkey yet). */
export async function setupOpen(config: LabConfig): Promise<boolean> {
	if (!config.setupToken) return false;
	const d = await getDb(config);
	const [row] = await d
		.select({ n: count() })
		.from(passkey)
		.innerJoin(user, eq(user.id, passkey.userId))
		.where(eq(user.role, 'owner'));
	return (row?.n ?? 0) === 0;
}
