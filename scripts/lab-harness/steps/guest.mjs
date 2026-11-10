// Signed out: the owner's lab, live and read-only, with the private bits taken
// out, the margin guide on every page, and every write refused by the server.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { newPage, goto, evaluate, send, sleep, check, shot, text, waitFor, BASE } = h;
	const { a } = await visual(h);
	// What the owner sees, to compare.
	await goto(a, '/photography/lab/');
	const ownerCount = await evaluate(a, `document.querySelector('.z-binder .z-count').innerText`);

	// A stranger: a fresh browser context, no cookies.
	const { browserContextId } = await send('Target.createBrowserContext');
	const g = await newPage(browserContextId);
	await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, g);
	await goto(g, '/photography/lab/');
	check('signed out, the lab opens (no redirect to sign-in)', (await evaluate(g, 'location.pathname')) === '/photography/lab/');
	check('it’s the owner’s lab, live', (await evaluate(g, `document.querySelector('.z-binder .z-count')?.innerText`)) === ownerCount, ownerCount);
	check('the guide says whose lab it is and offers an invite', /Film Lab/.test(await text(g, '.lab-guide-strip')) && (await evaluate(g, `!!document.querySelector('.lab-guide-strip a[href^="mailto:"]')`)));
	check('the lab bar offers sign-in, not the account', (await evaluate(g, `!!document.querySelector('.lab-me--guest') && !document.querySelector('a[href="/photography/lab/account/"]')`)));

	// Nothing to write with.
	const ctl = await evaluate(g, `JSON.stringify({ load: [...document.querySelectorAll('.tool')].filter((b) => /Load/.test(b.innerText)).length, mini: document.querySelectorAll('.cam-foot .mini, .z-shot .mini').length, out: document.querySelectorAll('.out-btn').length, act: document.querySelectorAll('.today .act').length })`);
	check('no write controls on the bench', !/[1-9]/.test(ctl), ctl);
	await evaluate(g, `document.querySelector('.z-cameras .cam-btn').click()`);
	await sleep(200);
	const items = await evaluate(g, `[...document.querySelectorAll('.obj-menu [role=menuitem]')].map((x) => x.innerText)`);
	check('an object’s menu only opens the roll', items.length === 1 && /^Open R-/.test(items[0]), items.join(' | '));
	// A drag goes nowhere.
	const from = await evaluate(g, `(() => { const r = document.querySelector('.z-fridge .can-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	const to = await evaluate(g, `(() => { const r = document.querySelector('.z-cameras').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 }, g);
	for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, buttons: 1 }, g);
	const lifted = await evaluate(g, `!!document.querySelector('.lab-ghost, [data-drop-ready]')`);
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 }, g);
	check('nothing can be picked up', !lifted);
	await shot(g, 'guest-bench', { width: 1440, height: 900, light: true });
	await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false }, g);
	await goto(g, '/photography/lab/');
	await sleep(500);
	check('wide screens: the guide sits in the margin', await evaluate(g, `getComputedStyle(document.querySelector('.lab-guide')).display !== 'none' && getComputedStyle(document.querySelector('.lab-guide-strip')).display === 'none'`));
	await shot(g, 'guest-bench-wide', { width: 1700, height: 1000, light: true });

	// Every place a guest may read, with no editing.
	const pages = [
		['/photography/lab/fridge/', `document.querySelectorAll('.topline .lab-btn, .catalogue .lab-link, .group-detail .lab-btn').length`],
		['/photography/lab/gear/', `[...document.querySelectorAll('.gear button')].filter((b) => /Add|Edit/.test(b.innerText)).length`],
		['/photography/lab/labs/', `document.querySelectorAll('form.batch, .labs .pick').length + [...document.querySelectorAll('.labs button')].filter((b) => /Add lab|Edit/.test(b.innerText)).length`],
		['/photography/lab/rolls/', `[...document.querySelectorAll('.binder .tools .lab-btn')].length`],
		['/photography/lab/rolls/R-001/', `document.querySelectorAll('.head-actions button, .details button[type=submit], .pencil, .align').length + [...document.querySelectorAll('button')].filter((b) => /Edit|Add a frame|Unlink/.test(b.innerText)).length`],
		['/photography/lab/frames/', `0`],
		['/photography/lab/almanac/', `0`],
	];
	for (const [path, writes] of pages) {
		await goto(g, path);
		await sleep(300);
		const ok = (await evaluate(g, 'location.pathname')) === path;
		const n = await evaluate(g, writes);
		check(`${path}: readable, nothing to edit`, ok && n === 0 && (await evaluate(g, `!!document.querySelector('.lab-guide')`)), `${n} write controls`);
	}
	await goto(g, '/photography/lab/rolls/R-001/');
	check('the roll’s details are shown but can’t be changed', await evaluate(g, `document.querySelector('.details fieldset.ro-wrap')?.disabled === true`));

	// Private details never reach the browser.
	const html = await evaluate(g, `Promise.all(['/photography/lab/', '/photography/lab/frames/', '/photography/lab/rolls/R-033/', '/photography/lab/labs/', '/photography/lab/rolls/']).then ? Promise.all(['/photography/lab/', '/photography/lab/frames/', '/photography/lab/rolls/R-033/', '/photography/lab/labs/', '/photography/lab/rolls/'].map((p) => fetch(p).then((r) => r.text()))).then((t) => t.join('\\n')) : ''`);
	check('no frame coordinates in any guest page', !/35\.99\d|-78\.9/.test(html));
	check('no lab order numbers in any guest page', !/A-22\d\d/.test(html));
	const ownerHtml = await evaluate(a, `fetch('/photography/lab/frames/').then((r) => r.text())`);
	check('(the owner, signed in, still has them)', /35\.99\d/.test(ownerHtml));

	// The server refuses every write, and the doors stay shut.
	const post = (name, body = '{}') => evaluate(g, `fetch('/_actions/lab.${name}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(body)} }).then((r) => r.status)`);
	check('writes are refused (advance, mark, settings, publish)', (await post('advanceRoll', JSON.stringify({ rollId: 'x', to: 'shot', on: '2026-11-01' }))) === 401 && (await post('markScan', JSON.stringify({ rollId: 'x', filename: 'a', mark: 5 }))) === 401 && (await post('updateSettings', JSON.stringify({ shareLoaded: true }))) === 401 && (await post('publishSite')) === 401);
	check('the finder can read the owner’s rolls', (await post('paletteIndex')) === 200);
	for (const p of ['/photography/lab/shoot/', '/photography/lab/account/', '/photography/lab/labels/']) {
		await goto(g, p);
		check(`${p} asks a guest to sign in`, /\/sign-in\//.test(await evaluate(g, 'location.pathname')));
	}
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, g);
	await goto(g, '/photography/lab/');
	await sleep(400);
	check('390px: the guest bench fits', await evaluate(g, `document.documentElement.scrollWidth <= innerWidth`));
	await shot(g, 'guest-phone', { width: 390, height: 1400, mobile: true, light: true });

	// Signed in again, the owner gets their own lab with everything.
	await goto(a, '/photography/lab/');
	check('the owner, signed in, has the full bench back', (await evaluate(a, `!document.querySelector('.lab-guide') && [...document.querySelectorAll('.tool')].some((b) => /Load/.test(b.innerText))`)));
	void BASE;
	void waitFor;
}
