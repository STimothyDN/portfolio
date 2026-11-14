/*
 * The Film Lab moved to lab.timo3.dev. Phones that used it here still have its
 * old service worker (scope /photography/lab/), which a redirect can't update.
 * This replacement takes over once, throws away the lab's caches on this site
 * (they held the logbook), unregisters itself, and reloads any open lab page,
 * which then redirects to lab.timo3.dev.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('film-lab')) await caches.delete(key);
			}
			await self.registration.unregister();
			for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
		})()
	);
});
