import { SESSION } from '../paths.mjs';
// Seed the local logbook (visual step, no screenshots) and keep the session cookie for steps-look.
import { writeFileSync } from 'node:fs';
import visual from './visual.mjs';

export default async function (h) {
	process.env.SHOTS = 'none';
	const { a } = await visual(h);
	const { cookies } = await h.send('Network.getAllCookies', {}, a);
	writeFileSync(SESSION, JSON.stringify(cookies));
	h.check('session saved', cookies.length > 0, `${cookies.length} cookies`);
}
