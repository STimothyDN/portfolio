/**
 * Film Lab runtime configuration, read once per server instance.
 *
 * Secrets come from astro:env (declared in astro.config.mjs, all optional so
 * the public site builds without them). Vercel's own variables (VERCEL_ENV,
 * VERCEL_URL…) are plain process.env.
 */
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	FILM_LAB_SETUP_TOKEN,
	TURSO_AUTH_TOKEN,
	TURSO_DATABASE_URL,
} from 'astro:env/server';

/** Local development database: a SQLite file, gitignored. */
const LOCAL_DB = 'file:.data/film-lab.db';
/** Ports the dev servers in .claude/launch.json use. Passkeys need exact origins. */
const DEV_PORTS = [4321, 4322, 4323, 4399];
/** Setup code for `npm run dev` when FILM_LAB_SETUP_TOKEN isn't set. */
export const DEV_SETUP_TOKEN = 'film-lab-dev';

export interface LabConfig {
	dbUrl: string;
	dbAuthToken: string | undefined;
	secret: string;
	baseURL: string;
	/** WebAuthn relying party: the bare host passkeys are bound to. */
	rpID: string;
	/** Every origin allowed to run passkey ceremonies and call the auth API. */
	origins: string[];
	setupToken: string | undefined;
	production: boolean;
}

export type LabConfigResult = { ok: true; config: LabConfig } | { ok: false; missing: string[] };

let cached: LabConfigResult | undefined;

export function labConfig(): LabConfigResult {
	if (cached) return cached;
	const production = import.meta.env.PROD;
	const vercelEnv = process.env.VERCEL_ENV;
	// Preview deployments run on their own *.vercel.app host. Passkeys made on
	// timo3.dev can't be used there (they're bound to one domain), so previews
	// sign in with a recovery code.
	const previewHost =
		vercelEnv === 'preview' ? process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL : undefined;

	const missing: string[] = [];
	if (production && !TURSO_DATABASE_URL) missing.push('TURSO_DATABASE_URL');
	if (production && !BETTER_AUTH_SECRET) missing.push('BETTER_AUTH_SECRET');
	if (production && !previewHost && !BETTER_AUTH_URL) missing.push('BETTER_AUTH_URL');
	if (missing.length) return (cached = { ok: false, missing });

	const baseURL = previewHost
		? `https://${previewHost}`
		: (BETTER_AUTH_URL ?? `http://localhost:${DEV_PORTS[0]}`).replace(/\/$/, '');
	const base = new URL(baseURL);
	const origins = new Set([base.origin]);
	if (base.hostname === 'localhost') {
		for (const port of DEV_PORTS) origins.add(`http://localhost:${port}`);
	} else if (!previewHost && !base.hostname.startsWith('www.')) {
		origins.add(`${base.protocol}//www.${base.host}`);
	}

	return (cached = {
		ok: true,
		config: {
			dbUrl: TURSO_DATABASE_URL ?? LOCAL_DB,
			dbAuthToken: TURSO_AUTH_TOKEN,
			// Dev only: a fixed secret so local sessions survive restarts.
			secret: BETTER_AUTH_SECRET ?? 'film-lab-local-development-secret-not-for-production',
			baseURL,
			rpID: base.hostname,
			origins: [...origins],
			// Local development has a fixed setup code (its database is a local file).
			setupToken: FILM_LAB_SETUP_TOKEN ?? (production ? undefined : DEV_SETUP_TOKEN),
			production,
		},
	});
}
