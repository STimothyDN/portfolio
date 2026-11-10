// The almanac: on an empty logbook every chapter says what it needs; on a full
// one every figure draws. Tables, phones, dark mode.
import visual from './visual.mjs';
import { localDb } from '../paths.mjs';

const CHAPTERS = ['life', 'exposure', 'light', 'keepers', 'rhythm', 'kit', 'labs', 'money', 'shelf'];

export default async function (h) {
	process.env.SHOTS = 'none';
	const { setupOwner, goto, evaluate, send, sleep, check, shot } = h;
	// Then full.
	const { a } = await visual(h);
	await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, a);
	await goto(a, '/photography/lab/almanac/');
	await sleep(700);
	const needs = await evaluate(a, `[...document.querySelectorAll('.fig')].filter((f) => f.querySelector('.need')).map((f) => f.querySelector('h3').innerText)`);
	check('full: most figures draw', needs.length <= 3, needs.join(' | '));
	check('full: findings lead the page', (await evaluate(a, `document.querySelectorAll('.headlines .notes li').length`)) >= 3);
	const n = await evaluate(a, `document.querySelectorAll('.fig .finding').length`);
	check('full: figures carry a sentence with their numbers', n >= 10, String(n));
	await evaluate(a, `[...document.querySelectorAll('#keepers .fig button')].find((b) => b.innerText === 'Table').click()`);
	await sleep(200);
	check('a chart flips to its table', (await evaluate(a, `document.querySelectorAll('#keepers .fig .table tbody tr').length`)) >= 3);
	const bar = await evaluate(a, `(() => { const t = document.querySelector('#keepers .fig:nth-child(2) .bars .track'); t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 3, y: r.top + r.height / 2 }; })()`);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x, y: bar.y }, a);
	await sleep(200);
	check('hovering a bar shows its value, interval and sample', /scans/.test(await evaluate(a, `document.querySelector('#keepers .bars .tip')?.innerText ?? ''`)));
	await shot(a, 'almanac', { width: 1440, height: 6000, light: true });
	await shot(a, 'almanac-dark', { width: 1440, height: 6000 });
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/almanac/');
	await sleep(500);
	check('390px: no sideways scroll', await evaluate(a, `document.documentElement.scrollWidth <= innerWidth`), await evaluate(a, `[...document.querySelectorAll('main *')].filter((x) => x.getBoundingClientRect().right > innerWidth + 1).slice(-3).map((x) => x.className).join(' / ')`));
	await shot(a, 'almanac-phone', { width: 390, height: 3000, mobile: true, light: true });
	await goto(a, '/photography/lab/frames/');
	await sleep(1200);
	check('390px: the frames page with the field fits', await evaluate(a, `document.documentElement.scrollWidth <= innerWidth`));
	// Then empty: clear the local logbook and claim the lab afresh.
	const db = localDb();
	const tables = (await db.execute(`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'`)).rows.map((r) => r.name);
	await db.execute('PRAGMA foreign_keys = OFF');
	for (const t of tables) await db.execute(`delete from "${t}"`);
	await db.execute('PRAGMA foreign_keys = ON');
	const e = await setupOwner();
	await goto(e, '/photography/lab/almanac/');
	await sleep(500);
	check('empty: all nine chapters are there', (await evaluate(e, `${JSON.stringify(CHAPTERS)}.every((c) => !!document.getElementById(c))`)));
	check('empty: figures say what they need instead of drawing', (await evaluate(e, `document.querySelectorAll('.fig .need').length`)) >= 8);
	const drawn = await evaluate(e, `[...document.querySelectorAll('.fig')].filter((f) => f.querySelector('.plot svg circle, .plot .bars li, .plot .col')).map((f) => f.querySelector('h3').innerText)`);
	// The film desk's scans are the owner's whatever the logbook holds: only exposure and keepers may draw.
	const fromLogbook = drawn.filter((t) => !/same film|keepers|by film|on the roll|by lab/.test(t));
	check('empty: nothing drawn from an empty logbook', fromLogbook.length === 0, fromLogbook.join(' | '));
	await shot(e, 'almanac-empty', { width: 1280, height: 2400, light: true });
}
