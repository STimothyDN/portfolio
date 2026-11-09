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
	VERCEL_DEPLOY_HOOK_URL,
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
	/** Vercel deploy hook for "Publish to portfolio" (production only). */
	deployHook: string | undefined;
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

	// `npm run dev` never touches production, even with production values in
	// .env: it uses the local SQLite file, localhost and the dev setup code.
	// FILM_LAB_DEV_DATABASE=remote opts in to TURSO_DATABASE_URL (read-only
	// browsing of real data, say), though timo3.dev passkeys still won't sign
	// in on localhost.
	const devRemote = !production && process.env.FILM_LAB_DEV_DATABASE === 'remote';
	const devURL = BETTER_AUTH_URL?.startsWith('http://localhost') ? BETTER_AUTH_URL : `http://localhost:${DEV_PORTS[0]}`;
	const baseURL = (previewHost ? `https://${previewHost}` : production ? BETTER_AUTH_URL! : devURL).replace(/\/$/, '');
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
			dbUrl: production || devRemote ? (TURSO_DATABASE_URL ?? LOCAL_DB) : LOCAL_DB,
			dbAuthToken: production || devRemote ? TURSO_AUTH_TOKEN : undefined,
			// Dev only: a fixed secret so local sessions survive restarts.
			secret: BETTER_AUTH_SECRET ?? 'film-lab-local-development-secret-not-for-production',
			baseURL,
			rpID: base.hostname,
			origins: [...origins],
			// Local development has a fixed setup code (its database is a local file).
			setupToken: production ? FILM_LAB_SETUP_TOKEN : DEV_SETUP_TOKEN,
			deployHook: production && !previewHost ? VERCEL_DEPLOY_HOOK_URL : undefined,
			production,
		},
	});
}

/**
 * The film desk is the owner's portfolio: importing it, linking scans to it
 * and reading insight from it are theirs alone (everyone else's logbook is
 * their own film).
 */
export const isOwner = (user: unknown) => (user as { role?: string } | null)?.role === 'owner';
