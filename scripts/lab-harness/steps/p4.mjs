// Phase 4: align frames with scans, share, and see it in the public lightbox (local dev reads the logbook live).
import { ROOT, require } from '../paths.mjs';

export default async function (h) {
	const { setupOwner, goto, hydrated, fill, clickText, clickSel, text, shot, evaluate, waitFor, sleep, check } = h;
	const a = await setupOwner();
	await clickSel(a, '.import button');
	await waitFor(a, `/Added/.test(document.querySelector('.import [role=status]')?.innerText ?? '')`, 20000);
	await sleep(2000);

	// Log five frames on R-021 (Dix Park, linked to the desk) straight into the local logbook.
	const { createClient } = require('@libsql/client');
	const db = createClient({ url: `file:${ROOT}/.data/film-lab.db` });
	const row = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const user = await row(`select id from user limit 1`);
	const r21 = await row(`select id, camera_id from roll where code = 'R-021'`);
	const lensId = crypto.randomUUID();
	await db.execute({
		sql: `insert into lens (id, user_id, brand, name, mount, focal_min, max_aperture, status, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)`,
		args: [lensId, user.id, 'Minolta', 'MD Rokkor-X 50mm f/1.7', 'Minolta SR (MD)', 50, 1.7, 'active', Date.now(), Date.now()],
	});
	const plan = [[8, '1/125'], [5.6, '1/60', 'kite flyers'], [11, '1/250'], [16, '1/250'], [2.8, '1/30']];
	for (let i = 0; i < plan.length; i++) {
		const [ap, sh, note] = plan[i];
		await db.execute({
			sql: `insert into frame (id, user_id, roll_id, client_id, number, shot_at, tz_offset, camera_id, lens_id, focal_length, aperture, shutter, flash, lat, lng, accuracy, note, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,0,35.78,-78.67,100,?,?,?)`,
			args: [crypto.randomUUID(), user.id, r21.id, crypto.randomUUID(), i + 1, Date.UTC(2026, 9, 20, 18, i), -240, r21.camera_id, lensId, 50, ap, sh, note ?? null, Date.now(), Date.now()],
		});
	}

	// ---------- Roll page: alignment ----------
	await goto(a, '/photography/lab/rolls/R-021/');
	check('strip says all 5 logged frames line up', /5 of 5 logged frames line up/.test(await text(a, '.strip-wrap')));
	const under1 = await evaluate(a, `document.querySelectorAll('.strip .frame')[0]?.querySelector('.exp')?.textContent`);
	check('scan 1 shows frame 1’s settings', under1 === 'f/8 · 1/125', under1);
	await clickSel(a, '.align button[aria-label="Earlier frame"]');
	await waitFor(a, `document.querySelector('.align b')?.textContent === '0'`);
	const under2 = await evaluate(a, `document.querySelectorAll('.strip .frame')[1]?.querySelector('.exp')?.textContent`);
	const edge1 = await evaluate(a, `document.querySelectorAll('.strip .frame')[0]?.querySelector('.edge')?.textContent.trim()`);
	check('shifting: scan 1 is frame 0, so scan 2 shows frame 1', under2 === 'f/8 · 1/125' && /^0/.test(edge1), `${under2} / edge ${edge1}`);
	check('the frames list follows the shift (frame 1 → scan 2)', await waitFor(a, `[...document.querySelectorAll('#frames tbody tr')][0]?.innerText.includes('scan 2')`, 4000));
	// Pin frame 3 to scan 10
	await evaluate(a, `[...document.querySelectorAll('#frames tbody tr')][2].querySelector('.acts button').click()`);
	await waitFor(a, `!!document.querySelector('#frames .edit-row select[id^=pin-]')`);
	await evaluate(a, `(() => { const s = document.querySelector('#frames .edit-row select[id^=pin-]'); s.selectedIndex = 10; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
	await clickText(a, 'Save');
	check('pin a frame to a scan', await waitFor(a, `/scan 10 · pinned/.test(document.querySelector('#frames')?.innerText ?? '')`, 6000));
	check('the strip follows the pin (scan 10 shows frame 3)', await waitFor(a, `document.querySelectorAll('.strip .frame')[9]?.querySelector('.exp')?.textContent === 'f/11 · 1/250'`, 4000));

	// ---------- Sharing ----------
	check('sharing preview starts empty', /Nothing extra/.test(await text(a, '.share')));
	await clickSel(a, '#share-exposure');
	await clickSel(a, '#share-notes');
	await fill(a, '#share-place', 'Raleigh, NC');
	const preview = await waitFor(a, `document.querySelector('.share .preview p')?.textContent`);
	check('preview shows the lightbox line', /f\/8 · 1\/125 · MD Rokkor-X 50mm f\/1.7 · ISO 400 · Raleigh, NC/.test(preview ?? ''), preview);
	await clickSel(a, '.share .lab-btn--quiet');
	check('sharing saves', await waitFor(a, `[...document.querySelectorAll('.share button')].some((b) => b.textContent.trim() === 'Saved')`));
	await clickText(a, 'Publish to portfolio');
	const pubMsg = await waitFor(a, `document.querySelector('.share .lab-error')?.textContent`);
	check('publishing in dev explains the desk reads live', /reads the logbook live/.test(pubMsg ?? ''), pubMsg);
	await evaluate(a, 'document.body.scrollTo(0, 0); window.scrollTo(0, 0)');
	await shot(a, 'p4-roll-share', { width: 1280, height: 1300, light: true });
	await shot(a, 'p4-roll-phone', { width: 390, height: 1500, mobile: true, light: true });

	// ---------- The public film desk ----------
	await goto(a, '/photography/');
	await sleep(1500);
	const packed = await evaluate(a, `document.querySelector('astro-island[component-url*="FilmDesk"]')?.getAttribute('props') ?? ''`);
	check('the desk carries the shared details', /Raleigh, NC/.test(packed) && /f\/8/.test(packed) && /kite flyers/.test(packed));
	const sharedCount = (packed.match(/Raleigh, NC/g) ?? []).length;
	check('every scan on the roll gets the place (frames add exposure)', sharedCount > 5, `${sharedCount} scans with the place`);
	const otherRoll = await evaluate(a, `(() => { const p = document.querySelector('astro-island[component-url*="FilmDesk"]')?.getAttribute('props') ?? ''; return /lolla1/.test(p); })()`);
	check('other rolls are untouched', otherRoll);

	// Open frame 1's scan (scan 2 now) in the lightbox through the desk itself.
	const opened = await evaluate(
		a,
		`(async () => {
			const p = JSON.parse(JSON.parse(document.querySelector('astro-island[component-url*="FilmDesk"]').getAttribute('props')).packedPhotos[1]);
			const idx = p.findIndex((row) => row[8] && row[8].a === 'f/8' && row[8].s === '1/125');
			if (idx < 0) return 'no packed row';
			const file = p[idx][1];
			// Find any print or strip frame on the page showing that scan and click it.
			const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src).includes(encodeURIComponent(file).replace(/%2F/g, '/')) || (i.currentSrc || i.src).includes(file));
			if (img) { (img.closest('button, a, [role=button]') ?? img).click(); return 'clicked ' + file; }
			return 'not on the pile: ' + file;
		})()`
	);
	if (/^clicked/.test(opened)) {
		await waitFor(a, `!!document.querySelector('[aria-label="Toggle photo info"]')`, 6000);
		await clickSel(a, '[aria-label="Toggle photo info"]');
		const lb = await waitFor(a, `document.querySelector('#lightbox-info')?.innerText`, 6000);
		check('the lightbox shows the frame’s settings and place', /f\/8/.test(lb ?? '') && /1\/125/.test(lb ?? '') && /Raleigh, NC/.test(lb ?? ''), (lb ?? '').replace(/\n/g, ' | ').slice(0, 200));
		await shot(a, 'p4-lightbox', { width: 1280, height: 900, light: true });
	} else {
		// Fall back to filing the desk by this roll, then click the frame in its strip.
		await evaluate(a, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Dix\\/Bond/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))?.click()`);
		await sleep(2500);
		const clicked = await evaluate(
			a,
			`(() => { const p = JSON.parse(JSON.parse(document.querySelector('astro-island[component-url*="FilmDesk"]').getAttribute('props')).packedPhotos[1]); const row = p.find((r) => r[8] && r[8].a === 'f/8' && r[8].s === '1/125'); const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src).includes(row[1])); if (!img) return false; (img.closest('button, a, [role=button]') ?? img).click(); return true; })()`
		);
		if (clicked) {
			await waitFor(a, `!!document.querySelector('[aria-label="Toggle photo info"]')`, 6000);
			await clickSel(a, '[aria-label="Toggle photo info"]');
		}
		const lb = clicked ? await waitFor(a, `document.querySelector('#lightbox-info')?.innerText`, 6000) : null;
		check('the lightbox shows the frame’s settings and place', /f\/8/.test(lb ?? '') && /Raleigh, NC/.test(lb ?? ''), clicked ? (lb ?? '').replace(/\n/g, ' | ').slice(0, 200) : `couldn't reach the frame (${opened})`);
		if (clicked) await shot(a, 'p4-lightbox', { width: 1280, height: 900, light: true });
	}

	// ---------- Uploader: --roll looks the roll up and links it ----------
	const { rollForUpload, linkUploadedRoll } = await import(`${ROOT}/scripts/lib/logbook.mjs`);
	process.env.FILM_LAB_UPLOAD_DB = `file:${ROOT}/.data/film-lab.db`;
	const r20 = await row(`select id, status from roll where code = 'R-020'`);
	await db.execute({ sql: `update roll set public_roll_id = null, status = 'lab', status_on = '2026-11-01' where id = ?`, args: [r20.id] });
	const entry = await rollForUpload(db, 'r-020');
	check('--roll finds the roll and its folder tokens', entry.code === 'R-020' && !!entry.cameraToken && !!entry.stockToken && !!entry.labToken, `${entry.cameraToken}/${entry.stockToken}/${entry.labToken}`);
	await linkUploadedRoll(db, entry, '20261108_test_link', '2026-11-08');
	const after = await row(`select status, status_on, public_roll_id from roll where id = ?`, [r20.id]);
	check('linking moves it to Scans in and ties it to the desk roll', after.status === 'scanned' && after.public_roll_id === '20261108_test_link' && after.status_on === '2026-11-08', JSON.stringify(after));
	let missing = '';
	try {
		await rollForUpload(db, 'R-999');
	} catch (e) {
		missing = e.message;
	}
	check('an unknown code is a clear error', /No roll R-999/.test(missing), missing);
}
