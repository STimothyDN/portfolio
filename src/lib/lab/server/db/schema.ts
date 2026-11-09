/**
 * Film Lab database schema (Turso / SQLite, through Drizzle).
 *
 * The first six tables belong to Better Auth: JS keys are its field names (the
 * adapter maps by them), columns are snake_case. `invite` and `recovery_code`
 * are the lab's own auth extras (src/lib/lab/server/plugin.ts).
 *
 * Everything from "Inventory" down is the logbook itself. Every row carries a
 * user_id: each person's gear and film is their own. Calendar dates (bought,
 * loaded, sent…) are plain 'YYYY-MM-DD' text, so no timezone ever shifts them;
 * film expiry is 'YYYY-MM', as printed on the box.
 *
 * After changing this file: `npm run db:generate`, review the SQL in
 * drizzle/, then `npm run db:migrate`.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

/* ---------- Inventory ---------- */

const owner = () =>
	text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' });

/** A kind of film (Kodak Portra 400). A roll is one canister of it. */
export const filmStock = sqliteTable(
	'film_stock',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		/** film-labels.json key (portra400): ties the stock to the public film desk. */
		token: text('token'),
		brand: text('brand').notNull(),
		name: text('name').notNull(),
		iso: integer('iso'),
		/** C-41, E-6, B&W, ECN-2 */
		process: text('process').notNull().default('C-41'),
		/** 35mm, 120, 110… */
		format: text('format').notNull().default('35mm'),
		exposures: integer('exposures').notNull().default(36),
		/** Not owned yet: a stock to try. */
		wishlist: integer('wishlist', { mode: 'boolean' }).notNull().default(false),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('film_stock_user_idx').on(t.userId), uniqueIndex('film_stock_user_token_idx').on(t.userId, t.token)]
);

export const camera = sqliteTable(
	'camera',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		token: text('token'),
		brand: text('brand').notNull(),
		name: text('name').notNull(),
		/** slr, rangefinder, point-and-shoot, tlr, medium-format, other */
		kind: text('kind').notNull().default('point-and-shoot'),
		format: text('format').notNull().default('35mm'),
		/** Lens mount; null for a fixed lens. */
		mount: text('mount'),
		fixedLens: text('fixed_lens'),
		battery: text('battery'),
		batteryChangedOn: text('battery_changed_on'),
		serial: text('serial'),
		acquiredOn: text('acquired_on'),
		priceCents: integer('price_cents'),
		acquiredFrom: text('acquired_from'),
		/** active, shelf, repair, gone, wishlist */
		status: text('status').notNull().default('active'),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('camera_user_idx').on(t.userId), uniqueIndex('camera_user_token_idx').on(t.userId, t.token)]
);

export const lens = sqliteTable(
	'lens',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		brand: text('brand').notNull(),
		name: text('name').notNull(),
		mount: text('mount').notNull(),
		focalMin: integer('focal_min'),
		/** Set for zooms. */
		focalMax: integer('focal_max'),
		maxAperture: real('max_aperture'),
		serial: text('serial'),
		acquiredOn: text('acquired_on'),
		priceCents: integer('price_cents'),
		acquiredFrom: text('acquired_from'),
		status: text('status').notNull().default('active'),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('lens_user_idx').on(t.userId)]
);

/** Batteries, light seals, CLAs, repairs. */
export const serviceLog = sqliteTable(
	'service_log',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		cameraId: text('camera_id').references(() => camera.id, { onDelete: 'cascade' }),
		lensId: text('lens_id').references(() => lens.id, { onDelete: 'cascade' }),
		on: text('on').notNull(),
		/** battery, seals, cla, repair, clean, other */
		kind: text('kind').notNull(),
		costCents: integer('cost_cents'),
		note: text('note'),
		createdAt: createdAt(),
	},
	(t) => [index('service_log_camera_idx').on(t.cameraId), index('service_log_lens_idx').on(t.lensId)]
);

/** Where film gets developed and scanned. */
export const lab = sqliteTable(
	'lab',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		token: text('token'),
		name: text('name').notNull(),
		location: text('location'),
		url: text('url'),
		/** Usual dev + scan price per roll. */
		costCents: integer('cost_cents'),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index('lab_user_idx').on(t.userId), uniqueIndex('lab_user_token_idx').on(t.userId, t.token)]
);

/**
 * One physical roll. `status` is where it is now; roll_event keeps every move
 * with its date. storage → camera → shot → lab → scanned → negatives (or lost).
 */
