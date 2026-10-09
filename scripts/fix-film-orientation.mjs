#!/usr/bin/env node
/**
 * Corrects width/height in the film roll files for scans whose EXIF orientation
 * flag turns them (e.g. vertical shots stored sideways with "rotate 90").
 * Browsers and the CDN honor that flag, so such a scan displays portrait while
 * its roll file — written from the raw pixel size by older versions of
 * upload-film — says landscape, and the site crops it.
 *
 * For every scan it requests a tiny copy from the CDN (a few hundred bytes),
 * reads the size the CDN actually serves, and swaps width/height in the JSON
 * where the orientation disagrees. Nothing else in the files changes.
 *
 * Usage:
 *   npm run fix-film-orientation            # fix the files
 *   npm run fix-film-orientation -- --dry-run
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';

const CONTENT_DIR = path.resolve(import.meta.dirname, '../src/content/film');
const CONCURRENCY = 8;
const dryRun = process.argv.includes('--dry-run');

const cdn = process.env.PUBLIC_BUNNY_CDN_URL;
if (!cdn) {
	console.error('Missing PUBLIC_BUNNY_CDN_URL — run via "npm run fix-film-orientation" so .env is loaded.');
	process.exit(1);
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function servedSize(folder, filename) {
	const res = await fetch(`${cdn}/${encodePath(`${folder}/${filename}`)}?width=24`);
	if (!res.ok) throw new Error(`${res.status} for ${folder}/${filename}`);
	return imageSize(new Uint8Array(await res.arrayBuffer()));
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
	let fixed = 0;
	let checked = 0;
	for (const file of files) {
		const filePath = path.join(CONTENT_DIR, file);
		const roll = JSON.parse(await readFile(filePath, 'utf-8'));
		const folder = roll.cdnFolder ?? `film/${path.basename(file, '.json')}`;
		const swapped = [];
		await mapLimit(roll.photos, CONCURRENCY, async (photo) => {
			if (!photo.width || !photo.height) return;
			try {
				const served = await servedSize(folder, photo.filename);
				checked++;
				const servedPortrait = served.height > served.width;
				const storedPortrait = photo.height > photo.width;
				if (servedPortrait !== storedPortrait) {
					[photo.width, photo.height] = [photo.height, photo.width];
					swapped.push(photo.filename);
				}
			} catch (err) {
				console.warn(`  ! ${file}: ${err.message}`);
			}
		});
		if (swapped.length) {
			fixed += swapped.length;
			console.log(`${file}: ${swapped.length} scan(s) ${dryRun ? 'would be turned' : 'turned'} upright`);
			if (!dryRun) await writeFile(filePath, JSON.stringify(roll, null, 2) + '\n');
		}
	}
	console.log(`\nChecked ${checked} scan(s); ${dryRun ? 'would fix' : 'fixed'} ${fixed}.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
