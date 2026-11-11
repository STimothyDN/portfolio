// The whole shooting workflow with no signal: load a roll, log frames, finish
// it, load another, reopen pages, move rolls on the bench; then a bar of
// signal comes back and everything syncs, in order.
import visual from './visual.mjs';
import { localDb } from '../paths.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, evaluate, waitFor, send, sleep, check, once, hydrated, shot, text } = h;
	const { a } = await visual(h);
	const db = localDb();
	const reload = async () => {
		const loaded = once('Page.loadEventFired', a, 30000);
		await send('Page.reload', { ignoreCache: false }, a);
		await loaded;
		await hydrated(a);
		await sleep(400);
	};
	const shootText = () => evaluate(a, `document.querySelector('.shoot')?.innerText ?? ''`);
	const counter = () => evaluate(a, `document.querySelector('.window b')?.textContent`);
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);

	// With signal: open shooting mode and the bench once each, under the service worker.
	await goto(a, '/photography/lab/shoot/');
	await reload();
	check('the service worker controls the lab', await waitFor(a, `!!navigator.serviceWorker.controller`, 8000));
	await reload();
	await goto(a, '/photography/lab/');
	await sleep(3000); // the bench asks the worker to save the shooting workflow for offline
	await goto(a, '/photography/lab/shoot/');
	await sleep(500);

	const { targetInfos } = await send('Target.getTargets');
	const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/photography/lab/sw.js'));
	const { sessionId: swS } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
	await send('Network.enable', {}, swS);
	await send('Network.enable', {}, a);
	const setOffline = async (offline) => {
		const p = { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
		await send('Network.emulateNetworkConditions', p, a);
		await send('Network.emulateNetworkConditions', p, swS);
	};

	// ---------- no signal ----------
	await setOffline(true);
	await reload();
	check('offline: shooting mode opens', /Shooting/.test(await shootText()));
	await evaluate(a, `document.querySelector('.load-chip').click()`);
	await waitFor(a, `!!document.querySelector('.load-panel')`, 3000);
	const A = await evaluate(a, `document.querySelector('#shoot-load-roll').selectedOptions[0].textContent.split(' · ')[0]`);
	const camA = await evaluate(a, `document.querySelector('#shoot-load-camera').selectedOptions[0].textContent`);
	await evaluate(a, `[...document.querySelectorAll('.load-panel button')].find((b) => /^Load/.test(b.innerText)).click()`);
	await sleep(500);
	check('offline: a roll loads in shooting mode', (await evaluate(a, `document.querySelector('.head h1')?.innerText`)) === camA && (await evaluate(a, `document.querySelector('.head .sticker')?.innerText`)) === A && (await counter()) === '1', `${A} in ${camA}, counter ${await counter()}`);
	for (let i = 0; i < 2; i++) {
		await evaluate(a, `document.querySelector('.log').click()`);
		await sleep(350);
	}
	check('offline: frames log on the roll just loaded', (await counter()) === '3');
	await reload();
	check('offline: the loaded roll survives a reload, frames and all', (await evaluate(a, `[...document.querySelectorAll('.switcher .chip')].some((c) => c.innerText === ${JSON.stringify(camA)})`)) || (await evaluate(a, `document.querySelector('.head .sticker')?.innerText`)) === A);
	await evaluate(a, `[...document.querySelectorAll('.switcher .chip')].find((c) => c.innerText === ${JSON.stringify(camA)})?.click()`);
	await sleep(300);
	check('…counter still at 3', await waitFor(a, `document.querySelector('.window b')?.textContent === '3'`, 3000), await counter());
	await evaluate(a, `[...document.querySelectorAll('.end .small-btn')].find((b) => b.innerText === 'Roll finished').click()`);
	await waitFor(a, `!!document.querySelector('.end .strong')`, 2000);
	await evaluate(a, `document.querySelector('.end .strong').click()`);
	await sleep(500);
	check('offline: the roll finishes', !(await evaluate(a, `[...document.querySelectorAll('.switcher .chip')].some((c) => c.innerText === ${JSON.stringify(camA)})`)) && (await evaluate(a, `document.querySelector('.head .sticker')?.innerText`)) !== A);
	// And the next roll into the same camera.
	await evaluate(a, `document.querySelector('.load-chip').click()`);
	await waitFor(a, `!!document.querySelector('.load-panel')`, 3000);
	await evaluate(a, `(() => { const s = document.querySelector('#shoot-load-camera'); const o = [...s.options].find((x) => x.textContent === ${JSON.stringify(camA)}); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
	const B = await evaluate(a, `document.querySelector('#shoot-load-roll').selectedOptions[0].textContent.split(' · ')[0]`);
	check('the next roll out of the fridge is offered (not the one just shot)', B !== A, `${A} then ${B}`);
	await evaluate(a, `[...document.querySelectorAll('.load-panel button')].find((b) => /^Load/.test(b.innerText)).click()`);
	await sleep(400);
	await evaluate(a, `document.querySelector('.log').click()`);
	await sleep(400);
	check('offline: everything is waiting on the phone', /Offline · \d+ waiting/.test(await evaluate(a, `document.querySelector('.sync')?.textContent`)), await evaluate(a, `document.querySelector('.sync')?.textContent`));
	await shot(a, 'offline-shoot', { width: 390, height: 1300, mobile: true, light: true });

	// The bench, from this phone's copy, shows the same truth, and takes moves too.
	await goto(a, '/photography/lab/');
	await sleep(800);
	check('offline: the bench opens', !!(await evaluate(a, `document.querySelector('.bench')`)));
	check('offline: it shows what’s waiting to sync', /waiting to sync/i.test(await text(a, '.ticker')), await text(a, '.ticker'));
	check('offline: the first roll sits in the shot tray', /./.test(A) && (await evaluate(a, `document.querySelector('.z-shot').innerText.includes(${JSON.stringify(A)})`)));
	check('offline: the second is in its camera', await evaluate(a, `document.querySelector('.z-cameras').innerText.includes(${JSON.stringify(B)})`));
	await evaluate(a, `[...document.querySelectorAll('.tool')].find((b) => /Load a roll/.test(b.innerText)).click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] form button[type=submit]')`, 4000);
	const C = await evaluate(a, `document.querySelector('#load-roll').selectedOptions[0].textContent.split(' · ')[0]`);
	await evaluate(a, `document.querySelector('dialog[open] form button[type=submit]').click()`);
	await waitFor(a, `!document.querySelector('dialog[open]')`, 6000);
	check('offline: the bench loads a roll too, and says it will sync', /Saved on this phone/.test(await text(a, '.toast')) && (await evaluate(a, `document.querySelector('.z-cameras').innerText.includes(${JSON.stringify(C)})`)), await text(a, '.toast'));
	await shot(a, 'offline-bench', { width: 390, height: 1800, mobile: true, light: true });

	// ---------- a bar of signal ----------
	await setOffline(false);
	await evaluate(a, `dispatchEvent(new Event('online'))`);
	check('back online: the bench syncs', await waitFor(a, `!/waiting to sync/i.test(document.querySelector('.ticker')?.innerText ?? '')`, 20000), await text(a, '.ticker'));
	const row = async (code) => (await db.execute({ sql: `select r.status, r.camera_id, (select count(*) from frame f where f.roll_id = r.id) as frames, (select count(*) from frame f where f.roll_id = r.id and f.camera_id = r.camera_id) as framed, (select group_concat(status, '>') from (select status from roll_event e where e.roll_id = r.id order by e.created_at)) as path from roll r where r.code = ?`, args: [code] })).rows[0];
	const ra = await row(A);
	const rb = await row(B);
	const rc = await row(C);
	check('synced: the first roll was loaded, shot twice, finished, in that order', ra.status === 'shot' && Number(ra.frames) === 2 && Number(ra.framed) === 2 && /camera>shot$/.test(ra.path), JSON.stringify(ra));
	check('synced: the second is in the same camera with its frame', rb.status === 'camera' && rb.camera_id === ra.camera_id && Number(rb.frames) === 1, JSON.stringify(rb));
	check('synced: the roll loaded on the bench offline', rc.status === 'camera', JSON.stringify(rc));
	await goto(a, '/photography/lab/shoot/');
	await sleep(1500);
	check('shooting mode reads “Synced”', await waitFor(a, `document.querySelector('.sync')?.textContent === 'Synced'`, 15000), await evaluate(a, `document.querySelector('.sync')?.textContent`));
}
