/**
 * The film desk as data: every roll and scan, the display names and the CDN
 * base. Film Labs (lab.timo3.dev) reads this to know which scans exist; it is
 * the same information the desk page already shows. Prerendered, so it
 * changes with each deploy.
 */
import type { APIRoute } from 'astro';

import labels from '../../data/film-labels.json';
import { getFilmRolls } from '../../utils/film';

export const GET: APIRoute = async () => {
	const rolls = await getFilmRolls();
	const body = {
		version: 1,
		cdnBase: String(import.meta.env.PUBLIC_BUNNY_CDN_URL ?? '').replace(/\/$/, ''),
		labels,
		rolls: rolls.map((r) => ({
			id: r.id,
			title: r.data.title,
			developed: r.data.developed.toISOString().slice(0, 10),
			camera: r.data.camera,
			stock: r.data.stock,
			lab: r.data.lab,
			...(r.data.description ? { description: r.data.description } : {}),
			...(r.data.cdnFolder ? { cdnFolder: r.data.cdnFolder } : {}),
			photos: r.data.photos,
		})),
	};
	return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
