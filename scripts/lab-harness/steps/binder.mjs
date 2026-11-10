// The binder (the line and the sheets) and a roll's page as a sleeve:
// lifeline, report card, strips of six, the frame close-up. Seeds first.
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, evaluate, waitFor, send, sleep, check, shot, text, fill } = h;
	const { a } = await visual(h);
	await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, a);
	await goto(a, '/photography/lab/rolls/');
	await sleep(800);

	// ---------- the line ----------
	const ribbons = await evaluate(a, `document.querySelectorAll('.roll-line .ribbon').length`);
	const notStored = await evaluate(a, `document.querySelectorAll('.list li').length - [...document.querySelectorAll('.list .sleeve[data-stage=storage]')].length`);
	check('every roll that left the fridge has a ribbon on the line', ribbons === notStored, `${ribbons} ribbons, ${notStored} rolls`);
	const lanes = await evaluate(a, `[...document.querySelectorAll('.roll-line .labels text')].map((t) => t.textContent)`);
	check('lanes: cameras, then waiting, lab, scans, filed', lanes.slice(-4).join('|') === 'Waiting to send|At a lab|Scans in|Filed' && lanes.length > 4, lanes.join(' | '));
	check('the average roll is summarised', /days from loading to filing/i.test(await text(a, '.roll-line .avg')));
	// hover a ribbon
	const p = await evaluate(a, `(() => { const r = document.querySelector('.roll-line .ribbon .stroke').getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; })()`);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }, a);
	await sleep(250);
	check('hovering a ribbon traces it and shows its dates', await evaluate(a, `!!document.querySelector('.roll-line .tip') && document.querySelector('.roll-line .chart').classList.contains('hovering')`), await text(a, '.roll-line .tip'));
	// brush a stretch of time: the last few weeks
	const box = await evaluate(a, `(() => { const r = document.querySelector('.roll-line .catch').getBoundingClientRect(); return { x0: r.right - r.width * 0.25, x1: r.right - 4, y: r.top + 60 }; })()`);
	const all = await evaluate(a, `document.querySelectorAll('.list li').length`);
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x0, y: box.y, button: 'left', buttons: 1, clickCount: 1 }, a);
	for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x0 + ((box.x1 - box.x0) * i) / 8, y: box.y, buttons: 1 }, a);
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x1, y: box.y, button: 'left', buttons: 0, clickCount: 1 }, a);
	await sleep(500);
	const narrowed = await evaluate(a, `document.querySelectorAll('.list li').length`);
	check('dragging across the line narrows the sheets to that stretch', narrowed > 0 && narrowed < all && /Showing/.test(await text(a, '.facet')), `${narrowed} of ${all}`);
	await shot(a, 'binder-brush', { width: 1440, height: 1400, light: true });
	await evaluate(a, `[...document.querySelectorAll('.facet button')].find((b) => b.innerText === 'Show all').click()`);
	await sleep(300);
	check('show all brings them back', (await evaluate(a, `document.querySelectorAll('.list li').length`)) === all);

	// ---------- the sheets ----------
	check('linked rolls show their best frames through the sleeve', (await evaluate(a, `document.querySelectorAll('.list .sleeve .win img').length`)) >= 6);
	await evaluate(a, `[...document.querySelectorAll('.filter')].find((b) => b.innerText.startsWith('In camera')).click()`);
	await sleep(700);
	check('a stage tab narrows the sheets', await evaluate(a, `[...document.querySelectorAll('.list .sleeve')].every((s) => s.dataset.stage === 'camera') && document.querySelectorAll('.list li').length === 3`));
	await evaluate(a, `[...document.querySelectorAll('.filter')][0].click()`);
	await fill(a, '#rolls-search', 'peru');
	check('search finds the Peru rolls', await waitFor(a, `document.querySelectorAll('.list li').length === 4`));
	await evaluate(a, `[...document.querySelectorAll('.views button')].find((b) => b.innerText === 'List').click()`);
	await sleep(200);
	check('the list view shows rows', (await evaluate(a, `document.querySelectorAll('.list .row').length`)) === 4);
	await shot(a, 'binder', { width: 1440, height: 1600, light: true });

	// ---------- a roll as a sleeve ----------
	await goto(a, '/photography/lab/rolls/R-001/');
	await sleep(600);
	check('the lifeline has six stations', (await evaluate(a, `document.querySelectorAll('.lifeline > .step').length`)) === 6);
	check('the report card has five numbers', (await evaluate(a, `document.querySelectorAll('.report > div').length`)) === 5 && /scans back/.test(await text(a, '.report')), (await text(a, '.report')).replace(/\n/g, ' | '));
	const strips = await evaluate(a, `[...document.querySelectorAll('.sleeve-page .strip')].map((s) => s.querySelectorAll('.frame').length)`);
	check('scans come in strips of six', strips.length >= 2 && strips.slice(0, -1).every((n) => n === 6), strips.join(','));
	check('keepers are ringed', (await evaluate(a, `document.querySelectorAll('.sleeve-page .mark').length`)) >= 1);
	await evaluate(a, `document.querySelectorAll('.sleeve-page .frame')[1].click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] .focus')`, 3000);
	check('a frame opens close up', /Frame 2/.test(await evaluate(a, `document.querySelector('dialog[open]').innerText`)));
	check('the close-up reads the negative’s density', await evaluate(a, `!!document.querySelector('dialog[open] .gauge')`));
	await evaluate(a, `[...document.querySelectorAll('dialog[open] .focus-nav button')].find((b) => /Next/.test(b.innerText)).click()`);
	await sleep(200);
	check('next steps through the roll', /Frame 3/.test(await evaluate(a, `document.querySelector('dialog[open]').innerText`)));
	await shot(a, 'roll-focus', { width: 1440, height: 1000, light: true });
	// ---------- grease pencil ----------
	const key = (k) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, code: /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}` }, a);
	const keepersBefore = Number((await text(a, '.r-keepers b')).trim());
	const ringIdx = await evaluate(a, `[...document.querySelectorAll('.sleeve-page .frame')].findIndex((f) => f.querySelector('.mark'))`);
	await evaluate(a, `document.querySelector('dialog[open] .dialog-x')?.click()`);
	await sleep(300);
	await evaluate(a, `document.querySelectorAll('.sleeve-page .frame')[${ringIdx}].click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] .pencil')`, 3000);
	if (process.env.DEBUG) console.log('before 2:', await evaluate(a, `JSON.stringify({ open: !!document.querySelector('dialog[open]'), active: document.activeElement?.tagName + '.' + document.activeElement?.className })`));
	await key('2');
	await sleep(600);
	if (process.env.DEBUG) console.log('after 2:', await evaluate(a, `JSON.stringify({ open: !!document.querySelector('dialog[open]'), active: document.activeElement?.tagName + '.' + document.activeElement?.className })`));
	check('marking a keeper 2 takes its ring off', !(await evaluate(a, `!!document.querySelectorAll('.sleeve-page .frame')[${ringIdx}].querySelector('.mark')`)));
	check('…and the report counts one keeper fewer', Number((await text(a, '.r-keepers b')).trim()) === keepersBefore - 1, `${keepersBefore} → ${(await text(a, '.r-keepers b')).trim()}`);
	await key('x');
	await sleep(500);
	check('X crosses a frame out', await evaluate(a, `!!document.querySelectorAll('.sleeve-page .frame')[${ringIdx}].querySelector('.cross')`));
	await key('5');
	await sleep(500);
	if (process.env.DEBUG) console.log('after 5:', await evaluate(a, `JSON.stringify({ open: !!document.querySelector('dialog[open]'), path: location.pathname, active: document.activeElement?.className })`));
	await evaluate(a, `document.querySelector('dialog[open] .dialog-x')?.click()`);
	await sleep(300);
	await goto(a, '/photography/lab/rolls/R-001/');
	await sleep(400);
	check('marks are saved (after a reload, 5 is a keeper again)', await evaluate(a, `!!document.querySelectorAll('.sleeve-page .frame')[${ringIdx}].querySelector('.mark')`));
	await evaluate(a, `document.querySelectorAll('.sleeve-page .frame')[${ringIdx}].click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] .pencil')`, 3000);
	await key('1');
	await sleep(600);
	await evaluate(a, `document.querySelector('dialog[open] .dialog-x')?.click()`);
	await sleep(300);
	await goto(a, '/photography/lab/almanac/');
	const tile = Number((await evaluate(a, `document.querySelectorAll('#keepers .tile span')[1].innerText`)).match(/from (\d+)/)?.[1] ?? 0);
	const kept = Number((await evaluate(a, `document.querySelectorAll('#keepers .tile b')[1].innerText`)).trim());
	check('the almanac counts keepers from your marks', kept > 0 && tile > 0, `${kept} of ${tile}`);
	await goto(a, '/photography/lab/rolls/R-001/');
	await sleep(400);
	await evaluate(a, `document.querySelectorAll('.sleeve-page .frame')[1].click()`);
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 3000);
	await evaluate(a, `document.querySelector('dialog[open] .dialog-x')?.click()`);
	await sleep(300);
	await shot(a, 'roll-sleeve', { width: 1440, height: 1800, light: true });

	await goto(a, '/photography/lab/rolls/R-033/');
	await sleep(500);
	check('a loaded roll’s next step is in its head', /Mark roll finished/.test(await text(a, '.head-actions')));
	check('unscanned frames show twelve to a strip', (await evaluate(a, `document.querySelector('.sleeve-page .latent-strip')?.querySelectorAll('.frame').length`)) === 12);
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/rolls/R-001/');
	await sleep(500);
	check('390px: the roll page has no sideways scroll', await evaluate(a, `document.documentElement.scrollWidth <= innerWidth`));
	await goto(a, '/photography/lab/rolls/');
	await sleep(500);
	check('390px: the binder has no sideways scroll (the line scrolls inside)', await evaluate(a, `document.documentElement.scrollWidth <= innerWidth`));
	await shot(a, 'binder-phone', { width: 390, height: 2000, mobile: true, light: true });
}
