// The bench: a roll's whole loop with real mouse drags (load, finish, send,
// scans in, file), undo, the keyboard path, the Today card, ⌘K, annotate and
// the close-ups. Seeds the realistic logbook first (visual.mjs).
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, evaluate, waitFor, send, sleep, check, shot, text } = h;
	const { a } = await visual(h);
	await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, a);
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, a);
	await goto(a, '/photography/lab/');
	await sleep(1200);

	const center = (sel) =>
		evaluate(a, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	const mouse = (type, p, buttons = 1) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 }, a);
	const at = (sel) => evaluate(a, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	async function drag(fromSel, toSel) {
		// Bring both into view first (the bench can be taller than the screen), then measure them where they ended up.
		if (!(await center(toSel))) return 'no target';
		if (!(await center(fromSel))) return 'no source';
		await evaluate(a, `(() => { const t = document.querySelector(${JSON.stringify(toSel)}).getBoundingClientRect(); const s = document.querySelector(${JSON.stringify(fromSel)}).getBoundingClientRect(); const mid = (Math.min(t.top, s.top) + Math.max(t.bottom, s.bottom)) / 2; document.body.scrollTop += mid - (innerHeight - 90) / 2; })()`);
		const to = await at(toSel);
		const src = await at(fromSel);
		if (to.y < 0 || to.y > 810 || src.y < 0 || src.y > 810) return 'not both on screen';
		await mouse('mouseMoved', src, 0);
		await mouse('mousePressed', src);
		for (let i = 1; i <= 14; i++) {
			await mouse('mouseMoved', { x: src.x + ((to.x - src.x) * i) / 14, y: src.y + ((to.y - src.y) * i) / 14 });
			await sleep(16);
		}
		const lit = await evaluate(a, `document.querySelector('[data-drop-over]')?.dataset.dropKind ?? ''`);
		const hit = await evaluate(a, `(() => { const e = document.elementFromPoint(${to.x}, ${to.y}); return e ? e.tagName + '.' + e.className : 'none'; })()`);
		await mouse('mouseReleased', to, 0);
		if (process.env.DEBUG) console.log('drop over', lit, 'hit', hit, JSON.stringify(to));
		return lit ? 'ok' : 'no highlight';
	}
	const slipTitle = () => evaluate(a, `document.querySelector('dialog[open] h2, dialog[open] [class*=title]')?.innerText ?? ''`);
	const submitSlip = async () => {
		await evaluate(a, `document.querySelector('dialog[open] form button[type=submit]').click()`);
		await waitFor(a, `!document.querySelector('dialog[open]')`, 8000);
		await sleep(1100);
	};
	const zoneHas = (zone, code) => evaluate(a, `[...document.querySelectorAll('.z-${zone} [data-roll], .z-${zone} [data-rolls]')].some((el) => el.innerText.includes(${JSON.stringify(code)}) || el.getAttribute('aria-label')?.includes(${JSON.stringify(code)}))`);

	// ---------- what's on the bench ----------
	const zones = await evaluate(a, `[...document.querySelectorAll('.bench .zone')].map((z) => z.className.match(/z-(\\w+)/)[1])`);
	check('six stations on the bench', zones.length === 6, zones.join(','));
	// A full bench grows past the screen rather than cutting a station off (the page scrolls).
	check('no station on the bench is cut off', await evaluate(a, `[...document.querySelectorAll('.zone:not(.z-today) .z-body')].every((b) => b.getBoundingClientRect().top + b.scrollHeight <= b.closest('.zone').getBoundingClientRect().bottom + 2)`));
	check('no sideways scroll', await evaluate(a, `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`));
	check('loaded cameras show their frame counters', (await evaluate(a, `document.querySelectorAll('.z-cameras .cam-btn').length`)) === 3);
	check('Today card has ranked notes', (await evaluate(a, `document.querySelectorAll('.today .list li').length`)) >= 1, await text(a, '.today'));
	check('the verbs between stations are printed', (await evaluate(a, `document.querySelectorAll('.bench .link').length`)) === 5);
	await shot(a, 'bench-1440', { width: 1440, height: 900, light: true });

	// ---------- load: drag a canister onto an empty camera ----------
	const front = await evaluate(a, `document.querySelector('.z-fridge .can-btn').dataset.roll`);
	const frontCode = await evaluate(a, `document.querySelector('.z-fridge .can-btn [class*=tape]').innerText`);
	const camName = await evaluate(a, `document.querySelector('.z-cameras .cam-empty .nm').innerText`);
	check('dragging a canister lights a camera', (await drag('.z-fridge .can-btn', '.z-cameras .cam-empty')) === 'ok');
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 4000);
	check('the load slip names the camera it was dropped on', (await slipTitle()).includes(camName), await slipTitle());
	check('the camera is already chosen', await evaluate(a, `document.querySelector('dialog[open] select#step-camera, dialog[open] select[id*=camera]')?.selectedOptions[0]?.text.includes(${JSON.stringify(camName)}) ?? false`));
	await submitSlip();
	check('the roll is in the camera now', await evaluate(a, `!!document.querySelector('.z-cameras [data-roll="${front}"]')`));
	check('toast offers undo', /Undo/.test(await text(a, '.toast')), await text(a, '.toast'));
	await evaluate(a, `[...document.querySelectorAll('.toast button')].find((b) => b.innerText === 'Undo').click()`);
	await sleep(1300);
	check('undo puts it back in the fridge', await evaluate(a, `!!document.querySelector('.z-fridge [data-rolls~="${front}"]') && !document.querySelector('.z-cameras [data-roll="${front}"]')`));

	// ---------- finish: tap a camera, use its menu ----------
	const camRoll = await evaluate(a, `document.querySelector('.z-cameras .cam-btn').dataset.roll`);
	await evaluate(a, `document.querySelector('.z-cameras .cam-btn').click()`);
	await waitFor(a, `!!document.querySelector('.obj-menu')`, 3000);
	check('tapping an object opens its menu, focus inside', await evaluate(a, `document.querySelector('.obj-menu').contains(document.activeElement)`));
	await evaluate(a, `[...document.querySelectorAll('.obj-menu [role=menuitem]')].find((b) => b.innerText === 'Roll finished').click()`);
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 4000);
	await submitSlip();
	check('finished roll lands in the shot tray', await evaluate(a, `!!document.querySelector('.z-shot [data-roll="${camRoll}"]')`));

	// ---------- send: drag it onto a blank envelope ----------
	const labName = await evaluate(a, `document.querySelector('.z-post .out-btn .to')?.innerText ?? ''`);
	check('dragging a shot canister lights an envelope', (await drag(`.z-shot [data-roll="${camRoll}"]`, '.z-post .out-btn')) === 'ok');
	await waitFor(a, `!!document.querySelector('dialog[open] .send-slip')`, 4000);
	check('the send slip has that lab picked', await evaluate(a, `document.querySelector('dialog[open] .lab-card.on b')?.innerText === ${JSON.stringify(labName)}`), labName);
	check('the send slip says when scans should come back', /back /.test(await text(a, 'dialog[open] .labs')), await text(a, 'dialog[open] .labs'));
	await submitSlip();
	check('sent rolls go into an envelope at the lab', await evaluate(a, `!!document.querySelector('.z-post [data-rolls~="${camRoll}"]')`));

	// ---------- scans in: drag the envelope onto the light table ----------
	check('dragging an envelope lights the light table', (await drag(`.z-post [data-rolls~="${camRoll}"]`, '.z-table')) === 'ok');
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 4000);
	await submitSlip();
	check('scans in: a strip on the light table', await evaluate(a, `!!document.querySelector('.z-table [data-roll="${camRoll}"]')`));

	// ---------- file: drag the strip into the binder ----------
	const before = await evaluate(a, `Number(document.querySelector('.z-binder .z-count').innerText)`);
	check('dragging a strip lights the binder', (await drag(`.z-table [data-roll="${camRoll}"]`, '.z-binder')) === 'ok');
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 4000);
	await submitSlip();
	check('filed: the binder counts one more', (await evaluate(a, `Number(document.querySelector('.z-binder .z-count').innerText)`)) === before + 1);
	check('filed: its sleeve sits on top', await evaluate(a, `!!document.querySelector('.z-binder [data-roll="${camRoll}"]')`));

	// ---------- a drop where it doesn't belong flies home ----------
	const stillFront = await evaluate(a, `document.querySelector('.z-fridge .can-btn').dataset.roll`);
	check('a canister can’t go straight to the binder', (await drag('.z-fridge .can-btn', '.z-binder')) === 'no highlight');
	await sleep(500);
	check('…and nothing opened', await evaluate(a, `!document.querySelector('dialog[open]') && !!document.querySelector('.z-fridge [data-roll="${stillFront}"]')`));

	// ---------- keyboard ----------
	await evaluate(a, `document.querySelector('.z-shot .loose-btn, .z-cameras .cam-btn').focus()`);
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, a);
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, a);
	await sleep(300);
	check('Enter on an object opens its menu', await evaluate(a, `!!document.querySelector('.obj-menu')`));
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, a);
	await sleep(200);
	check('Escape closes it and returns focus', await evaluate(a, `!document.querySelector('.obj-menu') && !!document.activeElement.closest('.obj')`));

	// ---------- annotate ----------
	await evaluate(a, `document.activeElement.blur()`);
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' }, a);
	await sleep(500);
	check('A shows numbered parts and readouts', (await evaluate(a, `document.querySelectorAll('.balloon').length`)) > 3 && (await evaluate(a, `document.querySelectorAll('.spec li').length`)) > 3);
	await shot(a, 'bench-annotate', { width: 1440, height: 900, light: true });
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' }, a);
	await sleep(200);

	// ---------- ⌘K ----------
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 4, windowsVirtualKeyCode: 75 }, a);
	await waitFor(a, `!!document.querySelector('dialog.lab-palette[open]')`, 4000);
	await evaluate(a, `(() => { const i = document.querySelector('#lab-palette-q'); i.value = ${JSON.stringify(frontCode)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	await waitFor(a, `document.querySelectorAll('.lab-palette [role=option]').length > 0`, 6000);
	const opts = await evaluate(a, `[...document.querySelectorAll('.lab-palette [role=option] b')].map((b) => b.innerText)`);
	check('⌘K finds a roll by code, with its next move', opts.some((o) => o.startsWith(frontCode)) && opts.some((o) => o.includes(frontCode) && /Load/.test(o)), opts.slice(0, 4).join(' | '));
	await evaluate(a, `document.querySelector('dialog.lab-palette').close()`);

	// ---------- ?move= opens the slip ----------
	await goto(a, `/photography/lab/?move=${frontCode}`);
	await waitFor(a, `!!document.querySelector('dialog[open]')`, 5000);
	check('?move= opens that roll’s next step', (await slipTitle()).includes(frontCode), await slipTitle());

	// ---------- close-ups ----------
	await goto(a, '/photography/lab/fridge/');
	await sleep(600);
	check('the fridge close-up has the bench mini-map', (await evaluate(a, `document.querySelectorAll('.mm-cell').length`)) === 6 && (await evaluate(a, `document.querySelector('.mm-cell.here')?.innerText ?? ''`)).includes('Fridge'));
	await shot(a, 'closeup-fridge', { width: 1440, height: 1100, light: true });
	await goto(a, '/photography/lab/gear/');
	check('the kit close-up', (await evaluate(a, `document.querySelector('.mm-cell.here')?.innerText ?? ''`)).includes('Cameras'));
	await goto(a, '/photography/lab/labs/');
	check('the post close-up', (await evaluate(a, `document.querySelector('.mm-cell.here')?.innerText ?? ''`)).includes('At a lab'));

	// ---------- reduced motion: moves fade, nothing flies ----------
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, a);
	await goto(a, '/photography/lab/');
	await sleep(400);
	await evaluate(a, `[...document.querySelectorAll('.tool')].find((b) => b.innerText.includes('Load a roll')).click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] form button[type=submit]')`, 4000);
	await evaluate(a, `document.querySelector('dialog[open] form button[type=submit]').click()`);
	await waitFor(a, `!document.querySelector('dialog[open]')`, 6000);
	await sleep(120);
	const anim = await evaluate(a, `({ ghosts: document.querySelectorAll('.lab-ghost').length, moving: document.getAnimations().filter((x) => x.effect?.getKeyframes?.().some((k) => k.translate && k.translate !== '0 0' && k.translate !== 'none')).length })`);
	check('reduced motion: a move flies nothing (no ghost, no translating animation)', anim.ghosts === 0 && anim.moving === 0, JSON.stringify(anim));
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, a);

	// ---------- smaller screens ----------
	for (const [w, ht] of [[1024, 768], [390, 844]]) {
		await send('Emulation.setDeviceMetricsOverride', { width: w, height: ht, deviceScaleFactor: 1, mobile: w < 600 }, a);
		await goto(a, '/photography/lab/');
		await sleep(700);
		check(`${w}px: the bench stacks, no sideways scroll`, await evaluate(a, `document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('.bench')).getPropertyValue('--bench-flow').trim() === 'column'`));
		await shot(a, `bench-${w}`, { width: w, height: 2200, mobile: w < 600, light: true });
	}
}
