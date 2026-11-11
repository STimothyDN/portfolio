// Phase 6 (usage notes): exposure compensation, drop-off vs mail-in with tracking, prints, and speed.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, clickSel, clickText, text, shot, evaluate, waitFor, sleep, check, send, fill } = h;
	const { a, db, uid } = await visual(h);
	const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
	const setSelect = (sel, pick) =>
		evaluate(a, `(() => { const s = document.querySelector(${JSON.stringify(sel)}); const o = [...s.options].find((o) => ${pick}); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
	const submitDialog = () => evaluate(a, `document.querySelector('dialog[open] form button[type=submit]').click()`);

	// ---------- Exposure compensation ----------
	await goto(a, '/photography/lab/rolls/R-033/');
	await fill(a, '#d-comp', '1');
	await clickText(a, 'Save details');
	check('exposure comp saves on the roll page', await waitFor(a, `/ISO 400 · \\+1 EV/.test(document.querySelector('.summary')?.innerText ?? '')`, 5000), await text(a, '.summary'));
	await goto(a, '/photography/lab/shoot/?roll=R-033');
	check('shooting mode shows the comp with the rating', /ISO 400 · \+1 EV/.test(await text(a, '.head .sub')), await text(a, '.head .sub'));
	await clickSel(a, '.light .summary');
	await waitFor(a, `!!document.querySelector('#light-drawer')`);
	await clickSel(a, '.scene-btn');
	await clickText(a, 'Bright sun');
	const picks = await evaluate(a, `[...document.querySelectorAll('#light-drawer .pick')].map((b) => b.innerText.replace(/\\n/g, ' '))`);
	check('the meter adds the comp: bright sun at ISO 400 +1 is f/8 · 1/1000', picks.some((p) => /Everyday f\/8 · 1\/1000/.test(p)), picks.join(' | '));
	check('the meter says it included the comp', /settings include your \+1 EV/.test(await text(a, '#light-drawer .ev')));
	// Loading a roll with comp, from the light table.
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	await setSelect('#load-roll', `o.textContent.startsWith('R-029')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-comp')`);
	await setSelect('#step-camera', `o.textContent.includes('Infinity Twin')`);
	await fill(a, '#step-comp', '-0.7');
	await submitDialog();
	check('a roll loaded with −0.7 EV says so on its card', await waitFor(a, `[...document.querySelectorAll('.cam-slot')].some((c) => /Infinity Twin/.test(c.innerText) && /−0\\.7 EV/.test(c.innerText))`, 6000));

	// ---------- Mailed in, with tracking and prints ----------
	await goto(a, '/photography/lab/rolls/R-041/');
	await clickText(a, 'Sent to a lab');
	await waitFor(a, `!!document.querySelector('dialog[open] #step-lab')`);
	await setSelect('#step-lab', `o.textContent === 'Fotoshoppe'`);
	await clickSel(a, 'dialog[open] [data-delivery=mail]');
	check('mailed in: the date asks when it shipped', await waitFor(a, `/Shipped on/.test(document.querySelector('dialog[open]').innerText)`, 2000));
	await waitFor(a, `!!document.querySelector('dialog[open] input[id$=-track]')`);
	await fill(a, 'dialog[open] input[id$=-track]', '9400 1000 0000 0000 0000 00');
	check('the tracking number is recognised as USPS', await waitFor(a, `/Looks like USPS/.test(document.querySelector('dialog[open]').innerText)`, 2000));
	await fill(a, 'dialog[open] input[id$=-prints-cost]', '6');
	await submitDialog();
	check('the timeline says it was mailed', await waitFor(a, `/Mailed to the lab/.test(document.querySelector('.steps')?.innerText ?? '')`, 6000));
	check('the outbound tracking links to USPS', await waitFor(a, `!!document.querySelector('.steps .track a[href*="usps.com"]')`, 3000));
	await goto(a, '/photography/lab/rolls/R-041/');
	const saved = await evaluate(a, `({ delivery: document.querySelector('#d-delivery')?.value, track: document.querySelector('#d-track-out')?.value, prints: document.querySelector('#d-prints-cost')?.value, incl: document.querySelector('#d-prints')?.checked })`);
	check('delivery, tracking and prints are saved', saved.delivery === 'mail' && saved.track === '9400100000000000000000' && saved.prints === '6' && saved.incl === false, JSON.stringify(saved));

	// ---------- Dropped off, in a batch ----------
	const epic = await one(`select id from roll where code = 'R-035'`);
	await db.execute({ sql: `update roll set status = 'shot', status_on = '2026-11-08' where id = ?`, args: [epic.id] });
	await db.execute({ sql: `insert into roll_event (id, user_id, roll_id, status, "on", created_at) values (?,?,?,?,?,?)`, args: [crypto.randomUUID(), uid, epic.id, 'shot', '2026-11-08', Date.now()] });
	await goto(a, '/photography/lab/labs/');
	await setSelect('#batch-lab', `o.textContent === 'Bellows'`);
	check('dropped off: the batch date asks when', /Dropped off on/.test(await text(a, '.batch')));
	await evaluate(a, `document.querySelector('.batch .check input').click()`);
	check('ticking “price includes prints” hides the prints cost', await waitFor(a, `!document.querySelector('.batch input[id$=-prints-cost]')`, 2000));
	await clickSel(a, '.batch button[type=submit]');
	await waitFor(a, `![...document.querySelectorAll('.envelope li')].some((l) => /R-035/.test(l.innerText))`, 6000);
	const atLab = await text(a, '.labs');
	check('the mailed roll shows its tracking at the lab', /R-041[\s\S]*USPS/.test(atLab));
	await goto(a, '/photography/lab/rolls/R-035/');
	check('the batch roll was dropped off, prints included', /Dropped off at the lab/.test(await text(a, '.steps')) && (await evaluate(a, `document.querySelector('#d-prints').checked`)), (await text(a, '.steps')).slice(0, 80));

	// ---------- Scans in, negatives coming back by mail ----------
	await goto(a, '/photography/lab/rolls/R-041/');
	await clickText(a, 'Scans arrived');
	await waitFor(a, `!!document.querySelector('dialog[open] #step-track-back')`);
	await fill(a, '#step-track-back', '1Z999AA10123456784');
	await submitDialog();
	await waitFor(a, `/Scans in/.test(document.querySelector('.lab-chip')?.innerText ?? '')`, 6000);
	await goto(a, '/photography/lab/labs/');
	check('negatives on the way back, with UPS tracking', /Negatives on the way back[\s\S]*R-041[\s\S]*UPS/.test(await text(a, '.labs')));
	await goto(a, '/photography/lab/rolls/R-041/');
	await clickText(a, 'Negatives back');
	check('mailed negatives: the date asks when they arrived', await waitFor(a, `/Negatives arrived on/.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 3000));
	await evaluate(a, `document.querySelector('dialog[open]')?.close()`);
	await shot(a, 'p6-roll-mailed', { width: 1280, height: 1600, light: true });

	// ---------- Tracking lookups only for your own numbers ----------
	const tr = await evaluate(
		a,
		`fetch('/_actions/lab.trackShipments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ numbers: ['9400100000000000000000', '1Z999AA10123456784', 'ZZZZ12345678'] }) }).then((r) => r.json())`
	);
	// Actions answer in devalue's format: [{ live: 1, tracks: 2 }, false, {}] is { live: false, tracks: {} }.
	const decoded = Array.isArray(tr) ? { live: tr[tr[0].live], tracks: tr[tr[0].tracks] } : tr;
	check('without a 17TRACK key, tracking answers “not live” and never guesses', decoded.live === false && Object.keys(decoded.tracks ?? {}).length === 0, JSON.stringify(tr).slice(0, 160));

	// ---------- Speed: early fetches, never stale ----------
	await goto(a, '/photography/lab/rolls/');
	check('the lab’s service worker controls the page', await waitFor(a, `!!navigator.serviceWorker.controller`, 8000));
	const navTime = (code, warmFirst) =>
		evaluate(
			a,
			`(async () => {
				const link = [...document.querySelectorAll('a[href]')].filter((x) => x instanceof HTMLAnchorElement).find((x) => x.getAttribute('href') === '/photography/lab/rolls/${code}/');
				if (!link) return -1;
				if (${warmFirst}) { link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); await new Promise((r) => setTimeout(r, 1500)); }
				const t = performance.now();
				const done = new Promise((r) => document.addEventListener('astro:after-swap', r, { once: true }));
				link.click();
				await done;
				return Math.round(performance.now() - t);
			})()`
		);
	// Production-like latency on the worker's network (a phone on the road): 400 ms a request.
	const { targetInfos } = await send('Target.getTargets');
	const swTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('/photography/lab/sw.js'));
	const { sessionId: swS } = await send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true });
	await send('Network.enable', {}, swS);
	await send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: -1, uploadThroughput: -1 }, swS);
	const cold = await navTime('R-022', false);
	await goto(a, '/photography/lab/rolls/');
	const warmed = await navTime('R-020', true);
	await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, swS);
	check('with 400 ms of latency, a link warmed on touch opens hundreds of ms sooner', warmed >= 0 && cold > 0 && cold - warmed > 250, `cold ${cold} ms, warmed ${warmed} ms`);
	// Never stale: warm a page, change the roll, then open it.
	await goto(a, '/photography/lab/rolls/');
	const r19 = await one(`select id from roll where code = 'R-019'`);
	await evaluate(a, `[...document.querySelectorAll('a[href]')].filter((x) => x instanceof HTMLAnchorElement).find((x) => x.getAttribute('href') === '/photography/lab/rolls/R-019/').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
	await sleep(1500);
	await evaluate(a, `fetch('/_actions/lab.updateRoll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: ${JSON.stringify(r19.id)}, title: 'Renamed after the early fetch' }) }).then((r) => r.status)`);
	await evaluate(a, `(async () => { const done = new Promise((r) => document.addEventListener('astro:after-swap', r, { once: true })); [...document.querySelectorAll('a[href]')].filter((x) => x instanceof HTMLAnchorElement).find((x) => x.getAttribute('href') === '/photography/lab/rolls/R-019/').click(); await done; })()`);
	check('a change after the early fetch shows (the early copy is thrown away)', await waitFor(a, `/Renamed after the early fetch/.test(document.querySelector('.lab-title')?.innerText ?? '')`, 5000), await text(a, '.lab-title'));
	// The film-advance bar shows while a page is coming.
	await goto(a, '/photography/lab/rolls/');
	const sawBar = await evaluate(
		a,
		`(async () => {
			let saw = false;
			const mo = new MutationObserver(() => { if (document.documentElement.classList.contains('lab-navigating')) saw = true; });
			mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
			const done = new Promise((r) => document.addEventListener('astro:after-swap', r, { once: true }));
			[...document.querySelectorAll('a[href]')].filter((x) => x instanceof HTMLAnchorElement).find((x) => x.getAttribute('href') === '/photography/lab/rolls/R-018/').click();
			await done;
			await new Promise((r) => setTimeout(r, 50));
			mo.disconnect();
			return { saw, after: document.documentElement.classList.contains('lab-navigating') };
		})()`
	);
	check('navigating shows the progress bar, and clears it after', sawBar.saw && !sawBar.after, JSON.stringify(sawBar));
}
