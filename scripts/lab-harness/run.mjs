// Film Lab browser harness: headless Chrome over CDP with a virtual passkey
// authenticator. Runs one step module against a dev server started with
// `npm run dev` (which always uses the LOCAL database).
//
//   node scripts/lab-harness/run.mjs <step> [base-url]
//   node scripts/lab-harness/run.mjs p2 http://localhost:4321
//
// Most steps start by claiming the lab as a new owner, so they need an empty
// local logbook: `node scripts/lab-harness/reset-db.mjs` first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, SHOTS } from './paths.mjs';

const STEPS = process.argv[2] ?? 'smoke';
const BASE = process.argv[3] ?? process.env.LAB_BASE ?? 'http://localhost:4321';

const profile = mkdtempSync(join(OUT, 'chrome-'));
process.on('exit', () => {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	} catch {
		// Chrome may still be closing; the folder is under .data and harmless.
	}
});
const chrome = spawn(
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'],
	{ stdio: ['ignore', 'ignore', 'pipe'] }
);
const wsUrl = await new Promise((resolve, reject) => {
	let buf = '';
	chrome.stderr.on('data', (d) => {
		buf += d;
		const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
		if (m) resolve(m[1]);
	});
	setTimeout(() => reject(new Error('chrome did not start')), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
	} else if (msg.method) {
		for (const l of listeners) l(msg);
	}
});
const send = (method, params = {}, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params, sessionId }));
	});
const once = (method, sessionId, timeout = 20000) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
		const l = (msg) => {
			if (msg.method === method && msg.sessionId === sessionId) {
				clearTimeout(t);
				listeners.splice(listeners.indexOf(l), 1);
				resolve(msg.params);
			}
		};
		listeners.push(l);
	});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function newPage(browserContextId) {
	const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) });
	const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
	await send('Page.enable', {}, s);
	await send('Runtime.enable', {}, s);
	await send('WebAuthn.enable', {}, s);
	await send(
		'WebAuthn.addVirtualAuthenticator',
		{
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
			},
		},
		s
	);
	return s;
}

async function evaluate(s, expression) {
	const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
	return r.result.value;
}
async function waitFor(s, expression, timeout = 15000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const v = await evaluate(s, expression);
			if (v) return v;
		} catch {}
		await sleep(150);
	}
	return null;
}
async function goto(s, path) {
	const loaded = once('Page.loadEventFired', s);
	await send('Page.navigate', { url: BASE + path }, s);
	await loaded;
	await waitFor(s, `!document.querySelector('astro-island[ssr]')`, 10000);
}
const hydrated = (s) => waitFor(s, `!document.querySelector('astro-island[ssr]')`, 10000);
const fill = (s, sel, value) =>
	evaluate(
		s,
		`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
	);
const clickText = (s, text) =>
	evaluate(
		s,
		`(() => { const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`
	);
const clickSel = (s, sel) => evaluate(s, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const path = (s) => evaluate(s, 'location.pathname + location.search');
const text = (s, sel = 'main') => evaluate(s, `document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
async function shot(s, name, { width = 1280, height = 900, mobile = false, light = false } = {}) {
	await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile }, s);
	await evaluate(s, `document.documentElement.classList.toggle('theme-dark', ${!light})`);
	await sleep(400);
	const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, s);
	writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
	await send('Emulation.clearDeviceMetricsOverride', {}, s);
}


async function setupOwner() {
	const a = await newPage();
	await goto(a, '/photography/lab/setup/');
	await fill(a, '#lab-setup-code', 'film-lab-dev');
	await fill(a, '#lab-claim-name', 'Test Owner');
	await fill(a, '#lab-claim-email', 'owner@example.test');
	await clickSel(a, '.claim button[type=submit]');
	await waitFor(a, `document.querySelectorAll('.code-list li').length === 10`);
	await clickSel(a, '#lab-codes-saved');
	const nav = once('Page.loadEventFired', a);
	await clickText(a, 'Open Film Lab');
	await nav;
	await hydrated(a);
	return a;
}
const consoleErrors = [];
listeners.push((m) => {
	if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
	if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleErrors.push(m.params.args.map((x) => x.value ?? x.description).join(' '));
});

try {
	const steps = await import(`./steps/${STEPS}.mjs`);
	await steps.default({ setupOwner, newPage, goto, hydrated, fill, clickText, clickSel, path, text, shot, evaluate, waitFor, once, send, sleep, check, BASE, listen: (fn) => listeners.push(fn) });
} catch (e) {
	check('script ran to completion', false, e.stack);
} finally {
	const failed = results.filter((r) => !r.ok).length;
	if (consoleErrors.length) console.log('console errors:\n' + [...new Set(consoleErrors)].slice(0, 15).join('\n'));
	console.log(`\n${results.length - failed}/${results.length} passed`);
	chrome.kill();
	process.exit(failed ? 1 : 0);
}
