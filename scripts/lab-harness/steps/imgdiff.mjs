// Compare two folders of screenshots pixel by pixel (in the browser's canvas).
// A=.data/harness/before/shots B=.data/harness/after/shots node run.mjs imgdiff
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function (h) {
	const { newPage, evaluate, check } = h;
	const A = process.env.A;
	const B = process.env.B;
	const a = await newPage();
	for (const name of readdirSync(A).filter((f) => f.endsWith('.png'))) {
		if (!existsSync(join(B, name))) continue;
		const url = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
		const r = await evaluate(
			a,
			`(async () => {
				const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
				const [x, y] = await Promise.all([load(${JSON.stringify(url(join(A, name)))}), load(${JSON.stringify(url(join(B, name)))})]);
				if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
				const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
				const p = px(x), q = px(y);
				let diff = 0, top = Infinity;
				for (let i = 0; i < p.length; i += 4) {
					if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 24) { diff++; top = Math.min(top, Math.floor(i / 4 / x.width)); }
				}
				return { diff, share: diff / (p.length / 4), top: top === Infinity ? null : top };
			})()`
		);
		const ok = !r.size && r.share < Number(process.env.TOLERANCE ?? 0.002);
		check(`${name} matches`, ok, r.size ? `size ${r.size}` : `${r.diff} px differ (${(r.share * 100).toFixed(3)}%)${r.top != null ? `, first at y=${r.top}` : ''}`);
	}
}
