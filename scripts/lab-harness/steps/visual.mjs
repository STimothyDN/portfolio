// Seed realistic logbook data into the LOCAL dev database, then screenshot every lab page.
import { ROOT, require } from '../paths.mjs';

export default async function (h) {
	const { setupOwner, goto, clickSel, waitFor, sleep, shot, check, evaluate } = h;
	const a = await setupOwner();
	await clickSel(a, '.import button');
	await waitFor(a, `/Added/.test(document.querySelector('.import [role=status]')?.innerText ?? '')`, 20000);
	await sleep(2000);

	const { createClient } = require('@libsql/client');
	const db = createClient({ url: `file:${ROOT}/.data/film-lab.db` });
	const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const user = await one(`select id from user limit 1`);
	const uid = user.id;
	const id = () => crypto.randomUUID();
	const stock = async (token) => (await one(`select id from film_stock where user_id = ? and token = ?`, [uid, token])).id;
	const cam = async (token) => (await one(`select id from camera where user_id = ? and token = ?`, [uid, token])).id;
	const lab = async (token) => (await one(`select id from lab where user_id = ? and token = ?`, [uid, token])).id;
	const now = Date.now();
	let n = 23;
	const code = () => `R-0${n++}`;
	const ev = (rollId, status, on, note = null) =>
		db.execute({ sql: `insert into roll_event (id, user_id, roll_id, status, "on", note, created_at) values (?,?,?,?,?,?,?)`, args: [id(), uid, rollId, status, on, note, now + Math.random() * 1000] });
	async function roll({ token, status, statusOn, camera = null, labT = null, expires = null, price = null, spot = null, iso = null, order = null, cost = null, title = null }) {
		const rid = id();
		await db.execute({
			sql: `insert into roll (id, user_id, code, stock_id, exposures, title, status, status_on, expires, price_cents, storage_spot, camera_id, shot_at_iso, lab_id, lab_order, dev_cost_cents, purchased_on, created_at, updated_at) values (?,?,?,?,36,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			args: [rid, uid, code(), await stock(token), title, status, statusOn, expires, price, spot, camera ? await cam(camera) : null, iso, labT ? await lab(labT) : null, order, cost, '2026-09-20', now, now],
		});
		return rid;
	}
	// Storage: a stocked fridge
	const fridge = [
		['proimage100', 'Fridge door', '2028-06', 950], ['proimage100', 'Fridge door', '2028-06', 950], ['portra400', 'Fridge door', '2027-11', 1899],
		['portra400', 'Fridge door', '2027-11', 1899], ['hp5', 'Crisper drawer', '2029-01', 899], ['hp5', 'Crisper drawer', '2029-01', 899],
		['cinestill800t', 'Crisper drawer', '2027-03', 1599], ['gold200', 'Fridge door', '2026-12', 849], ['ektacolorpro400', 'Freezer', '2016-04', 600],
		['lomocolor92', 'Crisper drawer', '2027-03', 1299],
	];
	for (const [t, spot, exp, price] of fridge) {
		const r = await roll({ token: t, status: 'storage', statusOn: '2026-09-20', expires: exp, price, spot });
		await ev(r, 'storage', '2026-09-20');
	}
	// Loaded now, with frames
	const frames = async (rollId, cameraId, count, plan) => {
		for (let i = 1; i <= count; i++) {
			const [ap, sh] = plan[i % plan.length];
			const hour = 8 + ((i * 5) % 11);
			const day = Date.UTC(2026, 10, 1 + (i % 7), hour + 5, (i * 7) % 60);
			await db.execute({
				sql: `insert into frame (id, user_id, roll_id, client_id, number, shot_at, tz_offset, camera_id, aperture, shutter, flash, lat, lng, accuracy, note, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,0,?,?,120,?,?,?)`,
				args: [id(), uid, rollId, id(), i, day, -300, cameraId, ap, sh, 35.99 + i / 1000, -78.9, i % 6 === 0 ? 'dusk light on the brick' : null, now, now],
			});
		}
	};
	const manual = [[8, '1/125'], [11, '1/250'], [5.6, '1/60'], [16, '1/250'], [8, '1/250'], [2.8, '1/30'], [4, '1/60'], [11, '1/125'], [16, '1/125'], [1.7, '1/15']];
	const x700 = await roll({ token: 'portra400', status: 'camera', statusOn: '2026-10-27', camera: 'minoltax700', iso: 400, price: 1899 });
	await ev(x700, 'storage', '2026-10-10'); await ev(x700, 'camera', '2026-10-27');
	await frames(x700, await cam('minoltax700'), 22, manual);
	// A lens for the X-700, on its frames.
	const rokkor = id();
	await db.execute({
		sql: `insert into lens (id, user_id, brand, name, mount, focal_min, max_aperture, status, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)`,
		args: [rokkor, uid, 'Minolta', 'MD Rokkor-X 50mm f/1.7', 'Minolta SR (MD)', 50, 1.7, 'active', now, now],
	});
	await db.execute({ sql: `update frame set lens_id = ? where roll_id = ?`, args: [rokkor, x700] });
	const xrm = await roll({ token: 'hp5', status: 'camera', statusOn: '2026-11-05', camera: 'ricohxrm', iso: 800, price: 899 });
	await ev(xrm, 'storage', '2026-10-10'); await ev(xrm, 'camera', '2026-11-05');
	await frames(xrm, await cam('ricohxrm'), 9, [[5.6, '1/30'], [4, '1/60'], [2.8, '1/60'], [8, '1/125']]);
	const epic = await roll({ token: 'cinestill800t', status: 'camera', statusOn: '2026-10-14', camera: 'nikononetouch', price: 1599 });
	await ev(epic, 'storage', '2026-10-01'); await ev(epic, 'camera', '2026-10-14');
	await frames(epic, await cam('nikononetouch'), 30, [[null, null]]);
	// Through the lab, with timings
	const journeys = [
		['ultramax400', 'ricohaf40', 'fotoshoppe', ['2026-09-02', '2026-09-20', '2026-09-22', '2026-10-01'], 'scanned'],
		['gold200', 'olympusinfinityjr', 'fotoshoppe', ['2026-09-10', '2026-09-28', '2026-09-30', '2026-10-08'], 'negatives'],
		['fuji400', 'minoltax700', 'seccarrboro', ['2026-09-25', '2026-10-12', '2026-10-14', '2026-10-19'], 'negatives'],
		['lucky200', 'ricohaf40', 'seccarrboro', ['2026-10-01', '2026-10-24', '2026-10-27', '2026-11-02'], 'scanned'],
		['proimage100', 'minoltax700', 'fotoshoppe', ['2026-10-05', '2026-10-25', '2026-10-28', null], 'lab'],
		['candido800', 'olympusaf1', null, ['2026-10-10', '2026-11-01', null, null], 'shot'],
	];
	for (const [t, c, l, [loaded, shotOn, sent, scans], status] of journeys) {
		const statusOn = { shot: shotOn, lab: sent, scanned: scans, negatives: scans }[status];
		const r = await roll({ token: t, status, statusOn, camera: c, labT: l, price: 1199, order: l ? `A-${2200 + n}` : null, cost: l ? 1800 : null });
		await ev(r, 'storage', '2026-08-30');
		await ev(r, 'camera', loaded);
		await ev(r, 'shot', shotOn);
		if (sent) await ev(r, 'lab', sent);
		if (scans) await ev(r, 'scanned', scans);
		if (status === 'negatives') await ev(r, 'negatives', scans);
		if (status !== 'shot') await frames(r, await cam(c), 12 + (n % 10), manual.slice(n % 4));
	}
	check('seeded the local logbook', true);

	// ---------- screenshots ----------
	const pages = [
		['home', '/photography/lab/', 1500],
		['rolls', '/photography/lab/rolls/', 2600],
		['roll', '/photography/lab/rolls/R-001/', 1500],
		['roll-loaded', '/photography/lab/rolls/R-033/', 1300],
		['fridge', '/photography/lab/fridge/', 1300],
		['gear', '/photography/lab/gear/', 1500],
		['labs', '/photography/lab/labs/', 1300],
		['shoot', '/photography/lab/shoot/?roll=R-033', 900],
	];
	const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
	for (const [name, path, height] of pages) {
		if (only && !only.includes(name)) continue;
		await goto(a, path);
		await sleep(1800);
		await shot(a, `v-${name}-light`, { width: 1280, height, light: true });
		await shot(a, `v-${name}-dark`, { width: 1280, height });
		await shot(a, `v-${name}-phone`, { width: 390, height: 844, mobile: true, light: true });
	}
	const err = await evaluate(a, `document.querySelectorAll('.lab-error').length`);
	check('no error messages on the last page', err === 0);
	return { a, db, uid };
}
