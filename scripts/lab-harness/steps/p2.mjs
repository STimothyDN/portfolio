import { readFileSync } from 'node:fs';
// Phase 2 end-to-end: import, fridge, load → shot → lab → scans, undo, roll page,
// gear, labs, rolls list, drag and drop, and per-user isolation.
export default async function (h) {
	const { setupOwner, newPage, goto, hydrated, fill, clickText, clickSel, path, text, shot, evaluate, waitFor, once, send, sleep, check } = h;
	const setSelect = (s, sel, matcher) =>
		evaluate(
			s,
			`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const opt = [...el.options].find((o) => ${matcher}); if (!opt) return false; el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return opt.textContent.trim(); })()`
		);
	const dialogOpen = (s) => evaluate(s, `!!document.querySelector('dialog[open]')`);
	const submitDialog = (s) => clickSel(s, 'dialog[open] form button[type=submit]');
	const err = (s) => evaluate(s, `[...document.querySelectorAll('.lab-error')].map((e) => e.innerText).join(' | ')`);

	const a = await setupOwner();
	await clickSel(a, '.import button');
	await waitFor(a, `/Added 22 rolls/.test(document.querySelector('.import [role=status]')?.innerText ?? '')`, 20000);
	await sleep(2500);
	await hydrated(a);

	// ---------- Fridge: buy film ----------
	await goto(a, '/photography/lab/fridge/');
	check('fridge starts empty', /The fridge is empty/.test(await text(a)));
	const seedLabels = JSON.parse(readFileSync('/Users/timothynavarro/Desktop/code projects/portfolio/src/data/film-labels.json', 'utf8'));
	const seededStocks = Object.keys(seedLabels.stocks).length;
	const seededCameras = Object.keys(seedLabels.cameras).length;
	const listedStocks = await evaluate(a, `document.querySelectorAll('.catalogue tbody tr').length`);
	check(`stock catalogue lists the ${seededStocks} seeded stocks`, listedStocks === seededStocks, `${listedStocks}`);
	const iso = await evaluate(a, `[...document.querySelectorAll('.catalogue tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ')).find((t) => t.includes('ProImage'))`);
	check('seeded stock has ISO and process', /100 C-41 35mm/.test(iso ?? ''), iso);
	const hp5 = await evaluate(a, `[...document.querySelectorAll('.catalogue tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ')).find((t) => t.includes('HP5'))`);
	check('black-and-white stocks are B&W', /400 B&W/.test(hp5 ?? ''), hp5);

	await clickText(a, 'Add rolls');
	await waitFor(a, `!!document.querySelector('dialog[open] #add-stock')`);
	await setSelect(a, '#add-stock', `o.textContent.includes('ProImage 100')`);
	await fill(a, '#add-qty', '3');
	await fill(a, '#add-expires', '2028-06');
	await fill(a, '#add-price', '9.50');
	await fill(a, '#add-shop', 'Southeastern Camera');
	await fill(a, '#add-spot', 'Fridge door');
	await submitDialog(a);
	check('adding 3 rolls puts ×3 on the Fridge door shelf', await waitFor(a, `/Fridge door\\s*3/.test(document.querySelector('.fridge')?.innerText ?? '') && /×3/.test(document.querySelector('.fridge')?.innerText ?? '')`));

	// New stock from inside "Add rolls"
	await clickText(a, 'Add rolls');
	await waitFor(a, `!!document.querySelector('dialog[open] #add-stock')`);
	await clickText(a, 'A stock that isn’t listed');
	await waitFor(a, `!!document.querySelector('dialog[open] #stock-brand')`);
	await fill(a, '#stock-brand', 'CineStill');
	await fill(a, '#stock-name', 'CineStill 800T');
	await fill(a, '#stock-iso', '800');
	await submitDialog(a);
	await waitFor(a, `document.querySelector('#add-stock')?.selectedOptions[0]?.textContent.includes('800T')`);
	await fill(a, '#add-expires', '2019-01');
	await fill(a, '#add-spot', 'Crisper drawer');
	await submitDialog(a);
	await waitFor(a, `/Crisper drawer/.test(document.querySelector('.fridge')?.innerText ?? '')`);
	check('fridge count updates live', /4 rolls across 2 stocks/.test(await text(a, '.topline')), await text(a, '.topline'));
	const old = await evaluate(a, `document.querySelector('.fridge')?.innerText ?? ''`);
	check('expired film gets the +1 stop rule of thumb', /expired 2019 · shoot about \+1 stop/.test(old), (old.match(/expired[^\n]*/) ?? [''])[0]);
	await clickSel(a, '.slot');
	check('opening a canister lists its rolls', await waitFor(a, `document.querySelectorAll('.group-detail .lab-rows li').length >= 1`));
	await shot(a, 'p2-fridge', { width: 1280, height: 1100, light: true });
	await shot(a, 'p2-fridge-phone', { width: 390, height: 844, mobile: true });

	// ---------- The bench: load → finished ----------
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	const picked = await setSelect(a, '#load-roll', `o.textContent.startsWith('R-023')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	await setSelect(a, '#step-camera', `o.textContent.includes('Minolta X-700')`);
	await fill(a, '#step-iso', '200');
	const pushHint = await evaluate(a, `document.querySelector('dialog[open] .lab-hint b')?.innerText`);
	check('rating ProImage 100 at 200 reads as push +1', pushHint === 'push +1', pushHint);
	await submitDialog(a);
	check('loaded roll appears in the cameras', await waitFor(a, `/Minolta X-700/.test(document.querySelector('.z-cameras .cam-row')?.innerText ?? '')`), picked);
	check('loaded camera shows push +1', /push \+1/.test(await text(a, '.z-cameras .cam-row')));
	check('toast confirms with undo', /R-023 loaded into the Minolta X-700/.test(await text(a, '.toast')) && /Undo/.test(await text(a, '.toast')), await text(a, '.toast'));

	const camOf = (code) => `[...document.querySelectorAll('.cam-slot')].find((s) => s.innerText.includes('${code}'))`;
	await evaluate(a, `${camOf('R-023')}.querySelector('button.mini').click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-dev-notes')`);
	const devNote = await evaluate(a, `document.querySelector('#step-dev-notes').placeholder`);
	check('lab note suggests the push', devNote === 'push +1', devNote);
	await submitDialog(a);
	check('finished roll moves to the shot tray', await waitFor(a, `document.querySelector('.z-shot').innerText.includes('R-023')`));
	await shot(a, 'p2-bench', { width: 1440, height: 900, light: true });

	// ---------- Labs: send a batch ----------
	await goto(a, '/photography/lab/labs/');
	check('shot roll is ready to send', /R-023/.test(await text(a)));
	await setSelect(a, '#batch-lab', `o.textContent === 'Fotoshoppe'`);
	await fill(a, '#batch-order', 'A-2210');
	await fill(a, '#batch-cost', '18');
	await clickText(a, 'Mark 1 roll as sent');
	check('batch moves it to At the lab now', await waitFor(a, `/At the lab now[\\s\\S]*R-023[\\s\\S]*Fotoshoppe · #A-2210/.test(document.querySelector('.labs')?.innerText ?? '')`));
	await shot(a, 'p2-labs', { width: 1280, height: 1000, light: true });

	// ---------- The bench: scans in, then undo ----------
	await goto(a, '/photography/lab/');
	const env = `[...document.querySelectorAll('.z-post .env-btn')].find((e) => e.innerText.includes('R-023'))`;
	check('its envelope shows the lab and order', await evaluate(a, `!!${env} && /Fotoshoppe/.test(${env}.innerText) && /A-2210/.test(${env}.innerText)`));
	await evaluate(a, `${env}.click()`);
	await waitFor(a, `!!document.querySelector('.obj-menu')`);
	await evaluate(a, `[...document.querySelectorAll('.obj-menu [role=menuitem]')].find((b) => b.innerText === 'Scans arrived').click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-desk')`);
	await submitDialog(a);
	check('scans arrived puts it on the light table', await waitFor(a, `document.querySelector('.z-table').innerText.includes('R-023')`));
	await clickSel(a, '.toast .lab-link');
	check('undo puts it back at the lab', await waitFor(a, `document.querySelector('.z-post').innerText.includes('R-023') && !document.querySelector('.z-table').innerText.includes('R-023')`));

	// ---------- Moves only go one step forward ----------
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open] #load-roll')`);
	await setSelect(a, '#load-roll', `o.textContent.startsWith('R-024')`);
	await waitFor(a, `!!document.querySelector('dialog[open] #step-camera')`);
	await setSelect(a, '#step-camera', `o.textContent.includes('Ricoh XR-M')`);
	await submitDialog(a);
	await waitFor(a, `!!${camOf('R-024')}`);
	await sleep(300);
	await evaluate(a, `${camOf('R-024')}.querySelector('.cam-btn').click()`);
	await waitFor(a, `!!document.querySelector('.obj-menu')`);
	const items = await evaluate(a, `[...document.querySelectorAll('.obj-menu [role=menuitem]')].map((b) => b.innerText)`);
	check('a loaded roll’s menu offers only its next step', items.includes('Roll finished') && !items.some((t) => /Send|Scans|Filed|Negatives/.test(t)), items.join(' | '));
	await evaluate(a, `[...document.querySelectorAll('.obj-menu [role=menuitem]')].find((b) => b.innerText === 'Roll finished').click()`);
	check('its menu opens the step', await waitFor(a, `!!document.querySelector('dialog[open] #step-dev-notes')`));
	await submitDialog(a);
	await waitFor(a, `document.querySelector('.z-shot').innerText.includes('R-024')`);
	check('the move completes', /R-024/.test(await text(a, '.z-shot')));

	// ---------- Roll page ----------
	await goto(a, '/photography/lab/rolls/R-023/');
	const tl = await text(a, '.steps');
	check('roll timeline has a dated step per stage so far', (tl.match(/\b\w{3} \d{1,2}, 20\d\d/g) ?? []).length >= 4, tl.replace(/\n/g, ' | ').slice(0, 200));
	await fill(a, '#d-title', 'Test walk');
	await clickText(a, 'Save details');
	check('details save', await waitFor(a, `document.querySelector('.details [role=status]')?.innerText === 'Saved.'`));
	await evaluate(a, `document.querySelector('.steps .edit').click()`);
	await waitFor(a, `!!document.querySelector('.ev-edit')`);
	await fill(a, '.ev-edit input[type=date]', '2026-10-01');
	await clickSel(a, '.ev-edit button[type=submit]');
	check('step dates can be edited', await waitFor(a, `/Oct 1, 2026/.test(document.querySelector('.steps')?.innerText ?? '')`));
	await goto(a, '/photography/lab/rolls/R-023/');
	check('title shows after reload', /Test walk/.test(await text(a, 'h1')));
	await shot(a, 'p2-roll', { width: 1280, height: 1300, light: true });
	await shot(a, 'p2-roll-phone', { width: 390, height: 844, mobile: true });

	await goto(a, '/photography/lab/rolls/R-001/');
	check('imported roll shows its desk scans on the strip', (await evaluate(a, `document.querySelectorAll('.strip .frame img').length`)) >= 3);
	const thumb = await evaluate(a, `document.querySelector('.strip .frame img')?.src ?? ''`);
	check('thumbnails come from the Bunny CDN', /b-cdn\.net\/film\//.test(thumb), thumb.replace(/\?.*/, ''));

	// Server-side checks on moves
	const missing = await evaluate(a, `fetch('/_actions/lab.advanceRoll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: 'nope', to: 'shot', on: '2026-11-01' }) }).then((r) => r.status)`);
	check('moving a roll that isn’t yours/doesn’t exist is refused', missing === 404, String(missing));
	const r1 = await evaluate(a, `fetch('/photography/lab/rolls/R-001/').then((r) => r.text()).then((t) => (t.match(/&quot;id&quot;:\\[0,&quot;([0-9a-f-]{36})&quot;\\],&quot;code&quot;:\\[0,&quot;R-001/) ?? [])[1])`);
	const backwards = await evaluate(a, `fetch('/_actions/lab.advanceRoll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: ${JSON.stringify(r1 ?? 'x')}, to: 'camera', on: '2026-11-01', cameraId: 'x' }) }).then(async (r) => r.status + ' ' + (await r.json()).message)`);
	check('rolls only move forward (server)', /^400 Rolls only move forward/.test(backwards), backwards);

	// ---------- Gear ----------
	await goto(a, '/photography/lab/gear/');
	const listedCameras = await evaluate(a, `document.querySelectorAll('.cards .card').length`);
	check(`gear lists the ${seededCameras} seeded cameras`, listedCameras === seededCameras, `${listedCameras}`);
	await clickText(a, 'Add camera');
	await waitFor(a, `!!document.querySelector('dialog[open] #cam-brand')`);
	await fill(a, '#cam-brand', 'Nikon');
	await fill(a, '#cam-name', 'Nikon FM2');
	await fill(a, '#cam-mount', 'Nikon F');
	await fill(a, '#cam-battery', '2 × LR44');
	await submitDialog(a);
	check('new camera card appears', await waitFor(a, `/Nikon FM2[\\s\\S]*Nikon F mount/.test(document.querySelector('.cards')?.innerText ?? '')`));
	await clickText(a, 'Add lens');
	await waitFor(a, `!!document.querySelector('dialog[open] #lens-brand')`);
	await fill(a, '#lens-brand', 'Nikon');
	await fill(a, '#lens-mount', 'Nikon F');
	await fill(a, '#lens-name', 'Nikkor 50mm f/1.8 AI-S');
	await fill(a, '#lens-fmin', '50');
	await fill(a, '#lens-ap', '1.8');
	await submitDialog(a);
	check('lens groups under its mount and lists what it fits', await waitFor(a, `/Nikon F\\s*fits Nikon FM2[\\s\\S]*50mm · 40° across · f\\/1.8/.test(document.querySelector('.gear')?.innerText ?? '')`));
	await evaluate(a, `[...document.querySelectorAll('.cards .card')].find((c) => c.innerText.includes('Minolta X-700')).click()`);
	await waitFor(a, `!!document.querySelector('dialog[open] #svc-kind')`);
	const rect = await evaluate(a, `(() => { const r = document.querySelector('dialog[open]').getBoundingClientRect(); return [Math.round(r.left), Math.round(innerWidth - r.right)]; })()`);
	check('dialogs open centred', Math.abs(rect[0] - rect[1]) <= 2 && rect[0] > 100, JSON.stringify(rect));
	await fill(a, '#svc-note', 'Fresh pair');
	await clickText(a, 'Add to log');
	check('battery entry lands in the service log', await waitFor(a, `/New battery[\\s\\S]*Fresh pair/.test(document.querySelector('dialog[open] .service')?.innerText ?? '')`));
	await shot(a, 'p2-gear-dialog', { width: 1280, height: 1100, light: true });
	await clickSel(a, 'dialog[open] .dialog-x');
	check('camera card shows the new battery date', await waitFor(a, `/Minolta X-700[\\s\\S]*changed/.test(document.querySelector('.cards')?.innerText ?? '')`));
	await shot(a, 'p2-gear', { width: 1280, height: 1100, light: true });

	// ---------- Rolls list ----------
	await goto(a, '/photography/lab/rolls/');
	check('rolls list shows all 26', (await evaluate(a, `document.querySelectorAll('.list li').length`)) === 26);
	await evaluate(a, `[...document.querySelectorAll('.filter')].find((b) => b.innerText.startsWith('In storage')).click()`);
	check('storage filter narrows to 2', await waitFor(a, `document.querySelectorAll('.list li').length === 2`));
	await evaluate(a, `[...document.querySelectorAll('.filter')][0].click()`);
	await fill(a, '#rolls-search', 'peru');
	check('search finds the Peru rolls', await waitFor(a, `document.querySelectorAll('.list li').length === 4`));
	await shot(a, 'p2-rolls-phone', { width: 390, height: 844, mobile: true });

	// ---------- Another user sees nothing of this ----------
	await goto(a, '/photography/lab/account/');
	await clickSel(a, '.invite-form button[type=submit]');
	const link = await waitFor(a, `document.querySelector('.new-link code')?.textContent`);
	const ownerRollId = await evaluate(a, `fetch('/photography/lab/rolls/R-023/').then((r) => r.text()).then((t) => (t.match(/&quot;id&quot;:\\[0,&quot;([0-9a-f-]{36})&quot;\\],&quot;code&quot;:\\[0,&quot;R-023/) ?? [])[1])`);
	const { browserContextId } = await send('Target.createBrowserContext');
	const b = await newPage(browserContextId);
	await goto(b, new URL(link).pathname);
	await fill(b, '#lab-claim-name', 'Friend Person');
	await fill(b, '#lab-claim-email', 'friend@example.test');
	await clickSel(b, '.claim button[type=submit]');
	await waitFor(b, `document.querySelectorAll('.code-list li').length === 10`);
	await clickSel(b, '#lab-codes-saved');
	let nav = once('Page.loadEventFired', b);
	await clickText(b, 'Open Film Lab');
	await nav;
	await hydrated(b);
	check('friend gets their own empty bench', /Your bench is empty/.test(await text(b)));
	await goto(b, '/photography/lab/rolls/R-023/');
	check("friend can't open the owner's roll", /No roll R-023/.test(await text(b)));
	const steal = await evaluate(
		b,
		`fetch('/_actions/lab.updateRoll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: ${JSON.stringify(ownerRollId ?? 'x')}, title: 'mine now' }) }).then((r) => r.status)`
	);
	check("friend can't edit the owner's roll through actions", steal === 404, `${steal} (owner roll id found: ${!!ownerRollId})`);
	const anon = await evaluate(
		b,
		`fetch('/_actions/lab.deleteRoll', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rollId: ${JSON.stringify(ownerRollId ?? 'x')} }) }).then((r) => r.status)`
	);
	check('signed-out action calls are refused', anon === 401, String(anon));

	// ---------- The film desk is the owner's ----------
	await goto(b, '/photography/lab/');
	check('a friend isn’t offered the owner’s film desk', !(await evaluate(b, `!!document.querySelector('.import')`)) && /kit/.test(await text(b, '.first-run')), (await text(b, '.first-run')).slice(0, 120));
	check('a friend has no film-desk switch', !(await evaluate(b, `!!document.querySelector('#share-loaded')`)));
	const post = (name) => evaluate(b, `fetch('/_actions/lab.${name}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status)`);
	check('a friend can’t import the desk through actions', (await post('importFromDesk')) === 403);
	check('a friend can’t sync the desk’s catalogue', (await post('syncCatalogue')) === 403);
	await goto(b, '/photography/lab/almanac/');
	const fr = await text(b);
	check('a friend’s almanac shows none of the owner’s film desk', !/comes back thin|scans flat/.test(fr) && (await evaluate(b, `document.querySelectorAll('#exposure .bars li, #keepers .bars li').length`)) === 0 && /star ratings/.test(fr));
}
