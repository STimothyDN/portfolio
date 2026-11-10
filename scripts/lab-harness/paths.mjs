// Where the harness lives and writes. Everything it writes goes under .data/ (git-ignored).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = process.env.LAB_OUT ?? join(ROOT, '.data/harness');
export const SHOTS = join(OUT, 'shots');
export const SESSION = join(OUT, 'session.json');
export const DB_URL = `file:${join(ROOT, '.data/film-lab.db')}`;
mkdirSync(SHOTS, { recursive: true });

export const require = createRequire(join(ROOT, 'package.json'));
/** The LOCAL dev database (never production). */
export const localDb = () => require('@libsql/client').createClient({ url: DB_URL });
