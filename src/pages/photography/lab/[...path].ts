/*
 * The Film Lab moved to lab.timo3.dev (the film-labs repo). Its old links, and
 * the QR codes on labels already printed, keep working: anything under
 * /photography/lab is sent, permanently, to the same path there, query and all
 * (/photography/lab/r/R-010 → https://lab.timo3.dev/r/R-010).
 *
 * Rendered per request because a static build can't prerender a catch-all
 * redirect to another site.
 */
import type { APIRoute } from 'astro';

export const prerender = false;

const LAB = 'https://lab.timo3.dev';

export const GET: APIRoute = ({ params, url }) => {
	const path = params.path ? `/${params.path}` : '/';
	// Keep the trailing slash the old link had (the lab's pages use them).
	const slash = path !== '/' && url.pathname.endsWith('/') ? '/' : '';
	return new Response(null, {
		status: 308,
		headers: { Location: `${LAB}${path}${slash}${url.search}`, 'Cache-Control': 'public, max-age=86400' },
	});
};

export const HEAD = GET;
