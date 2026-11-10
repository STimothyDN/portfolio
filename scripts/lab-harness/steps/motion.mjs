import { SESSION, SHOTS } from '../paths.mjs';
// Record a navigation as screencast frames and lay them out as a contact sheet.
// FROM=/photography/lab/ CLICK='a[href="/photography/lab/fridge/"]' DUR=2200 NAME=turn
import { readFileSync, writeFileSync } from 'node:fs';

export default async function (h) {
	const { newPage, goto, sleep, send, evaluate, check } = h;
	const a = await newPage();
	const cookies = JSON.parse(readFileSync(SESSION, 'utf8'));
	await send('Network.enable', {}, a);
	await send('Network.setCookies', { cookies }, a);
	const W = Number(process.env.W ?? 1280);
	const H = Number(process.env.H ?? 800);
	await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 }, a);
	if (process.env.DARK) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, a);
	await goto(a, process.env.FROM ?? '/photography/lab/');
	await sleep(Number(process.env.SETTLE ?? 2500));
	if (process.env.SCROLL) await evaluate(a, `document.body.scrollTop = ${process.env.SCROLL}`);
	// Set the scene first (open a slip, pick a roll…), then record what CLICK sets off.
	if (process.env.PREP) await evaluate(a, process.env.PREP);
	await sleep(Number(process.env.PREP_WAIT ?? 300));
	const frames = [];
	const t0 = Date.now();
	const onFrame = (m) => {
		if (m.method === 'Page.screencastFrame' && m.sessionId === a) {
			frames.push({ t: Date.now() - t0, data: m.params.data });
			send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, a).catch(() => {});
		}
	};
	h.listen?.(onFrame);
	await send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1, maxWidth: W, maxHeight: H }, a);
	await sleep(150);
	const click = process.env.CLICK;
	if (click) await evaluate(a, `document.querySelector(${JSON.stringify(click)}).click()`);
	await sleep(Number(process.env.DUR ?? 2200));
	await send('Page.stopScreencast', {}, a);
	const name = process.env.NAME ?? 'motion';
	const pick = Number(process.env.PICK ?? 12);
	const step = Math.max(1, Math.floor(frames.length / pick));
	const chosen = frames.filter((_, i) => i % step === 0).slice(0, pick);
	const cells = chosen.map((f) => `<figure><img src="data:image/jpeg;base64,${f.data}"><figcaption>${f.t} ms</figcaption></figure>`).join('');
	writeFileSync(`${SHOTS}/${name}.html`, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px;font:12px monospace;color:#ddd}img{width:100%;display:block}figure{margin:0}</style>${cells}`);
	check(`recorded ${frames.length} frames`, frames.length > 3);
}
