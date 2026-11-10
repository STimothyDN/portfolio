// Phase 5: insight. Seeds the visual logbook (no screenshots), then checks each insight surface.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, clickSel, clickText, text, shot, evaluate, waitFor, sleep, check, send } = h;
	// No sideways scrolling on a phone.
	const fitsPhone = async (name) => {
		await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
		await sleep(500);
		const [sw, iw, culprit] = await evaluate(
			a,
			`(() => { const iw = innerWidth; const wide = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > iw + 1).map((e) => e.className || e.tagName).slice(-3); return [document.documentElement.scrollWidth, iw, wide.join(' / ')]; })()`
		);
		await send('Emulation.clearDeviceMetricsOverride', {}, a);
		check(`${name} fits a phone`, sw <= iw, `${sw} > ${iw}: ${culprit}`);
	};
	const { a, db, uid } = await visual(h);
	const only = (process.env.P5 ?? 'shoot,frames,table,desk,almanac,fridge').split(',');

	// Frames on two desk-linked rolls, so their scans line up: a spread of light, from sun to dusk.
	const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const lensId = (await one(`select id from lens where user_id = ? limit 1`, [uid])).id;
	const plan = [[16, '1/250'], [11, '1/250'], [8, '1/125'], [5.6, '1/60'], [2.8, '1/30'], [1.7, '1/15'], [8, '1/500'], [4, '1/60'], [2, '1/30'], [11, '1/125']];
	for (const code of ['R-021', 'R-020']) {
		const r = await one(`select id, camera_id from roll where code = ?`, [code]);
		for (let i = 1; i <= 24; i++) {
			const [ap, sh] = plan[i % plan.length];
			await db.execute({
				sql: `insert into frame (id, user_id, roll_id, client_id, number, shot_at, tz_offset, camera_id, lens_id, focal_length, aperture, shutter, flash, lat, lng, accuracy, note, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,100,?,?,?)`,
				args: [crypto.randomUUID(), uid, r.id, crypto.randomUUID(), i, Date.UTC(2026, 9, code === 'R-021' ? 18 : 6, 14 + (i % 8), i), -240, r.camera_id, lensId, 50, ap, sh, code === 'R-021' ? 35.77 + (i % 3) / 200 : 35.91, code === 'R-021' ? -78.66 : -79.05 + (i % 2) / 300, i % 7 === 0 ? 'kites over the hill' : null, Date.now(), Date.now()],
			});
		}
	}

	// ---------- Shooting mode: the Light drawer ----------
	if (only.includes('shoot')) {
		await goto(a, '/photography/lab/shoot/?roll=R-033');
		await waitFor(a, `!!document.querySelector('.light .summary')`);
		const sum = await text(a, '.light .summary');
		check('light summary reads the sky and sun', /·/.test(sum) && /(Golden|Blue) hour|stays down/.test(sum), sum.replace(/\n/g, ' | '));
		await clickSel(a, '.light .summary');
		await waitFor(a, `!!document.querySelector('#light-drawer')`);
		await clickText(a, 'Bright sun');
		const picks = await evaluate(a, `[...document.querySelectorAll('#light-drawer .pick')].map((b) => b.innerText.replace(/\\n/g, ' '))`);
		check('bright sun at ISO 400 offers three settings', picks.length === 3 && picks.some((p) => /f\/16 · 1\/500/.test(p)), picks.join(' | '));
		await evaluate(a, `[...document.querySelectorAll('#light-drawer .pick')].find((b) => /Deep focus/.test(b.innerText)).click()`);
		await sleep(300);
		const dials = await evaluate(a, `[...document.querySelectorAll('.exposure [aria-pressed="true"], .exposure .selected, .exposure [aria-selected="true"]')].map((e) => e.textContent.trim()).join(' ')`);
		const checkLine = await text(a, '#light-drawer .check');
		check('tapping a setting sets the dials and the check agrees', /right on the reading/.test(checkLine), `${checkLine} / dials: ${dials}`);
		await clickSel(a, '[data-tab=focus]');
		const focusText = await waitFor(a, `document.querySelector('#light-drawer .focus')?.innerText`, 3000);
		check('zone focus for the 50mm at the dial aperture', /50mm at f\/16/i.test(focusText ?? '') && /10\.? ?m|5\.3 m/.test(focusText ?? ''), (focusText ?? '').replace(/\n/g, ' | ').slice(0, 160));
		await shot(a, 'p5-shoot-focus', { width: 390, height: 1100, mobile: true, light: true });
		await clickSel(a, '[data-tab=sun]');
		check('sun tab lists today’s light', /Sunset/.test(await text(a, '#light-drawer')));
		await clickSel(a, '[data-tab=meter]');
		await clickText(a, 'Candlelight');
		const slow = await text(a, '#light-drawer .meter');
		check('candlelight at 400: hand-held wide open, marked half a stop under', /Hand-held/.test(slow) && /f\/1.7 · 1\/30−½/.test(slow), slow.replace(/\n/g, ' | ').slice(0, 160));
		await clickSel(a, '[data-tab=long]');
		check('long exposure tab', !!(await waitFor(a, `!!document.querySelector('#light-drawer .long')`, 3000)));
		const longText = await text(a, '#light-drawer .long');
		check('reciprocity names the stock', /Portra 400/.test(longText), longText.replace(/\n/g, ' | ').slice(0, 200));
		await shot(a, 'p5-shoot-light', { width: 390, height: 1700, mobile: true, light: true });
		await shot(a, 'p5-shoot-light-dark', { width: 390, height: 1700, mobile: true });
		await fitsPhone('shooting mode with the drawer open');
		await clickText(a, 'Auto · Night');
		await clickSel(a, '.icon-btn[aria-pressed]');
		await sleep(300);
		await shot(a, 'p5-shoot-safelight', { width: 390, height: 1400, mobile: true });
		await clickSel(a, '.icon-btn[aria-pressed]');
		// A point-and-shoot gets advice, not settings.
		await goto(a, '/photography/lab/shoot/?roll=R-035');
		await waitFor(a, `!!document.querySelector('.light .summary')`);
		const ps = await text(a, '.light .summary');
		check('point-and-shoot summary talks about light, not settings', /light|dim|flash/i.test(ps), ps.replace(/\n/g, ' | '));
	}

	// ---------- Frames: search, map, how the negatives come back ----------
	if (only.includes('frames')) {
		await goto(a, '/photography/lab/frames/');
		await waitFor(a, `!!document.querySelector('.sheet .cell')`, 10000);
		const count = await text(a, '.read .count');
		check('frames page lists every logged frame', /\d+ frames · \d+ with scans/.test(count), count);
		await evaluate(a, `(() => { const i = document.querySelector('#frame-search'); i.value = 'f/1.7'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
		await sleep(300);
		const apertures = await evaluate(a, `[...document.querySelectorAll('.sheet .exp')].map((e) => e.textContent.split(' · ')[0])`);
		check('search f/1.7 keeps only f/1.7 frames', apertures.length > 0 && apertures.every((x) => x === 'f/1.7'), `${apertures.length}: ${[...new Set(apertures)].join(',')}`);
		check('the query reads back as a chip', /f\/1\.7/.test(await text(a, '.read')));
		check('search lands in the address', /q=f%2F1\.7|q=f\/1\.7/.test(await evaluate(a, 'location.search')));
		await evaluate(a, `(() => { const i = document.querySelector('#frame-search'); i.value = 'kites october'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
		await sleep(300);
		const notes = await evaluate(a, `[...document.querySelectorAll('.sheet .note')].map((e) => e.textContent)`);
		check('words and months combine', notes.length > 0 && notes.every((n) => /kites/.test(n)), `${notes.length} frames`);
		await evaluate(a, `(() => { const i = document.querySelector('#frame-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
		await sleep(300);
		check('the map draws tiles and dots', await waitFor(a, `document.querySelectorAll('.map .tiles img').length > 0 && document.querySelectorAll('.map .dot').length > 0`, 8000));
		const total = () => evaluate(a, `Number(document.querySelector('.read .count').textContent.match(/\\d+/)[0])`);
		const before = await total();
		await evaluate(a, `[...document.querySelectorAll('.map .dot')].sort((x, y) => x.offsetWidth - y.offsetWidth)[0].click()`);
		await sleep(300);
		const after = await total();
		check('tapping a dot narrows the sheet to that spot', after > 0 && after < before && /At this spot/.test(await text(a, '.read')), `${before} → ${after}`);
		// The field: the same dots, re-arranged.
		check('the field draws every logged frame', await evaluate(a, `!!document.querySelector('.frame-field canvas') && /frames placed/.test(document.querySelector('.frame-field').innerText)`));
		const placed = async () => Number((await text(a, '.frame-field .lab-meta')).match(/(\d+) of \d+ frames placed/)?.[1] ?? -1);
		const byExposure = await placed();
		await evaluate(a, `[...document.querySelectorAll('.frame-field .seg button')].find((b) => b.innerText === 'Light × density').click()`);
		await sleep(400);
		const byDensity = await placed();
		check('re-arranging moves frames that can’t be placed into the tray', byDensity >= 0 && byDensity <= byExposure, `${byExposure} by exposure, ${byDensity} by density`);
		await goto(a, '/photography/lab/almanac/');
		const review = await text(a, '#exposure');
		check('desk findings name a camera on the same film', /Olympus AF-1 comes back thin/.test(review));
		check('cameras are compared on the same film', (await evaluate(a, `document.querySelectorAll('#exposure .bars li').length`)) >= 5);
		check('logged frames land on the scatter', (await evaluate(a, `document.querySelectorAll('#exposure .scatter circle').length`)) >= 10);
		await goto(a, '/photography/lab/frames/');
		await sleep(1500);
		await shot(a, 'p5-frames', { width: 1280, height: 2600, light: true });
		await shot(a, 'p5-frames-dark', { width: 1280, height: 2600 });
		await shot(a, 'p5-frames-phone', { width: 390, height: 2400, mobile: true, light: true });
		await fitsPhone('the frames page');
	}

	// ---------- Light table: pace, the desk switch, rewind ----------
	if (only.includes('table')) {
		await goto(a, '/photography/lab/');
		const paces = await evaluate(a, `[...document.querySelectorAll('.cam-foot .pace[title]')].map((e) => e.title)`);
		check('loaded rolls show a pace and a finish', paces.length >= 2 && paces.every((p) => /(a day|a week|a few a month) · (done around|last frames|over a year)/.test(p)), paces.join(' | '));
		const rw = await text(a, '.rewind');
		check('rewind brings back an archive roll', /(A year|Six months|Three months|A month) ago/i.test(rw) && (await evaluate(a, `document.querySelectorAll('.rewind-prints img').length`)) >= 3, rw.replace(/\n/g, ' | ').slice(0, 140));
		check('the owner sees the desk switch, off', (await evaluate(a, `document.querySelector('#share-loaded')?.getAttribute('aria-checked')`)) === 'false');
		await clickSel(a, '#share-loaded');
		check('switching it on saves and offers to publish', await waitFor(a, `document.querySelector('#share-loaded').getAttribute('aria-checked') === 'true' && /Publish to portfolio/.test(document.querySelector('.desk-share').innerText)`, 5000), await text(a, '.desk-share'));
		await shot(a, 'p5-table', { width: 1280, height: 2900, light: true });
		await shot(a, 'p5-table-phone', { width: 390, height: 1600, mobile: true, light: true });
		await fitsPhone('the light table');
	}

	// ---------- The public film desk: loaded now ----------
	if (only.includes('desk')) {
		await goto(a, '/photography/');
		const line = await waitFor(a, `document.querySelector('.loaded-now')?.innerText`, 8000);
		check('the film desk shows what’s loaded (dev reads live)', /In the .+: .+/i.test(line ?? ''), (line ?? '').replace(/\n/g, ' | '));
		await sleep(1500);
		await shot(a, 'p5-desk-loaded', { width: 1280, height: 900, light: true });
		await shot(a, 'p5-desk-loaded-phone', { width: 390, height: 844, mobile: true, light: true });
	}

	// ---------- Almanac: cost per frame, days per camera ----------
	if (only.includes('almanac')) {
		await goto(a, '/photography/lab/almanac/');
		const big = await text(a, '#money');
		check('money: this year, the projection, a frame by film', /this year/.test(big) && /by December/.test(big) && (await evaluate(a, `document.querySelectorAll('#money .bars li').length`)) >= 1, big.replace(/\n/g, ' | ').slice(0, 160));
		check('kit: cameras with rolls, frames and idle days', (await evaluate(a, `document.querySelectorAll('#kit tbody tr').length`)) >= 2);
		check('findings come first, each linking to its chapter', (await evaluate(a, `document.querySelectorAll('.headlines .notes a[href^="#"]').length`)) >= 2);
		check('the rolls/frames switch is there', await evaluate(a, `fetch('/photography/lab/rolls/').then((r) => r.text()).then((t) => /rolls-tabs/.test(t) && /Frames/.test(t))`));
		await shot(a, 'p5-almanac', { width: 1280, height: 3000, light: true });
		await fitsPhone('the almanac');
	}

	// ---------- Fridge: restock forecast ----------
	if (only.includes('fridge')) {
		await goto(a, '/photography/lab/fridge/');
		const top = await text(a, '.topline');
		check('the fridge says how long the film lasts', /you load about [\d.]+ a month, so that’s .+ of film/.test(top), top.replace(/\n/g, ' | '));
		await evaluate(a, `[...document.querySelectorAll('.slot')].find((b) => /Gold 200/.test(b.innerHTML) || /gold/i.test(b.getAttribute('aria-controls') ?? ''))?.click() ?? document.querySelector('.slot').click()`);
		await sleep(400);
		const fc = await text(a, '.group-detail');
		check('each stock gets a forecast', /You load|Not loaded in the last six months/.test(fc), (fc.match(/(You load[^.]*\.|Not loaded[^.]*\.)/) ?? [''])[0]);
		await shot(a, 'p5-fridge', { width: 1280, height: 1500, light: true });
		await fitsPhone('the fridge');
	}
}
