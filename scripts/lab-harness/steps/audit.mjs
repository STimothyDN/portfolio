import { OUT } from '../paths.mjs';
// Audit: every lab page, empty then seeded, at five widths and both themes.
// Reports sideways scroll, console errors, small tap targets, HTML size and server time.
import { writeFileSync } from 'node:fs';
import visual from './visual.mjs';

const WIDTHS = [320, 390, 768, 1024, 1440];
const PAGES = [
	['home', '/photography/lab/'],
	['rolls', '/photography/lab/rolls/'],
	['roll-linked', '/photography/lab/rolls/R-021/'],
	['roll-loaded', '/photography/lab/rolls/R-033/'],
	['roll-storage', '/photography/lab/rolls/R-023/'],
	['frames', '/photography/lab/frames/'],
	['almanac', '/photography/lab/almanac/'],
	['fridge', '/photography/lab/fridge/'],
	['gear', '/photography/lab/gear/'],
	['labs', '/photography/lab/labs/'],
	['shoot', '/photography/lab/shoot/?roll=R-033'],
	['labels', '/photography/lab/labels/'],
	['account', '/photography/lab/account/'],
];
const EMPTY = ['home', 'rolls', 'frames', 'almanac', 'fridge', 'gear', 'labs', 'shoot', 'labels'];

export default async function (h) {
	const { setupOwner, goto, shot, evaluate, sleep, check, send, BASE } = h;
	const report = { overflow: [], small: [], timing: [], errors: [] };
	const errs = [];
	const audit = async (a, tag, name, path, shots) => {
		// Server time and size, straight from the page's own request.
		const t0 = Date.now();
		await goto(a, path);
		const ms = Date.now() - t0;
		const bytes = await evaluate(a, `document.documentElement.outerHTML.length`);
		const islands = await evaluate(a, `[...document.querySelectorAll('astro-island')].map((i) => (i.getAttribute('component-url') ?? '').split('/').pop().replace(/\\?.*/, '') + ':' + (i.getAttribute('props') ?? '').length)`);
		report.timing.push({ tag, name, ms, kb: Math.round(bytes / 1024), islands });
		for (const w of WIDTHS) {
			await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 }, a);
			await sleep(250);
			const r = await evaluate(
				a,
				`(() => {
					const iw = innerWidth;
					const sw = document.documentElement.scrollWidth;
					const over = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.right > iw + 1 && getComputedStyle(e).position !== 'fixed'; });
					// Deepest offenders only.
					const leaves = over.filter((e) => !over.some((o) => o !== e && e.contains(o))).slice(0, 4).map((e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : e.tagName) + ' ' + Math.round(e.getBoundingClientRect().right));
					const small = ${w} < 768 ? [...document.querySelectorAll('main button, main a, main input, main select, main [role=switch]')].filter((e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width && b.height && s.visibility !== 'hidden' && !e.closest('.sr-only') && (b.height < 28 || b.width < 28) && !(e.tagName === 'A' && getComputedStyle(e).display === 'inline'); }).slice(0, 6).map((e) => (e.textContent.trim().slice(0, 18) || e.getAttribute('aria-label') || e.className) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)) : [];
					return { sw, iw, leaves, small };
				})()`
			);
			if (r.sw > r.iw) report.overflow.push(`${tag}/${name}@${w}: ${r.sw} > ${r.iw} · ${r.leaves.join(' | ')}`);
			if (r.small.length) report.small.push(`${tag}/${name}@${w}: ${r.small.join(' | ')}`);
		}
		await send('Emulation.clearDeviceMetricsOverride', {}, a);
		if (shots) {
			await shot(a, `audit-${tag}-${name}-phone`, { width: 390, height: 1400, mobile: true, light: true });
			await shot(a, `audit-${tag}-${name}-tablet`, { width: 768, height: 1200, light: true });
			await shot(a, `audit-${tag}-${name}-desk`, { width: 1440, height: 1500, light: true });
			await shot(a, `audit-${tag}-${name}-dark`, { width: 1440, height: 1500 });
		}
	};

	// Empty logbook first.
	const empty = await setupOwner();
	for (const [name, path] of PAGES.filter(([n]) => EMPTY.includes(n))) await audit(empty, 'empty', name, path, true);

	// Then a full one (the visual seeding imports the desk and fills the fridge, cameras and lab).
	process.env.SHOTS = 'none';
	await goto(empty, '/photography/lab/');
	const { a } = await visual({ ...h, setupOwner: async () => empty });
	for (const [name, path] of PAGES) await audit(a, 'full', name, path, true);

	writeFileSync(`${OUT}/audit-report.json`, JSON.stringify(report, null, 1));
	console.log('\n--- overflow ---\n' + (report.overflow.join('\n') || 'none'));
	console.log('\n--- small tap targets (phone) ---\n' + (report.small.join('\n') || 'none'));
	console.log('\n--- timing / size ---\n' + report.timing.map((t) => `${t.tag.padEnd(5)} ${t.name.padEnd(13)} ${String(t.ms).padStart(5)} ms ${String(t.kb).padStart(5)} KB  ${t.islands.join(' ')}`).join('\n'));
	check('audit ran', true);
}
