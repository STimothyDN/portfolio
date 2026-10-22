#!/usr/bin/env node
/**
 * Fills in each film scan's `tone` (black point, log-average and white point)
 * in the roll files. The film desk's Negative view works out from it how dense
 * that frame's negative was (src/components/film/negative.ts). upload-film
 * measures new scans itself; this backfills rolls uploaded before it did.
 *
 * For every scan without a tone it fetches a small PNG from the CDN and
 * measures it. Nothing else in the files changes.
 *
 * Usage:
 *   npm run measure-film-tone             # scans that have no tone yet
 *   npm run measure-film-tone -- --all    # re-measure every scan
 *   npm run measure-film-tone -- --dry-run
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { rollJson } from './lib/roll-json.mjs';
import { scanTone } from './lib/scan-tone.mjs';

const CONTENT_DIR = path.resolve(import.meta.dirname, '../src/content/film');
const CONCURRENCY = 8;
const dryRun = process.argv.includes('--dry-run');
const all = process.argv.includes('--all');

const cdn = process.env.PUBLIC_BUNNY_CDN_URL;
if (!cdn) {
	console.error('Missing PUBLIC_BUNNY_CDN_URL — run via "npm run measure-film-tone" so .env is loaded.');
	process.exit(1);
}

async function mapLimit(items, limit, fn) {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) await fn(items[next++]);
		})
	);
}

async function main() {
	const files = (await readdir(CONTENT_DIR, { recursive: true })).filter((f) => f.endsWith('.json'));
	let measured = 0;
	for (const file of files) {
		const filePath = path.join(CONTENT_DIR, file);
		const roll = JSON.parse(await readFile(filePath, 'utf-8'));
		const folder = roll.cdnFolder ?? `film/${path.basename(file, '.json')}`;
		const todo = roll.photos.filter((photo) => all || !photo.tone);
		if (!todo.length) continue;
		let done = 0;
		await mapLimit(todo, CONCURRENCY, async (photo) => {
			try {
				photo.tone = await scanTone(cdn, `${folder}/${photo.filename}`);
				done++;
			} catch (err) {
				console.warn(`  ! ${file}: ${err.message}`);
			}
		});
		measured += done;
		console.log(`${file}: ${done} scan(s) measured`);
		if (done && !dryRun) await writeFile(filePath, rollJson(roll));
	}
	console.log(`\n${dryRun ? 'Measured (nothing written)' : 'Measured'} ${measured} scan(s).`);
}

main().catch((err) => {
	console.error('\nMeasuring failed:', err.message);
	process.exit(1);
});
