// The film desk's Lab button: there for everyone, and a stranger lands on the read-only lab.
export default async function (h) {
	const { newPage, goto, evaluate, send, sleep, check, shot } = h;
	const { browserContextId } = await send('Target.createBrowserContext');
	const g = await newPage(browserContextId);
	for (const [w, ht, mobile] of [[1440, 900, false], [390, 844, true]]) {
		await send('Emulation.setDeviceMetricsOverride', { width: w, height: ht, deviceScaleFactor: mobile ? 2 : 1, mobile }, g);
		await goto(g, '/photography/');
		await sleep(1500);
		const btn = await evaluate(g, `(() => { const a = document.querySelector('.dock-lab'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: r.width, h: r.height, inView: r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0 }; })()`);
		check(`${w}px: the desk shows the Lab button to a stranger`, !!btn && btn.w > 0 && btn.inView, JSON.stringify(btn));
		check(`${w}px: the dock still fits`, await evaluate(g, `document.documentElement.scrollWidth <= innerWidth`));
		await shot(g, `desk-lab-${w}`, { width: w, height: ht, mobile, light: true });
	}
	const nav = h.once('Page.loadEventFired', g);
	await evaluate(g, `document.querySelector('.dock-lab').click()`);
	await nav;
	await sleep(600);
	check('it opens the lab, read-only, with the guide', (await evaluate(g, 'location.pathname')) === '/photography/lab/' && (await evaluate(g, `!!document.querySelector('.lab-guide-strip, .lab-guide') && !!document.querySelector('.bench')`)));
}
