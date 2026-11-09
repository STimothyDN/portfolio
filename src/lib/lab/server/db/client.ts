import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';

import type { LabConfig } from '../config';
import * as schema from './schema';

export type LabDb = LibSQLDatabase<typeof schema>;

let db: Promise<LabDb> | undefined;

/**
 * The Turso connection, created on first use. Production talks to Turso over
 * HTTP (the web client: no native module in the function bundle); local
 * development opens the SQLite file with the full client.
 */
export function getDb(config: LabConfig): Promise<LabDb> {
	db ??= (async () => {
		const local = config.dbUrl.startsWith('file:');
		const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
		const client = createClient({ url: config.dbUrl, authToken: config.dbAuthToken });
		return drizzle(client, { schema });
	})();
	return db;
}
