import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't read env files itself. By default it works on the local
// SQLite file `npm run dev` uses. `npm run db:migrate:prod` (DRIZZLE_ENV=prod)
// reads the Turso URL and token from .env.production, or from .env if that's
// where they are.
const prod = process.env.DRIZZLE_ENV === 'prod';
if (prod) process.loadEnvFile(existsSync('.env.production') ? '.env.production' : '.env');

const url = prod ? process.env.TURSO_DATABASE_URL : 'file:.data/film-lab.db';
if (!url || (prod && url.startsWith('file:'))) {
	throw new Error('db:migrate:prod needs TURSO_DATABASE_URL (libsql://…) in .env.production or .env.');
}

export default defineConfig({
	schema: './src/lib/lab/server/db/schema.ts',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: {
		url,
		authToken: prod ? process.env.TURSO_AUTH_TOKEN : undefined,
	},
});
