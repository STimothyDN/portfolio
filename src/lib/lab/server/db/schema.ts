/**
 * Film Lab database schema (Turso / SQLite, through Drizzle).
 *
 * The first six tables belong to Better Auth: JS keys are its field names (the
 * adapter maps by them), columns are snake_case. `invite` and `recovery_code`
 * are the lab's own auth extras (src/lib/lab/server/plugin.ts).
 *
 * After changing this file: `npm run db:generate`, review the SQL in
 * drizzle/, then `npm run db:migrate`.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date());
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date());

/* ---------- Better Auth ---------- */

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	/** 'owner' (can invite people) or 'member'. Never settable by the client. */
	role: text('role').notNull().default('member'),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(t) => [index('session_user_id_idx').on(t.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('account_user_id_idx').on(t.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

export const passkey = sqliteTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
		transports: text('transports'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }),
		aaguid: text('aaguid'),
	},
	(t) => [index('passkey_user_id_idx').on(t.userId), index('passkey_credential_id_idx').on(t.credentialID)]
);

/** Rate-limit counters live in the database: serverless instances share no memory. */
export const rateLimit = sqliteTable('rate_limit', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	count: integer('count').notNull(),
	lastRequest: integer('last_request').notNull(),
});

/* ---------- Film Lab auth extras ---------- */

/** One-time invite links. Only a hash of the token is stored. */
export const invite = sqliteTable('invite', {
	id: text('id').primaryKey(),
	tokenHash: text('token_hash').notNull().unique(),
	note: text('note'),
	role: text('role').notNull().default('member'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
	usedAt: integer('used_at', { mode: 'timestamp_ms' }),
	revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
	createdAt: createdAt(),
});

/** Single-use recovery codes (sign in when no passkey is at hand). Hashed. */
export const recoveryCode = sqliteTable(
	'recovery_code',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		codeHash: text('code_hash').notNull().unique(),
		usedAt: integer('used_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
	},
	(t) => [index('recovery_code_user_id_idx').on(t.userId)]
);

/** The tables Better Auth's adapter needs, keyed by its model names. */
export const authSchema = { user, session, account, verification, passkey, rateLimit };