export const roll = sqliteTable(
	'roll',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		/** R-047: short enough to write on the canister. */
		code: text('code').notNull(),
		stockId: text('stock_id')
			.notNull()
			.references(() => filmStock.id),
		exposures: integer('exposures').notNull().default(36),
		title: text('title'),
		status: text('status').notNull().default('storage'),
		/** Date of the latest move (mirrors the newest roll_event). */
		statusOn: text('status_on').notNull(),
		// In storage
		expires: text('expires'),
		purchasedOn: text('purchased_on'),
		priceCents: integer('price_cents'),
		purchasedFrom: text('purchased_from'),
		storageSpot: text('storage_spot'),
		// In camera
		cameraId: text('camera_id').references(() => camera.id, { onDelete: 'set null' }),
		/** Exposure index it was shot at; differs from the box speed when pushed or pulled. */
		shotAtIso: integer('shot_at_iso'),
		// At the lab
		labId: text('lab_id').references(() => lab.id, { onDelete: 'set null' }),
		labOrder: text('lab_order'),
		devCostCents: integer('dev_cost_cents'),
		devNotes: text('dev_notes'),
		// Home
		negativesAt: text('negatives_at'),
		/** The roll's id on the public film desk (src/content/film/<id>.json). */
		publicRollId: text('public_roll_id'),
		/** Rewound mid-roll after this frame; reloading winds past it. */
		rewoundAtFrame: integer('rewound_at_frame'),
		// On the public film desk (Phase 4). Nothing is shared until switched on.
		/** Show each frame's aperture, shutter, lens and rated speed in the lightbox. */
		shareExposure: integer('share_exposure', { mode: 'boolean' }).notNull().default(false),
		/** The place to show for this roll ("Durham, NC"); null shows none. Exact spots never leave the lab. */
		sharePlace: text('share_place'),
		/** Show frame notes as lightbox captions. */
		shareNotes: integer('share_notes', { mode: 'boolean' }).notNull().default(false),
		/** The frame number of the lab's first scan (0 when the lab scanned a frame 0/00). */
		firstScanFrame: integer('first_scan_frame').notNull().default(1),
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index('roll_user_status_idx').on(t.userId, t.status),
		uniqueIndex('roll_user_code_idx').on(t.userId, t.code),
		uniqueIndex('roll_user_public_idx').on(t.userId, t.publicRollId),
	]
);

export const rollEvent = sqliteTable(
	'roll_event',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		rollId: text('roll_id')
			.notNull()
			.references(() => roll.id, { onDelete: 'cascade' }),
		status: text('status').notNull(),
		on: text('on').notNull(),
		note: text('note'),
		createdAt: createdAt(),
	},
	(t) => [index('roll_event_roll_idx').on(t.rollId)]
);

/**
 * One exposure, logged from the phone while shooting (or added later). The
 * phone makes `client_id` when the frame is logged, so a frame queued offline
 * and synced twice is still one row. `tz_offset` (minutes east of UTC) keeps
 * the wall-clock time it was taken, wherever that was.
 */
export const frame = sqliteTable(
	'frame',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		rollId: text('roll_id')
			.notNull()
			.references(() => roll.id, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull(),
		number: integer('number').notNull(),
		shotAt: integer('shot_at').notNull(),
		tzOffset: integer('tz_offset').notNull().default(0),
		cameraId: text('camera_id').references(() => camera.id, { onDelete: 'set null' }),
		lensId: text('lens_id').references(() => lens.id, { onDelete: 'set null' }),
		focalLength: integer('focal_length'),
		/** f-number; null when the camera chose (or it wasn't noted). */
		aperture: real('aperture'),
		/** '1/125', '1s', 'B'; null when the camera chose. */
		shutter: text('shutter'),
		flash: integer('flash', { mode: 'boolean' }).notNull().default(false),
		/** Rough location: rounded to about 100 m on the phone. */
		lat: real('lat'),
		lng: real('lng'),
		accuracy: integer('accuracy'),
		note: text('note'),
		/** Pinned to this scan (filename on the desk), overriding the roll's alignment. */
		scanFilename: text('scan_filename'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex('frame_user_client_idx').on(t.userId, t.clientId), index('frame_roll_idx').on(t.rollId)]
);

/** Every press of "Publish to portfolio" (it triggers a Vercel deploy hook). */
export const publish = sqliteTable(
	'publish',
	{
		id: text('id').primaryKey(),
		userId: owner(),
		at: integer('at', { mode: 'timestamp_ms' }).notNull(),
		status: text('status').notNull(),
		note: text('note'),
	},
	(t) => [index('publish_user_idx').on(t.userId)]
);

/** The tables Better Auth's adapter needs, keyed by its model names. */
export const authSchema = { user, session, account, verification, passkey, rateLimit };
