import { defineMiddleware } from 'astro:middleware';

import { getAuth, type LabUser } from './lib/lab/server/auth';
import { labConfig } from './lib/lab/server/config';
import { GUEST_PAGES, guestOwner } from './lib/lab/server/guest';

const LAB = '/photography/lab';
/** Lab pages you can open signed out. Everything else under /photography/lab needs a session. */
const OPEN_PAGES = /^\/photography\/lab\/(sign-in|setup|invite\/[^/]+)\/?$/;

export const onRequest = defineMiddleware(async (context, next) => {
	// Public pages are prerendered at build time; none of this applies to them.
	if (context.isPrerendered) return next();

	const { pathname } = context.url;
	const isLab = pathname === LAB || pathname.startsWith(`${LAB}/`);
	// Astro Actions (src/actions): the lab's writes. They check locals.user themselves.
	const isAction = pathname.startsWith('/_actions/');
	if (!isLab && !isAction && !pathname.startsWith('/api/auth/')) return next();

	const started = performance.now();
	let authMs = 0;
	if (isLab || isAction) {
		context.locals.user = null;
		context.locals.labConfigured = false;
		context.locals.guest = null;
		const auth = getAuth();
		if (auth) {
			context.locals.labConfigured = true;
			const t = performance.now();
			const session = await (await auth).api.getSession({ headers: context.request.headers });
			authMs = performance.now() - t;
			context.locals.user = (session?.user as LabUser | undefined) ?? null;
		}
	}
	// Guests' reads (the ⌘K finder) look at the owner's lab; every write still needs `user`.
	if (isAction && context.locals.labConfigured && !context.locals.user) {
		const config = labConfig();
		if (config.ok) context.locals.guest = await guestOwner(config.config);
	}
	// How long the server spent, for the browser's network panel (Server-Timing).
	const timed = (response: Response) => {
		try {
			response.headers.set('Server-Timing', `auth;dur=${authMs.toFixed(1)}, total;dur=${(performance.now() - started).toFixed(1)}`);
		} catch {
			// Immutable headers (redirects): noindex() copies them, timing can go without.
		}
		return response;
	};

	if (isLab) {
		const open = OPEN_PAGES.test(pathname);
		// Signed out on a page guests may read: show the owner's lab, read-only.
		if (context.locals.labConfigured && !context.locals.user && !open && GUEST_PAGES.test(pathname)) {
			const config = labConfig();
			if (config.ok) context.locals.guest = await guestOwner(config.config);
		}
		if (context.locals.labConfigured && !context.locals.user && !context.locals.guest && !open) {
			const next = pathname === LAB || pathname === `${LAB}/` ? '' : `?next=${encodeURIComponent(pathname)}`;
			return noindex(context.redirect(`${LAB}/sign-in/${next}`));
		}
		if (context.locals.user && /\/sign-in\/?$/.test(pathname)) {
			return noindex(context.redirect(`${LAB}/`));
		}
	}

	return noindex(timed(await next()));
});

/** Private pages: never indexed, never cached by a shared cache. */
function noindex(response: Response): Response {
	try {
		response.headers.set('X-Robots-Tag', 'noindex, nofollow');
		response.headers.set('Cache-Control', 'private, no-store');
		return response;
	} catch {
		// Some responses (e.g. Response.redirect) have immutable headers.
		const copy = new Response(response.body, response);
		copy.headers.set('X-Robots-Tag', 'noindex, nofollow');
		copy.headers.set('Cache-Control', 'private, no-store');
		return copy;
	}
}
