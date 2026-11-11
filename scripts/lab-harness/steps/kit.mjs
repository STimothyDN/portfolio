// The kit and workflow additions: shutter ranges, the battery box, lenses on
// rolls, suggested scan alignment, the darkroom, the trip planner, contact
// sheets, the binder's unshot tray and the bench at laptop sizes. Seeds first.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, evaluate, waitFor, send, sleep, check, shot, text, fill } = h;
	const { a, db, uid } = await visual(h);
	const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const desk = (w = 1440, hh = 1000) => send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false }, a);
	await desk();
	const click = (sel, txt) =>
		evaluate(a, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => ${txt ? `b.innerText.trim().startsWith(${JSON.stringify(txt)})` : 'true'}); if (!el) return false; el.click(); return true; })()`);

	// ---------- shutter range: the X-700 tops out at 1/1000 ----------
	await goto(a, '/photography/lab/shoot/?roll=R-033');
	await sleep(800);
	const dial = await evaluate(a, `[...document.querySelectorAll('.exposure [role=option], .exposure button, .exposure li')].map((e) => e.innerText.trim()).filter((t) => /^1\\/\\d+$/.test(t))`);
	check('shooting mode offers only the X-700’s speeds', dial.includes('1/1000') && !dial.includes('1/2000') && !dial.includes('1/4000'), dial.slice(-3).join(','));
	await click('.summary');
	await sleep(500);
	const picks = await evaluate(a, `[...document.querySelectorAll('.picks li')].map((l) => l.innerText.replace(/\\s+/g, ' '))`);
	check('the meter never suggests a speed the camera hasn’t got', picks.length > 0 && picks.every((p) => !/1\/(2000|4000)/.test(p)), picks.join(' | '));

	// ---------- the battery box ----------
	await db.execute({ sql: `update camera set battery_changed_on = '2024-03-01' where user_id = ? and token = 'minoltax700'`, args: [uid] });
	await goto(a, '/photography/lab/gear/');
	await sleep(700);
	check('the battery box lists LR44 with the X-700', /LR44/.test(await text(a, '#batteries')) && /Minolta X-700 · 2 each/.test(await text(a, '#batteries')));
	await fill(a, '#batt-type', 'SR44');
	await fill(a, '#batt-n', '4');
	await click('.box-add button');
	await waitFor(a, `document.querySelector('.cell-count b')?.innerText === '4'`);
	check('SR44s go in the LR44 compartment', (await one(`select on_hand from battery_stock where user_id = ? and type = 'LR44'`, [uid]))?.on_hand === 4);
	await click('.takers button', 'Swap in fresh');
	await waitFor(a, `document.querySelector('.cell-count b')?.innerText === '2'`);
	const cam = await one(`select battery_changed_on as d from camera where user_id = ? and token = 'minoltax700'`, [uid]);
	const svc = await one(`select cells_from_stock as n from service_log where user_id = ? and kind = 'battery'`, [uid]);
	check('a swap takes two from the box and dates the set', cam.d === (await evaluate(a, `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())`)) && svc?.n === 2);
	// The form: shutter range and the box.
	await click('.card', '');
	await waitFor(a, `!!document.querySelector('dialog[open] #cam-fastest')`);
	check('the camera form shows its model’s shutter range', /1\/1000/.test(await evaluate(a, `document.querySelector('#cam-fastest').selectedOptions[0].text`)));
	check('cells and type are their own fields', (await evaluate(a, `document.querySelector('#cam-battery-n').value + ' ' + document.querySelector('#cam-battery').value`)) === '2 LR44');
	await click('dialog[open] .lab-rows .lab-link', 'Remove');
	await sleep(700);
	check('removing the swap puts the cells back', (await one(`select on_hand from battery_stock where user_id = ? and type = 'LR44'`, [uid]))?.on_hand === 4);
	await evaluate(a, `document.querySelector('dialog[open]')?.close()`);

	// ---------- a lens on the roll ----------
	await goto(a, '/photography/lab/');
	await sleep(800);
	// Free the X-700: finish R-033 first.
	await evaluate(a, `fetch('/_actions/lab.advanceRoll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: ${JSON.stringify((await one(`select id from roll where user_id = ? and code = 'R-033'`, [uid])).id)}, to: 'shot', on: '2026-11-11' }) })`);
	await goto(a, '/photography/lab/');
	await sleep(900);
	await click('.tool', 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	const x700 = (await one(`select id from camera where user_id = ? and token = 'minoltax700'`, [uid])).id;
	await evaluate(a, `(() => { const s = document.querySelector('dialog[open] #step-camera'); s.value = ${JSON.stringify(x700)}; s.dispatchEvent(new Event('change')); })()`);
	await sleep(400);
	check('loading into an SLR asks for the lens, the last one used chosen', /Rokkor/.test(await evaluate(a, `document.querySelector('dialog[open] #step-lens')?.selectedOptions[0]?.text ?? ''`)));
	await click('dialog[open] button[type=submit]');
	await sleep(1200);
	const loaded = await one(`select r.code, l.name from roll r join lens l on l.id = r.lens_id where r.user_id = ? and r.status = 'camera' and r.camera_id = ?`, [uid, x700]);
	check('the roll records its lens', /Rokkor/.test(loaded?.name ?? ''), loaded?.code);
	await goto(a, `/photography/lab/rolls/${loaded.code}/`);
	await sleep(700);
	check('the roll page names the lens', /Rokkor/.test(await text(a, '.summary')));
	check('the details form has the lens', /Rokkor/.test(await evaluate(a, `document.querySelector('#d-lens')?.selectedOptions[0]?.text ?? ''`)));

	// ---------- suggested alignment on a desk roll ----------
	const r1 = (await one(`select id from roll where user_id = ? and code = 'R-001'`, [uid])).id;
	for (let n = 1; n <= 8; n++) {
		await db.execute({
			sql: `insert into frame (id, user_id, roll_id, client_id, number, shot_at, tz_offset, aperture, shutter, flash, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,0,?,?)`,
			args: [crypto.randomUUID(), uid, r1, crypto.randomUUID(), n, Date.now(), -300, 8, '1/125', Date.now(), Date.now()],
		});
	}
	await goto(a, '/photography/lab/rolls/R-001/');
	await sleep(900);
	const sug = await text(a, '.suggest');
	check('the strip suggests an alignment from the file names', /file names/.test(sug) && /scan 1 is frame 00/.test(sug), sug.slice(0, 160));
	await click('.suggest button', 'Line them up');
	await waitFor(a, `!document.querySelector('.suggest')`);
	const after = await one(`select first_scan_frame as f from roll where id = ?`, [r1]);
	const pins = await one(`select count(*) as n from frame where roll_id = ? and scan_filename is not null`, [r1]);
	check('lining up sets frame 00 first and pins past the skipped frame', after.f === -1 && Number(pins.n) >= 1, `first ${after.f}, ${pins.n} pins`);
	// Frame 4 was never scanned (the lab skipped it), so seven of the eight logged frames have a scan.
	check('after lining up, the count is the truth: frame 4 has no scan', /7 of 8 logged frames line up/.test(await text(a, '.align')), await text(a, '.align'));

	// ---------- contact sheet ----------
	await goto(a, '/photography/lab/rolls/R-001/sheet/');
	await waitFor(a, `!document.querySelector('#sheet-download')?.disabled`, 20000);
	const sheet = await evaluate(a, `(() => { const c = document.querySelector('.sheet-canvas'); let ok = true; try { c.toDataURL(); } catch { ok = false; } return { w: c.width, h: c.height, ok }; })()`);
	check('the contact sheet draws and can be downloaded', sheet.w > 2000 && sheet.h > 1000 && sheet.ok, JSON.stringify(sheet));
	await shot(a, 'kit-sheet', { width: 1280, height: 1500, light: true });
	await goto(a, `/photography/lab/rolls/${loaded.code}/sheet/`);
	await waitFor(a, `!document.querySelector('#sheet-download')?.disabled`, 10000);
	check('a roll with no scans gets a shooting-log sheet', /shooting log/.test(await text(a, '.sheet-head')));

	// ---------- the darkroom ----------
	await goto(a, '/photography/lab/darkroom/?roll=R-041');
	await sleep(800);
	check('the darkroom offers the C-41 kit for a C-41 roll', /Cs41/.test(await evaluate(a, `document.querySelector('#dr-recipe').selectedOptions[0].text`)));
	await click('#dr-mix');
	await waitFor(a, `!!document.querySelector('#mix-name')`);
	await fill(a, '#mix-name', 'Cs41 kit');
	await evaluate(a, `(() => { const s = document.querySelector('#mix-kind'); s.value = 'c41'; s.dispatchEvent(new Event('change')); })()`);
	await sleep(200);
	await fill(a, '#mix-cap', '24');
	await click('.mix button[type=submit]');
	await waitFor(a, `document.querySelectorAll('.bottle').length === 1`);
	await db.execute({ sql: `update chemistry set rolls_used = 5 where user_id = ?`, args: [uid] });
	await goto(a, '/photography/lab/darkroom/?roll=R-041');
	await sleep(800);
	check('a used kit lengthens the developer time (+2% a roll)', /3:51/.test(await text(a, '.dev-time')) && /5 rolls already through/.test(await text(a, '.plan')), await text(a, '.plan'));
	await click('#dr-start');
	await waitFor(a, `!!document.querySelector('.timer')`);
	await click('#dr-go');
	await sleep(1500);
	check('the timer runs and calls the first agitation', /Agitate|Next agitation/.test(await text(a, '.readout')), await text(a, '.readout'));
	for (let i = 0; i < 5; i++) {
		await click('#dr-next');
		await sleep(150);
	}
	await waitFor(a, `!!document.querySelector('#dr-log')`);
	await click('#dr-log');
	await sleep(1500);
	const dev = await one(`select r.status, r.dev_run, l.home from roll r left join lab l on l.id = r.lab_id where r.user_id = ? and r.code = 'R-041'`, [uid]);
	check('the run is recorded and the roll moves to developed at home', dev.status === 'lab' && dev.home === 1 && /Cs41/.test(dev.dev_run ?? ''), JSON.stringify(dev).slice(0, 200));
	check('the kit counts the roll', (await one(`select rolls_used as n from chemistry where user_id = ?`, [uid])).n === 6);
	await goto(a, '/photography/lab/rolls/R-041/');
	await sleep(600);
	check('the roll page says developed at home', /developed at home/i.test(await text(a, '.stage-stamp')), await text(a, '.stage-stamp'));
	await desk(1280, 900);
	await goto(a, '/photography/lab/darkroom/');
	await sleep(800);
	await shot(a, 'kit-darkroom', { width: 1280, height: 1800, light: true });

	// ---------- the trip planner ----------
	await db.execute({
		sql: `insert into trip (id, user_id, name, place, lat, lng, start_on, end_on, plan, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)`,
		args: [crypto.randomUUID(), uid, 'Asheville', 'Asheville, North Carolina', 35.6, -82.55, '2026-11-20', '2026-11-23', JSON.stringify({ cameras: [x700], intensity: 'usual', evenings: true, flying: true, rolls: [] }), Date.now(), Date.now()],
	});
	await goto(a, '/photography/lab/trip/');
	await sleep(2500);
	check('a saved trip opens with its days', (await evaluate(a, `document.querySelectorAll('.days .day').length`)) === 4);
	check('the days carry sun times', /↑ \d\d:\d\d/.test(await text(a, '.days')));
	const film = await text(a, '.film');
	check('it says how many rolls and which speeds', /\d+ rolls? to bring/.test(film) && /ISO/.test(film), film.slice(0, 160));
	check('flying with fast film warns about x-rays', /hand check/.test(await text(a, '.checks')));
	const toPack = await evaluate(a, `document.querySelectorAll('.picked input:checked').length`);
	await click('#trip-pack');
	await sleep(900);
	const bag = await one(`select count(*) as n from roll where user_id = ? and storage_spot = 'Trip: Asheville'`, [uid]);
	check('packing moves the picked rolls to a Trip shelf', toPack > 0 && Number(bag.n) === toPack, `${bag.n} of ${toPack}`);
	await shot(a, 'kit-trip', { width: 1280, height: 1900, light: true });

	// ---------- the binder's unshot tray ----------
	await desk();
	await goto(a, '/photography/lab/rolls/');
	await sleep(800);
	const unshot = await evaluate(a, `document.querySelectorAll('.unshot li').length`);
	const stored = Number((await one(`select count(*) as n from roll where user_id = ? and status = 'storage'`, [uid])).n);
	check('unshot film sits in a compact tray, not as blank sleeves', unshot === stored && (await evaluate(a, `document.querySelectorAll('.list .sleeve[data-stage=storage]').length`)) === 0, `${unshot} of ${stored}`);

	// ---------- the bench never clips a station ----------
	for (const [w, hh] of [
		[1440, 900],
		[1280, 720],
	]) {
		await desk(w, hh);
		await goto(a, '/photography/lab/');
		await sleep(900);
		const clipped = await evaluate(
			a,
			// Cut off: a scroller hiding content, or content running past its station's edge.
			`[...document.querySelectorAll('.zone:not(.z-today) .z-body')].filter((b) => {
				const z = b.closest('.zone').getBoundingClientRect();
				const scrolls = getComputedStyle(b).overflowY !== 'visible' && b.scrollHeight > b.clientHeight + 2;
				return scrolls || b.getBoundingClientRect().top + b.scrollHeight > z.bottom + 2;
			}).map((b) => b.closest('.zone').className)`
		);
		check(`at ${w}×${hh} no station on the bench is cut off`, clipped.length === 0, clipped.join(' | '));
	}
}
