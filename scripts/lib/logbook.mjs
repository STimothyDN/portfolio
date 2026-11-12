/**
 * The Film Lab logbook, from the command line (for `upload-film --roll`).
 *
 * With FILM_LAB_API_URL (https://lab.timo3.dev/api) and FILM_LAB_API_TOKEN (a
 * personal token made in the film-labs repo: `npm run token:create`) it asks
 * the Film Labs API. Otherwise it reads the database itself, as before:
 * TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the env (the npm script loads
 * .env), or FILM_LAB_UPLOAD_DB=file:.data/film-lab.db for the local
 * development database.
 */
import { createClient } from '@libsql/client';

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Ask the Film Labs API; its refusals come back as sentences. */
async function api({ url, token }, path, body) {
	const res = await fetch(`${url}${path}`, {
		method: body ? 'POST' : 'GET',
		headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error?.message ?? `Film Labs answered HTTP ${res.status}.`);
	return data;
}

export function openLogbook() {
	const apiUrl = process.env.FILM_LAB_API_URL?.replace(/\/$/, '');
	if (apiUrl && !process.env.FILM_LAB_UPLOAD_DB) {
		if (!process.env.FILM_LAB_API_TOKEN) throw new Error('--roll needs FILM_LAB_API_TOKEN (with FILM_LAB_API_URL) in .env.');
		return { api: { url: apiUrl, token: process.env.FILM_LAB_API_TOKEN } };
	}
	const url = process.env.FILM_LAB_UPLOAD_DB || process.env.TURSO_DATABASE_URL;
	if (!url) throw new Error('--roll needs the logbook: set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) in .env.');
	const local = url.startsWith('file:');
	return createClient({ url, authToken: local ? undefined : process.env.TURSO_AUTH_TOKEN });
}

/**
 * The owner's roll with this code, with the folder tokens its camera, stock
 * and lab go by. Rows added by hand in the lab have no token yet: one is made
 * from the name (and saved back when `save` is true, so it sticks).
 */
export async function rollForUpload(db, code) {
	if (db.api) return api(db.api, `/v1/rolls/${encodeURIComponent(code)}/upload`);
	const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const owner = await one(`select id from user where role = 'owner' limit 1`);
	if (!owner) throw new Error('The logbook has no owner account yet.');
	const roll = await one(
		`select r.id, r.code, r.title, r.status, r.public_roll_id as publicRollId,
		        s.id as stockId, s.token as stockToken, s.name as stockName, s.brand as stockBrand,
		        c.id as cameraId, c.token as cameraToken, c.name as cameraName, c.brand as cameraBrand,
		        l.id as labId, l.token as labToken, l.name as labName
		   from roll r
		   join film_stock s on s.id = r.stock_id
		   left join camera c on c.id = r.camera_id
		   left join lab l on l.id = r.lab_id
		  where r.user_id = ? and r.code = ?`,
		[owner.id, code.toUpperCase()]
	);
	if (!roll) throw new Error(`No roll ${code.toUpperCase()} in the logbook.`);
	if (!roll.cameraId) throw new Error(`${roll.code} has no camera recorded. Set it on the roll's page first.`);
	if (!roll.labId) throw new Error(`${roll.code} has no lab recorded. Set it on the roll's page first.`);
	const scanned = await one(
		`select "on" from roll_event where roll_id = ? and status = 'scanned' order by created_at desc limit 1`,
		[roll.id]
	);
	return {
		ownerId: owner.id,
		...roll,
		stockToken: roll.stockToken || squash(roll.stockName),
		cameraToken: roll.cameraToken || squash(roll.cameraName),
		labToken: roll.labToken || squash(roll.labName),
		needsTokens: { stock: !roll.stockToken, camera: !roll.cameraToken, lab: !roll.labToken },
		scannedOn: scanned?.on ?? null,
	};
}

/**
 * After the upload: give hand-made rows their tokens, tie the roll to its
 * desk roll, and move it to "Scans in" if it hadn't got there yet.
 */
export async function linkUploadedRoll(db, roll, deskRollId, developed) {
	if (db.api) return void (await api(db.api, `/v1/rolls/${encodeURIComponent(roll.code)}/upload`, { deskRollId, developed }));
	const writes = [];
	if (roll.needsTokens.stock) writes.push({ sql: `update film_stock set token = ? where id = ?`, args: [roll.stockToken, roll.stockId] });
	if (roll.needsTokens.camera) writes.push({ sql: `update camera set token = ? where id = ?`, args: [roll.cameraToken, roll.cameraId] });
	if (roll.needsTokens.lab) writes.push({ sql: `update lab set token = ? where id = ?`, args: [roll.labToken, roll.labId] });
	writes.push({ sql: `update roll set public_roll_id = ?, updated_at = ? where id = ?`, args: [deskRollId, Date.now(), roll.id] });
	if (['storage', 'camera', 'shot', 'lab'].includes(roll.status)) {
		writes.push({ sql: `update roll set status = 'scanned', status_on = ? where id = ?`, args: [developed, roll.id] });
		writes.push({
			sql: `insert into roll_event (id, user_id, roll_id, status, "on", note, created_at) values (?, ?, ?, 'scanned', ?, 'Scans uploaded', ?)`,
			args: [crypto.randomUUID(), roll.ownerId, roll.id, developed, Date.now()],
		});
	}
	await db.batch(writes, 'write');
}
