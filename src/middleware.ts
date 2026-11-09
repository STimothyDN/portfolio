import { defineMiddleware } from 'astro:middleware';

import { getAuth, type LabUser } from './lib/lab/server/auth';

const LAB = '/photography/lab';
/** Lab pages you can open signed out. Everything else under /photography/lab needs a session. */
const OPEN_PAGES = /^\/photography\/lab\/(sign-in|setup|invite\/[^/]+)\/?$/;
/**
 * Not a secret: tells the static film desk that this device has signed in to
 * the lab before, so it can show the Lab button (FilmFilterDock.vue).
 */
export const DEVICE_HINT_COOKIE = 'film_lab_device';

export const onRequest = defineMiddleware(async (context, next) => {
	// Public pages are prerendered at build time; none of this applies to them.
	if (context.isPrerendered) return next();

	const { pathname } = context.url;
	const isLab = pathname === LAB || pathname.startsWith(`${LAB}/`);
	if (!isLab && !pathname.startsWith('/api/auth/')) return next();

	if (isLab) {
		context.locals.user = null;
		context.locals.labConfigured = false;
		const auth = getAuth();
		if (auth) {
			context.locals.labConfigured = true;
			const session = await (await auth).api.getSession({ headers: context.request.headers });
			context.locals.user = (session?.user as LabUser | undefined) ?? null;
		}

		const open = OPEN_PAGES.test(pathname);
		if (context.locals.labConfigured && !context.locals.user && !open) {
			const next = pathname === LAB || pathname === `${LAB}/` ? '' : `?next=${encodeURIComponent(pathname)}`;
			return noindex(context.redirect(`${LAB}/sign-in/${next}`));
		}
		if (context.locals.user && /\/sign-in\/?$/.test(pathname)) {
			return noindex(context.redirect(`${LAB}/`));
		}
		if (context.locals.user) {
			context.cookies.set(DEVICE_HINT_COOKIE, '1', {
				path: '/',
				maxAge: 60 * 60 * 24 * 365,
				sameSite: 'lax',
				secure: context.url.protocol === 'https:',
			});
		}
	}

	return noindex(await next());
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
