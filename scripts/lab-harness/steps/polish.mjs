import { SHOTS } from '../paths.mjs';
// Screens the audit misses: dialogs on a phone, the shooting drawer's tabs at 320 px, frames at 320 px.
import visual from './visual.mjs';
export default async function (h) {
	process.env.SHOTS = 'none';
	const { goto, clickSel, clickText, evaluate, waitFor, sleep, check, send } = h;
	const { a } = await visual(h);
	const phone = async (name, width = 390, height = 844) => {
		await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true }, a);
		await evaluate(a, `document.documentElement.classList.remove('theme-dark')`);
		await sleep(500);
		const { data } = await send('Page.captureScreenshot', { format: 'png' }, a);
		(await import('node:fs')).writeFileSync(`${SHOTS}/polish-${name}.png`, Buffer.from(data, 'base64'));
		const sw = await evaluate(a, `document.documentElement.scrollWidth - innerWidth`);
		check(`${name} has no sideways scroll`, sw <= 0, String(sw));
	};
	// Dialog on a phone
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/');
	await clickText(a, 'Load a roll');
	await waitFor(a, `!!document.querySelector('dialog[open]')`);
	await phone('dialog-load');
	await evaluate(a, `document.querySelector('dialog[open]')?.close()`);
	// The shooting drawer at 320
	await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/shoot/?roll=R-033');
	await waitFor(a, `!!document.querySelector('.light .summary')`);
	await clickSel(a, '.light .summary');
	await waitFor(a, `!!document.querySelector('#light-drawer')`);
	await evaluate(a, `document.querySelector('.light').scrollIntoView()`);
	await phone('shoot-meter-320', 320, 700);
	check('all four drawer tabs fit at 320 px', await evaluate(a, `[...document.querySelectorAll('.tab')].every((t) => t.getBoundingClientRect().right <= innerWidth - 8)`));
	for (const tab of ['long', 'focus', 'sun']) {
		await clickSel(a, `[data-tab=${tab}]`);
		await sleep(200);
		await evaluate(a, `document.querySelector('.light').scrollIntoView()`);
		await phone(`shoot-${tab}-320`, 320, 700);
	}
	// Frames at 320
	await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1600, deviceScaleFactor: 2, mobile: true }, a);
	await goto(a, '/photography/lab/frames/');
	await sleep(1200);
	await phone('frames-320', 320, 1600);
	await goto(a, '/photography/lab/account/');
	await phone('account', 390, 1400);
	await goto(a, '/photography/lab/rolls/');
	await sleep(800);
	// The binder's line (it replaced the calendar) opens on today, at the right.
	const line = await evaluate(a, `(() => { const s = document.querySelector('.roll-line .scroller'); return s ? s.scrollWidth - s.clientWidth - s.scrollLeft : -1; })()`);
	check('the binder’s line opens on today on a phone', line >= 0 && line <= 2, String(line));
	// Touch screens: small text controls answer a finger just outside them.
	await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, a);
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, a);
	await goto(a, '/photography/lab/rolls/R-033/');
	check('touch emulation reports a coarse pointer', await evaluate(a, `matchMedia('(pointer: coarse)').matches`));
	const hit = await evaluate(
		a,
		`(() => {
			const probe = (el) => { el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.bottom + 7); return t === el || el.contains(t); };
			const link = [...document.querySelectorAll('.lab-main .lab-link')].find((e) => e.getBoundingClientRect().height < 28);
			const code = document.querySelector('.lab-main a.lab-code');
			const sw = document.querySelector('.lab-main [role=switch]');
			return { link: link ? probe(link) : 'none', code: code ? probe(code) : 'none', sw: sw ? probe(sw) : 'none' };
		})()`
	);
	check('a finger 7 px below a small link, roll code or switch still hits it', hit.link === true && hit.sw !== false, JSON.stringify(hit));
	await goto(a, '/photography/lab/labels/');
	const box = await evaluate(a, `Math.round(document.querySelector('.lab-main input[type=checkbox]')?.getBoundingClientRect().width ?? 0)`);
	check('checkboxes grow for fingers', box >= 21, String(box));
	await send('Emulation.setTouchEmulationEnabled', { enabled: false }, a);
	await send('Emulation.clearDeviceMetricsOverride', {}, a);
}
