import { SESSION } from '../paths.mjs';
// Screenshots with the saved session (no seeding). LOOK=home,fridge VIEWS=light,dark,phone,tablet
import { readFileSync } from 'node:fs';

const PAGES = {
	home: ['/photography/lab/', 2000],
	rolls: ['/photography/lab/rolls/', 2600],
	frames: ['/photography/lab/frames/', 2400],
	roll: ['/photography/lab/rolls/R-001/', 1700],
	loaded: ['/photography/lab/rolls/R-033/', 1700],
	lab: ['/photography/lab/rolls/R-040/', 1700],
	fridge: ['/photography/lab/fridge/', 1600],
	gear: ['/photography/lab/gear/', 1500],
	labs: ['/photography/lab/labs/', 1600],
	shoot: ['/photography/lab/shoot/?roll=R-033', 900],
	account: ['/photography/lab/account/', 1200],
	labels: ['/photography/lab/labels/', 1200],
};

export default async function (h) {
	const { newPage, goto, sleep, shot, send } = h;
	const a = await newPage();
	const cookies = JSON.parse(readFileSync(SESSION, 'utf8'));
	await send('Network.enable', {}, a);
	if (!process.env.NOCOOKIE) await send('Network.setCookies', { cookies }, a);
	const names = (process.env.LOOK ?? 'home').split(',');
	const views = (process.env.VIEWS ?? 'light').split(',');
	const wait = Number(process.env.WAIT ?? 2200);
	for (const name of names) {
		const [path, h0] = PAGES[name] ?? [name, 1600];
		const height = Number(process.env.HEIGHT ?? h0);
		for (const v of views) {
			await goto(a, path);
			await sleep(wait);
			const tag = name.replace(/[^a-z0-9]+/gi, '-');
			if (v === 'light') await shot(a, `l-${tag}-light`, { width: 1280, height, light: true });
			if (v === 'dark') await shot(a, `l-${tag}-dark`, { width: 1280, height });
			if (v === 'phone') await shot(a, `l-${tag}-phone`, { width: 390, height: 1500, mobile: true, light: true });
			if (v === 'phonedark') await shot(a, `l-${tag}-phonedark`, { width: 390, height: 1500, mobile: true });
			if (v === 'tablet') await shot(a, `l-${tag}-tablet`, { width: 820, height, light: true });
		}
	}
	h.check('looked', true);
}
