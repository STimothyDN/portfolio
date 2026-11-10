// Server render time per lab page: median of 5 fetches each, after a warm-up, with the p5 data.
import visual from './visual.mjs';
const PAGES = ['/photography/lab/', '/photography/lab/rolls/', '/photography/lab/rolls/R-021/', '/photography/lab/rolls/R-033/', '/photography/lab/frames/', '/photography/lab/fridge/', '/photography/lab/gear/', '/photography/lab/labs/', '/photography/lab/shoot/', '/photography/lab/labels/', '/photography/lab/account/', '/photography/'];
export default async function (h) {
	process.env.SHOTS = 'none';
	const { evaluate, check } = h;
	const { a } = await visual(h);
	const out = await evaluate(
		a,
		`(async () => {
			const pages = ${JSON.stringify(PAGES)};
			const res = [];
			for (const p of pages) {
				await fetch(p).then((r) => r.text());
				const times = [];
				let size = 0;
				for (let i = 0; i < 5; i++) {
					const t = performance.now();
					const body = await fetch(p).then((r) => r.text());
					times.push(performance.now() - t);
					size = body.length;
				}
				times.sort((x, y) => x - y);
				res.push(p.padEnd(34) + String(Math.round(times[2])).padStart(5) + ' ms ' + String(Math.round(size / 1024)).padStart(5) + ' KB');
			}
			return res.join('\\n');
		})()`
	);
	console.log(out);
	check('measured', true);
}
