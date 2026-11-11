/*
 * Film Lab service worker. Scope: /photography/lab/ only, so the public site
 * is never controlled by it.
 *
 * - Lab pages: network first (4 s), falling back to the last copy this phone
 *   saw, so shooting mode opens with no signal.
 * - Hashed build assets (/_astro/*): cache first; they never change.
 * - Anything else same-origin those pages load (fonts, icons): network first.
 * - Writes (/_actions, /api) are never cached; the page's outbox retries them.
 * - Pages asked for a moment early (the page sends `X-Lab-Prefetch` when a
 *   finger lands on a link, or the pointer rests on one) are kept for one use
 *   and at most 15 s, so the tap that follows answers at once. Any write
 *   throws them away first, so a page is never older than the last change.
 *
 * Signing out deletes these caches (they hold the logbook).
 */
const PAGES = 'film-lab-pages-v3';
const ASSETS = 'film-lab-assets-v3';
const KEEP = [PAGES, ASSETS];
const MAX_ASSETS = 400;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('film-lab') && !KEEP.includes(key)) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

/** Pages fetched a moment early: path → { at, res }. One use each, 15 s at most. */
const warm = new Map();
const WARM_MS = 15000;
const keyOf = (href) => {
	const u = new URL(href);
	return u.pathname + u.search;
};

/*
 * Saving the shooting workflow for offline use (the page asks, with signal):
 * fetch the bench and shooting mode, keep them, and keep every script and
 * stylesheet they load, so they open with no signal even if this phone has
 * never opened them before.
 */
self.addEventListener('message', (event) => {
	if (event.data?.type !== 'save-for-offline') return;
	event.waitUntil(saveForOffline(event.data.pages ?? []));
});

async function saveForOffline(pages) {
	const pageCache = await caches.open(PAGES);
	const assetCache = await caches.open(ASSETS);
	for (const path of pages) {
		try {
			const res = await fetch(new Request(path, { credentials: 'same-origin', headers: { Accept: 'text/html' } }));
			if (!storable(res)) continue;
			const html = await res.clone().text();
			await pageCache.put(path, res);
			// Built assets (and, in development, the module graph's entry points).
			const urls = new Set([...html.matchAll(/(?:src|href)="(\/(?:_astro|@vite|@id|src|node_modules)\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')));
			for (const m of html.matchAll(/component-url="([^"]+)"|renderer-url="([^"]+)"/g)) urls.add((m[1] || m[2]).replace(/&amp;/g, '&'));
			// Follow each script's own imports (island chunks import the runtime and shared chunks).
			const queue = [...urls];
			const seen = new Set(queue);
			while (queue.length && seen.size < 400) {
				const url = queue.shift();
				let a = await assetCache.match(url);
				if (!a) {
					a = await fetch(url).catch(() => null);
					if (!storable(a)) continue;
					await assetCache.put(url, a.clone());
				}
				// Stylesheets: the fonts and images they use.
				if (/\.css(\?|$)/.test(url)) {
					const css = await a.text();
					for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
						if (m[1].startsWith('data:')) continue;
						const next = new URL(m[1], self.location.origin + url).pathname;
						if (next.startsWith('/') && !seen.has(next)) {
							seen.add(next);
							queue.push(next);
						}
					}
					continue;
				}
				if (!/\.(m?js|ts|vue)(\?|$)|\/@id\/|\/@vite\//.test(url)) continue;
				const code = await a.text();
				for (const m of code.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
					const spec = m[1];
					if (!/^(\.{1,2}\/|\/)/.test(spec)) continue;
					const next = new URL(spec, self.location.origin + url).pathname + new URL(spec, self.location.origin + url).search;
					if (!seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
				}
			}
		} catch {
			// No signal after all: try again next time.
		}
	}
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (req.method !== 'GET') {
		// A write: whatever was fetched early may be out of date now.
		if (url.pathname.startsWith('/_actions') || url.pathname.startsWith('/api/')) warm.clear();
		return;
	}
	if (url.pathname.startsWith('/_actions') || url.pathname.startsWith('/api/')) return;

	if (url.pathname.startsWith('/_astro/')) {
		event.respondWith(cacheFirst(req));
	} else if (url.pathname.startsWith('/photography/lab')) {
		if (req.headers.get('X-Lab-Prefetch') === '1') event.respondWith(warmUp(req));
		else event.respondWith(fromWarm(req) ?? networkFirst(req, PAGES, 4000));
	} else {
		event.respondWith(networkFirst(req, ASSETS, 6000));
	}
});

/** Start fetching a page the person is about to open, and keep it for them. */
function warmUp(req) {
	const key = keyOf(req.url);
	const have = warm.get(key);
	if (!have || Date.now() - have.at > WARM_MS) {
		const res = fetch(new Request(req.url, { credentials: 'same-origin', headers: { 'X-Lab-Prefetch': '1', Accept: 'text/html' } }));
		warm.set(key, { at: Date.now(), res });
		// The offline copy stays current too (cloned before anyone reads the body).
		res.then((r) => {
			if (storable(r)) caches.open(PAGES).then((c) => c.put(req.url, r.clone()));
		}).catch(() => warm.delete(key));
	}
	return new Response(null, { status: 204 });
}

/** The early copy of this page, if there's a fresh one (used once). */
function fromWarm(req) {
	const key = keyOf(req.url);
	const hit = warm.get(key);
	if (!hit) return null;
	warm.delete(key);
	if (Date.now() - hit.at > WARM_MS) return null;
	return hit.res
		.then((res) => (res.ok && !res.redirected ? res : networkFirst(req, PAGES, 4000)))
		.catch(() => networkFirst(req, PAGES, 4000));
}

const storable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

async function cacheFirst(req) {
	const cache = await caches.open(ASSETS);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (storable(res)) {
		await cache.put(req, res.clone());
		trim(cache);
	}
	return res;
}

async function networkFirst(req, cacheName, timeoutMs) {
	const cache = await caches.open(cacheName);
	try {
		const res = await withTimeout(fetch(req), timeoutMs);
		if (storable(res)) cache.put(req, res.clone());
		return res;
	} catch {
		const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
		if (hit) return hit;
		// A lab page this phone never opened: offer shooting mode, which it probably did.
		if (req.mode === 'navigate') {
			const shoot = await caches.open(PAGES).then((c) => c.match('/photography/lab/shoot/', { ignoreSearch: true }));
			if (shoot) return shoot;
		}
		return new Response('Offline, and this page isn’t saved on this phone yet.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}
}

function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

async function trim(cache) {
	const keys = await cache.keys();
	for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}
