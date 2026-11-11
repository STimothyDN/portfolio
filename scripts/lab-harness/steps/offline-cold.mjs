// Shooting mode on a phone that has never opened it: the bench, with signal,
// saves it for offline (page, scripts, styles), so it opens in the woods.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, evaluate, waitFor, send, sleep, check, once, hydrated } = h;
	void evaluate;
	const { a } = await visual(h);
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/');
	const loaded = once('Page.loadEventFired', a, 30000);
	await send('Page.reload', {}, a);
	await loaded;
	await hydrated(a);
	check('the worker controls the bench', await waitFor(a, `!!navigator.serviceWorker.controller`, 8000));
	await evaluate(a, `sessionStorage.removeItem('lab-offline-saved'); dispatchEvent(new Event('online'))`);
	const saved = await waitFor(a, `caches.open('film-lab-pages-v3').then((c) => c.match('/photography/lab/shoot/')).then(Boolean)`, 20000);
	check('the bench saved shooting mode for offline', !!saved);
	await sleep(6000); // its scripts follow
	const { targetInfos } = await send('Target.getTargets');
	const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/photography/lab/sw.js'));
	const { sessionId: swS } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
	await send('Network.enable', {}, swS);
	await send('Network.enable', {}, a);
	const off = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
	await send('Network.emulateNetworkConditions', off, a);
	await send('Network.emulateNetworkConditions', off, swS);
	await goto(a, '/photography/lab/shoot/');
	await sleep(1500);
	check('offline, never opened before: shooting mode’s page opens', await waitFor(a, `/Shooting/.test(document.querySelector('.shoot')?.innerText ?? '') && !!document.querySelector('.window b')`, 8000));
	// (Its scripts come along too in a production build, where islands are hashed chunks the worker
	// follows; the dev server's on-demand modules can't all be fetched ahead, so that part isn't checked here.)
}
