// Phase 3: CineStill adoption, shooting mode, offline logging + sync, rewind,
// roll page frames, QR labels, safelight.
export default async function (h) {
	const { setupOwner, goto, hydrated, fill, clickText, clickSel, text, shot, evaluate, waitFor, once, send, sleep, check, BASE } = h;
	const setSelect = (s, sel, matcher) =>
		evaluate(
			s,
			`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const opt = [...el.options].find((o) => ${matcher}); if (!opt) return false; el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent.trim(); })()`
		);
	const submitDialog = (s) => clickSel(s, 'dialog[open] form button[type=submit]');
	const reload = async (s) => {
		const loaded = once('Page.loadEventFired', s, 30000);
		await send('Page.reload', { ignoreCache: false }, s);
		await loaded;
		await hydrated(s);
	};
	const shootText = (s) => evaluate(s, `document.querySelector('.shoot')?.innerText ?? ''`);
	const counter = (s) => evaluate(s, `document.querySelector('.window b')?.textContent`);

	const a = await setupOwner();

	// ---------- CineStill: a hand-made stock is adopted, not duplicated ----------
	await goto(a, '/photography/lab/fridge/');
	await clickText(a, 'Add film stock');
	await waitFor(a, `!!document.querySelector('dialog[open] #stock-brand')`);
	await fill(a, '#stock-brand', 'CineStill');
	await fill(a, '#stock-name', 'Cinestill 800T');
	await fill(a, '#stock-iso', '800');
	await submitDialog(a);
	await waitFor(a, `/Cinestill 800T/.test(document.querySelector('.catalogue')?.innerText ?? '')`);
	await goto(a, '/photography/lab/');
	await clickSel(a, '.import button');
	await waitFor(a, `/Added 22 rolls/.test(document.querySelector('.import [role=status]')?.innerText ?? '')`, 20000);
	await sleep(2500);
	await goto(a, '/photography/lab/fridge/');
	const cine = await evaluate(a, `[...document.querySelectorAll('.catalogue tbody tr')].filter((tr) => /cinestill 800t/i.test(tr.innerText)).length`);
	check('hand-made CineStill 800T is adopted by the import (one row)', cine === 1, String(cine));
	const stockRows = await evaluate(a, `document.querySelectorAll('.catalogue tbody tr').length`);
	check('catalogue has 26 stocks (every name in film-labels.json, CineStill adopted)', stockRows === 26, String(stockRows));
	const newOnes = await evaluate(a, `[...document.querySelectorAll('.catalogue tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ')).filter((t) => /Candido 400|Lady Grey|Ektar 100|Ektacolor Pro 800/.test(t)).join(' | ')`);
	check('the four new stocks arrive with speed and process', /Candido 400 400 C-41/.test(newOnes) && /Lady Grey 400 400 B&W/.test(newOnes) && /Ektar 100 100 C-41/.test(newOnes) && /Ektacolor Pro 800 800 C-41/.test(newOnes), newOnes);
	check('no "named on the desk" notice once everything matches', !(await evaluate(a, `!!document.querySelector('.desk-sync')`)));
	const cs = await evaluate(a, `getComputedStyle(document.querySelector('.catalogue tbody tr:has(td) .dot') ?? document.body).backgroundColor`);

	// Buy film, add a lens, load a roll
	await clickText(a, 'Add rolls');
	await waitFor(a, `!!document.querySelector('dialog[open] #add-stock')`);
	await setSelect(a, '#add-stock', `o.textContent.includes('ProImage 100')`);
	await fill(a, '#add-qty', '2');
	await fill(a, '#add-spot', 'Fridge door');
	await submitDialog(a);
	await waitFor(a, `/×2/.test(document.querySelector('.fridge')?.innerText ?? '')`);
	await goto(a, '/photography/lab/gear/');
	await clickText(a, 'Add lens');
	await waitFor(a, `!!document.querySelector('dialog[open] #lens-brand')`);
	await fill(a, '#lens-brand', 'Minolta');
	await fill(a, '#lens-mount', 'Minolta SR (MD)');
	await fill(a, '#lens-name', 'MD Rokkor-X 50mm f/1.7');
	await fill(a, '#lens-fmin', '50');
	await fill(a, '#lens-ap', '1.7');
	await submitDialog(a);
	await waitFor(a, `/Rokkor/.test(document.querySelector('.gear')?.innerText ?? '')`);
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	await setSelect(a, '#load-roll', `o.textContent.startsWith('R-023')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	await setSelect(a, '#step-camera', `o.textContent.includes('Minolta X-700')`);
	await submitDialog(a);
	await waitFor(a, `!!document.querySelector('.z-cameras .cam-row a[href*="/shoot/?roll="]')`);
	check('loaded camera offers “Log” and its counter sits at 0', await evaluate(a, `!!document.querySelector('.z-cameras .cam-row [aria-label="Frame counter at 0"]')`));

	// ---------- Shooting mode ----------
	await send('Browser.grantPermissions', { origin: BASE, permissions: ['geolocation'] });
	await send('Emulation.setGeolocationOverride', { latitude: 35.99404, longitude: -78.89863, accuracy: 30 }, a);
	await goto(a, '/photography/lab/shoot/');
	check('shooting mode opens on the loaded camera', /Minolta X-700/.test(await shootText(a)));
	check('counter starts at frame 1', (await counter(a)) === '1');
	check('the one lens that fits is preselected', /Rokkor/.test(await evaluate(a, `document.querySelector('#shoot-lens')?.selectedOptions[0]?.textContent ?? ''`)));
	check('aperture dial starts at the lens’s widest (1.7)', (await evaluate(a, `[...document.querySelectorAll('.dial')][0].querySelectorAll('button')[1].textContent.trim()`)) === '1.7');
	await waitFor(a, `/Rough location saved/.test(document.querySelector('.loc-text')?.textContent ?? '')`, 8000);
	await evaluate(a, `[...document.querySelectorAll('.dial')][0].querySelectorAll('button').forEach((b) => b.textContent.trim() === '8' && b.click())`);
	await evaluate(a, `[...document.querySelectorAll('.dial')][1].querySelectorAll('button').forEach((b) => b.textContent.trim() === '1/125' && b.click())`);
	await fill(a, '#shoot-note', 'fountain');
	await clickSel(a, '.log');
	check('logging moves the counter to 2', await waitFor(a, `document.querySelector('.window b')?.textContent === '2'`));
	check('frame shows f/8 · 1/125 and the note', /1\s*f\/8 · 1\/125[\s\S]*fountain/.test(await shootText(a)));
	check('it syncs', await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 8000));
	await clickSel(a, '.toast button');
	check('undo removes it', await waitFor(a, `document.querySelector('.window b')?.textContent === '1' && !document.querySelector('.recent')`, 8000));
	await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 8000);
	await sleep(1200);
	check('an undone frame stays gone after the sync', (await counter(a)) === '1' && !(await evaluate(a, `!!document.querySelector('.recent')`)), `counter ${await counter(a)}`);
	for (let i = 0; i < 3; i++) {
		await clickSel(a, '.log');
		await sleep(250);
	}
	await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 8000);
	await reload(a);
	check('frames survive a reload (they’re on the server)', await waitFor(a, `/3 frames logged/.test(document.querySelector('.shoot')?.innerText ?? '') && document.querySelector('.window b')?.textContent === '4'`, 6000), await shootText(a).then((t) => t.slice(0, 120).replace(/\n/g, ' | ')));
	check('settings carry over from the last frame', /f\/8 · 1\/125/.test(await shootText(a)));
	const pin = await evaluate(a, `fetch('/photography/lab/rolls/R-023/').then((r) => r.text()).then((t) => (t.match(/&quot;lat&quot;:\\[0,([\\d.-]+)\\]/) ?? [])[1])`);
	check('location is stored rough (3 decimals)', pin === '35.994', pin);
	await shot(a, 'p3-shoot-phone', { width: 390, height: 844, mobile: true, light: true });
	await shot(a, 'p3-shoot-phone-dark', { width: 390, height: 844, mobile: true });

	// ---------- Offline ----------
	await reload(a); // make sure the service worker controls the page
	check('service worker controls shooting mode', await waitFor(a, `!!navigator.serviceWorker.controller`, 8000));
	await reload(a); // and every asset has gone through it once
	const { targetInfos } = await send('Target.getTargets');
	const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/photography/lab/sw.js'));
	check('service worker is registered for /photography/lab/', !!sw, sw?.url);
	const { sessionId: swSession } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
	await send('Network.enable', {}, swSession);
	await send('Network.enable', {}, a);
	const setOffline = async (offline) => {
		const p = { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
		await send('Network.emulateNetworkConditions', p, a);
		await send('Network.emulateNetworkConditions', p, swSession);
	};
	await setOffline(true);
	await reload(a);
	check('offline: shooting mode still opens (from the phone’s copy)', await waitFor(a, `/Minolta X-700/.test(document.querySelector('.shoot')?.innerText ?? '') && document.querySelector('.window b')?.textContent === '4'`, 6000), `counter ${await counter(a)}`);
	for (let i = 0; i < 5; i++) {
		await clickSel(a, '.log');
		await sleep(300);
	}
	check('offline: frames queue on the phone', await waitFor(a, `/Offline · 5 waiting/.test(document.querySelector('.sync')?.textContent ?? '')`, 10000), await evaluate(a, `document.querySelector('.sync')?.textContent`));
	await reload(a);
	check('offline: queued frames survive a reload', await waitFor(a, `/8 frames logged/.test(document.querySelector('.shoot')?.innerText ?? '') && document.querySelector('.window b')?.textContent === '9'`, 6000), `counter ${await counter(a)}`);
	await shot(a, 'p3-shoot-offline', { width: 390, height: 844, mobile: true, light: true });
	await setOffline(false);
	await evaluate(a, `window.dispatchEvent(new Event('online'))`);
	check('back online: the queue syncs', await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 15000), await evaluate(a, `document.querySelector('.sync')?.textContent`));
	await sleep(500);
	await goto(a, '/photography/lab/rolls/R-023/');
	await waitFor(a, `document.querySelectorAll('#frames tbody tr').length >= 8`, 8000);
	check('roll page lists all 8 frames from the server', (await evaluate(a, `document.querySelectorAll('#frames tbody tr').length`)) === 8);

	// Roll page: edit and backfill
	await evaluate(a, `document.querySelector('#frames tbody tr .acts button').click()`);
	await waitFor(a, `!!document.querySelector('#frames .edit-row')`);
	await fill(a, '#frames .edit-row input[type=text]', 'under the oaks');
	await clickText(a, 'Save');
	check('edit a frame note on the roll page', await waitFor(a, `/under the oaks/.test(document.querySelector('#frames')?.innerText ?? '')`));
	await clickText(a, 'Add a frame');
	await waitFor(a, `!!document.querySelector('#frames .edit-row')`);
	await clickSel(a, '#frames .edit-row .lab-btn');
	check('add a frame after the fact (no time recorded)', await waitFor(a, `document.querySelectorAll('#frames tbody tr').length === 9 && /—/.test(document.querySelector('#frames tbody')?.innerText ?? '')`));
	await shot(a, 'p3-roll-frames', { width: 1280, height: 1500, light: true });

	// ---------- Rewound early, reload, finish ----------
	await goto(a, '/photography/lab/shoot/');
	await clickText(a, 'Rewound early');
	await waitFor(a, `!!document.querySelector('#rewind-after')`);
	check('rewind defaults to the last frame logged', (await evaluate(a, `document.querySelector('#rewind-after').value`)) === '9');
	await clickSel(a, '.rewind button[type=submit]');
	check('rewound roll leaves shooting mode', await waitFor(a, `/Nothing’s loaded/.test(document.querySelector('.shoot')?.innerText ?? '')`, 8000));
	await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 8000);
	await goto(a, '/photography/lab/fridge/');
	check('fridge marks it partly shot', /partly shot/.test(await text(a, '.fridge')));
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	await setSelect(a, '#load-roll', `o.textContent.startsWith('R-023')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	check('reloading warns to wind on to frame 11', /wind on to frame 11/.test(await evaluate(a, `document.querySelector('dialog[open]')?.innerText ?? ''`)));
	await setSelect(a, '#step-camera', `o.textContent.includes('Ricoh XR-M')`);
	await submitDialog(a);
	await waitFor(a, `/Ricoh XR-M/.test(document.querySelector('.z-cameras .cam-row')?.innerText ?? '')`);
	await goto(a, '/photography/lab/r/R-023');
	check('QR link for a loaded roll opens shooting mode', /\/photography\/lab\/shoot\/\?roll=R-023/.test(await evaluate(a, 'location.href')));
	check('shooting mode continues at frame 11 with the wind-on hint', (await counter(a)) === '11' && /wind on to frame 11/.test(await shootText(a)));
	await clickText(a, 'Roll finished');
	await waitFor(a, `!!document.querySelector('.end .strong')`);
	await clickSel(a, '.end .strong');
	check('roll finished from the phone', await waitFor(a, `/Nothing’s loaded/.test(document.querySelector('.shoot')?.innerText ?? '')`, 8000));
	await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 8000);
	await goto(a, '/photography/lab/');
	check('it lands in the shot tray on the bench', /R-023/.test(await evaluate(a, `document.querySelector('.z-shot').innerText`)));

	// ---------- Labels ----------
	await goto(a, '/photography/lab/labels/');
	const qrs = await evaluate(a, `document.querySelectorAll('.sheet .label svg').length`);
	check('label sheet renders a QR code per roll', qrs >= 1, `${qrs} labels`);
	await goto(a, '/photography/lab/r/R-024');
	check('QR link for a roll in storage opens its page', /\/photography\/lab\/rolls\/R-024\/$/.test(await evaluate(a, 'location.href')));
	await goto(a, '/photography/lab/labels/');
	await shot(a, 'p3-labels', { width: 1280, height: 900, light: true });

	// ---------- Safelight, manifest ----------
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	await setSelect(a, '#load-roll', `o.textContent.startsWith('R-024')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	await setSelect(a, '#step-camera', `o.textContent.includes('Nikon One Touch')`);
	await submitDialog(a);
	await waitFor(a, `/One Touch/.test(document.querySelector('.z-cameras .cam-row')?.innerText ?? '')`);
	await goto(a, '/photography/lab/shoot/');
	check('point-and-shoot starts on "set by the camera"', /Exposure set by the camera/.test(await shootText(a)));
	await clickSel(a, '.icon-btn');
	check('safelight mode turns the page red on black', await evaluate(a, `document.documentElement.hasAttribute('data-safelight') && getComputedStyle(document.querySelector('.shoot')).backgroundColor === 'rgb(0, 0, 0)'`));
	await shot(a, 'p3-shoot-safelight', { width: 390, height: 844, mobile: true });
	const manifest = await evaluate(a, `fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()).then((m) => m.start_url + ' ' + m.scope + ' ' + m.icons.length)`);
	check('manifest opens on shooting mode, scoped to the lab', manifest === '/photography/lab/shoot/ /photography/lab/ 3', manifest);
	void cs;
}
