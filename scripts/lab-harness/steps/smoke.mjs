export default async function ({ setupOwner, goto, text, shot, check, waitFor, evaluate, clickSel, sleep }) {
	const a = await setupOwner();
	check('owner lands on the bench', /The bench/.test(await text(a)));
	check('empty logbook offers the desk import', /Import 22 rolls from the film desk/.test(await text(a)));
	await shot(a, 'p2-01-empty');
	await clickSel(a, '.import button');
	const msg = await waitFor(a, `document.querySelector('.import [role=status]')?.innerText || document.querySelector('.import .lab-error')?.innerText`, 20000);
	check('import reports what it added', /Added 22 rolls/.test(msg ?? ''), msg);
	await sleep(2500);
	await waitFor(a, `!document.querySelector('astro-island[ssr]')`);
	const t = await text(a);
	check('the binder shows 22 rolls filed', (await evaluate(a, `document.querySelector('.z-binder .z-count')?.innerText`)) === '22', t.slice(0, 300).replace(/\n/g, ' | '));
	await shot(a, 'p2-02-imported', { width: 1280, height: 1200 });
}
