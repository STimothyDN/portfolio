/*
 * Film Lab service worker. Scope: /photography/lab/ only, so the public site
 * is never controlled by it.
 *
 * - Lab pages: network first (4 s), falling back to the last copy this phone
 *   saw, so shooting mode opens with no signal.
 * - Hashed build assets (/_astro/*): cache first; they never change.
 * - Anything else same-origin those pages load (fonts, icons): network first.
 * - Writes (/_actions, /api) are never cached; the page's outbox retries them.
 *
 * Signing out deletes these caches (they hold the logbook).
 */
const PAGES = 'film-lab-pages-v1';
const ASSETS = 'film-lab-assets-v1';
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

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/_actions') || url.pathname.startsWith('/api/')) return;

	if (url.pathname.startsWith('/_astro/')) {
		event.respondWith(cacheFirst(req));
	} else if (url.pathname.startsWith('/photography/lab')) {
		event.respondWith(networkFirst(req, PAGES, 4000));
	} else {
		event.respondWith(networkFirst(req, ASSETS, 6000));
	}
});

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
