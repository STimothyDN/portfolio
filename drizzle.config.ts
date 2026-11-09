import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't read env files itself. By default it works on the local
// SQLite file `npm run dev` uses. `npm run db:migrate:prod` sets DRIZZLE_ENV to
// .env.production (gitignored), which holds the Turso URL and token.
const envFile = process.env.DRIZZLE_ENV;
if (envFile) process.loadEnvFile(envFile);

const url = envFile ? process.env.TURSO_DATABASE_URL : 'file:.data/film-lab.db';
if (!url) throw new Error(`TURSO_DATABASE_URL is missing from ${envFile}.`);

export default defineConfig({
	schema: './src/lib/lab/server/db/schema.ts',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: {
		url,
		authToken: envFile ? process.env.TURSO_AUTH_TOKEN : undefined,
	},
});
