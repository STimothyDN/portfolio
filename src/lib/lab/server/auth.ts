/**
 * Film Lab authentication: Better Auth with passkeys, database sessions, and
 * the lab's invite/recovery endpoints. Built lazily on the first lab request
 * so nothing here runs while the public site prerenders.
 */
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { labConfig, type LabConfig } from './config';
import { getDb } from './db/client';
import { authSchema } from './db/schema';
import { filmLab } from './plugin';

async function createAuth(config: LabConfig) {
	const db = await getDb(config);
	return betterAuth({
		appName: 'Film Lab',
		baseURL: config.baseURL,
		basePath: '/api/auth',
		secret: config.secret,
		trustedOrigins: config.origins,
		database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
		// Passkeys only. Accounts come from the setup code or an invite.
		emailAndPassword: { enabled: false },
		user: {
			additionalFields: {
				role: { type: 'string', required: false, defaultValue: 'member', input: false },
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24,
			// Most requests skip the database: the session rides in a signed
			// cookie for five minutes at a time.
			cookieCache: { enabled: true, maxAge: 5 * 60 },
		},
		rateLimit: { storage: 'database' },
		advanced: { cookiePrefix: 'film-lab' },
		plugins: [passkey({ rpID: config.rpID, rpName: 'Film Lab', origin: config.origins }), filmLab(config)],
	});
}

export type LabAuth = Awaited<ReturnType<typeof createAuth>>;
export type LabSession = LabAuth['$Infer']['Session'];
export type LabUser = LabSession['user'] & { role: string };

let auth: Promise<LabAuth> | undefined;

/** The auth instance, or null when the lab's env vars aren't set. */
export function getAuth(): Promise<LabAuth> | null {
	const result = labConfig();
	if (!result.ok) return null;
	auth ??= createAuth(result.config);
	return auth;
}
