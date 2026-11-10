// Empty every table in the LOCAL dev database (keeps the schema and migrations).
import { ROOT, require } from './paths.mjs';
const { createClient } = require('@libsql/client');
const db = createClient({ url: `file:${ROOT}/.data/film-lab.db` });
const tables = (await db.execute(`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'`)).rows.map((r) => r.name);
await db.execute('PRAGMA foreign_keys = OFF');
for (const t of tables) await db.execute(`delete from "${t}"`);
await db.execute('PRAGMA foreign_keys = ON');
console.log(`emptied ${tables.length} tables`);
