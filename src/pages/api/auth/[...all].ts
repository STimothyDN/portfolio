import type { APIRoute } from 'astro';

import { getAuth } from '../../../lib/lab/server/auth';

export const prerender = false;

/** Every Better Auth endpoint: passkeys, sessions, and the lab's own (plugin.ts). */
export const ALL: APIRoute = async ({ request }) => {
	const auth = getAuth();
	if (!auth) {
		return Response.json({ message: 'Film Lab isn’t configured on this deployment.' }, { status: 503 });
	}
	return (await auth).handler(request);
};
