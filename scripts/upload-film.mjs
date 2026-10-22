#!/usr/bin/env node
/**
 * Uploads film scans to Bunny.net Storage and writes one roll file per scan
 * folder into src/content/film/ (the film desk at /photography/film/).
 *
 * A roll is a folder of scans whose NAME is the metadata:
 *
 *   <dateDeveloped>_<camera>_<filmStock>_<lab>_<summary>
 *   20261007_minoltax700_fuji400_fotoshoppe_downtowndurham
 *
 * Point it at one roll folder, or at a folder full of them (every subfolder
 * named that way is uploaded). Rolls that already have a JSON are skipped
 * unless --force, which merges: new scans are added, and existing titles,
 * priorities and captions are kept.
 *
 * Priority (how close to the top of the pile a print lands, 1–5) comes from
 * each scan's star rating when it has one (Lightroom, Bridge, Capture One,
 * darktable and Windows all write it), otherwise 3. Tweak it in the JSON later.
 *
 * Once a scan is up, its tone (black point, average, white point) is measured
 * from the CDN for the Negative view (see scripts/measure-film-tone.mjs).
 *
 * Must be run with env vars loaded (`npm run upload-film`, which passes
 * --env-file=.env) — except with --dry-run, which uploads and writes nothing.
 *
 * Usage:
 *   npm run upload-film -- <roll-folder | folder-of-rolls> [...more] [--title "Title"] [--force] [--dry-run]
 *
 * Examples:
 *   npm run upload-film -- ~/Pictures/Film/20261007_minoltax700_fuji400_fotoshoppe_downtowndurham --title "Downtown Durham"
 *   npm run upload-film -- ~/Pictures/Film --dry-run
 *   npm run upload-film -- ~/Pictures/Film
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import { imageSize } from 'image-size';

import { fileExists, naturalSort, uploadToBunny } from './lib/bunny-storage.mjs';
import { rollJson } from './lib/roll-json.mjs';
import { scanTone } from './lib/scan-tone.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Common scan formats the CDN's optimizer can't serve — export them as JPEG first.
const UNSUPPORTED_EXTENSIONS = new Set(['.tif', '.tiff', '.heic', '.dng', '.raw']);
const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'src/content/film');
const LABELS_PATH = path.join(ROOT, 'src/data/film-labels.json');
const ROLL_NAME = /^(\d{4})(\d{2})(\d{2})_([^_]+)_([^_]+)_([^_]+)_(.+)$/;
const CONCURRENCY = 4;

// First guesses for common folder tokens. Whatever gets written to
// film-labels.json is the real source — edit names there.
const COMMON_LABELS = {
	cameras: {
		canonae1: 'Canon AE-1',
		canonae1p: 'Canon AE-1 Program',
		minoltax700: 'Minolta X-700',
		minoltax570: 'Minolta X-570',
		nikonfm2: 'Nikon FM2',
		olympusom1: 'Olympus OM-1',
		olympusstylusepic: 'Olympus Stylus Epic',
		olympusmju2: 'Olympus μ[mju:] II',
		pentaxk1000: 'Pentax K1000',
		ricohxrm: 'Ricoh XR-M',
		yashicat4: 'Yashica T4',
		contaxt2: 'Contax T2',
		leicam6: 'Leica M6',
	},
	stocks: {
		portra160: 'Kodak Portra 160',
		portra400: 'Kodak Portra 400',
		portra800: 'Kodak Portra 800',
		gold200: 'Kodak Gold 200',
		ultramax400: 'Kodak UltraMax 400',
		ektar100: 'Kodak Ektar 100',
		colorplus200: 'Kodak ColorPlus 200',
		trix400: 'Kodak Tri-X 400',
		fuji200: 'Fujifilm 200',
		fuji400: 'Fujifilm 400',
		superia400: 'Fujifilm Superia 400',
		hp5: 'Ilford HP5 Plus 400',
		delta400: "Ilford Delta 400 Collector's Edition",
		delta3200: 'Ilford Delta 3200',
		ilfocolor400: 'Ilford Ilfocolor 400 Plus',
		proimage100: 'Kodak ProImage 100',
		ektacolorpro400: 'Kodak Ektacolor Pro 400',
		kodacolor200: 'Kodak Kodacolor 200',
		fujisuperia: 'Fujicolor Superia',
		fujisuperiaxtra400: 'Fujicolor Superia X-Tra 400',
		samesamebutdifferent400: 'Same Same But Different! 400',
		secretsauce100: 'Secret Sauce 100',
		candido800: 'Candido 800',
		lomocolor92: "Color '92",
		lomocolor92sunkissed: "Color '92 Sun-kissed",
		cinestill50d: 'CineStill 50D',
		cinestill400d: 'CineStill 400D',
		cinestill800t: 'CineStill 800T',
	},
	labs: {},
};

function usageAndExit(message) {
	if (message) console.error(`\nError: ${message}\n`);
	console.error(
		'Usage: npm run upload-film -- <roll-folder | folder-of-rolls> [...more] [--title "Title"] [--force] [--dry-run]\n' +
			'Roll folders are named <YYYYMMDD>_<camera>_<filmStock>_<lab>_<summary>,\n' +
			'e.g. 20261007_minoltax700_fuji400_fotoshoppe_downtowndurham'
	);
	process.exit(1);
}

function parseArgs(argv) {
	const paths = [];
	let title;
	let force = false;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--force') force = true;
		else if (arg === '--dry-run') dryRun = true;
		else if (arg === '--title') {
			title = argv[++i];
			if (!title || title.startsWith('--')) usageAndExit('--title requires a value.');
		} else if (arg.startsWith('--')) usageAndExit(`Unknown option "${arg}".`);
		else paths.push(arg);
	}
	if (!paths.length) usageAndExit('Pass at least one folder.');
	return { paths, title, force, dryRun };
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		usageAndExit(
			`Missing required env var ${name}. Make sure .env is populated and you're running via "npm run upload-film".`
		);
	}
	return value;
}

/** Lowercase and keep to [a-z0-9-] so tokens are safe as ids, URLs and CDN paths. */
const cleanToken = (token) =>
	token
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');

/** Same fallback the site uses (src/utils/film.ts): "portra400" → "Portra 400". */
function humanizeToken(token) {
	return token
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([a-zA-Z])(\d)/g, '$1 $2')
		.replace(/(\d)([a-zA-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Folder name → roll metadata, or null when it doesn't follow the convention. */
function parseRollName(name) {
	const match = ROLL_NAME.exec(name.trim());
	if (!match) return null;
	const [, y, m, d, camera, stock, lab, summary] = match;
	const developed = `${y}-${m}-${d}`;
	const date = new Date(`${developed}T00:00:00Z`);
	if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== developed) return null;
	const parts = [camera, stock, lab, summary].map(cleanToken);
	if (parts.some((p) => !p)) return null;
	return {
		id: [`${y}${m}${d}`, ...parts].join('_'),
		developed,
		camera: parts[0],
		stock: parts[1],
		lab: parts[2],
		summary: summary.trim(),
	};
}

/** Expand the CLI paths into roll folders (a roll itself, or a folder of rolls). */
async function findRolls(paths) {
	const rolls = [];
	for (const input of paths) {
		const folder = path.resolve(input);
		const info = await stat(folder).catch(() => null);
		if (!info?.isDirectory()) usageAndExit(`${input} is not a folder.`);

		const own = parseRollName(path.basename(folder));
		if (own) {
			rolls.push({ folder, ...own });
			continue;
		}
		const entries = await readdir(folder, { withFileTypes: true });
		const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
		let found = 0;
		for (const entry of subdirs.sort((a, b) => naturalSort(a.name, b.name))) {
			const parsed = parseRollName(entry.name);
			if (parsed) {
				rolls.push({ folder: path.join(folder, entry.name), ...parsed });
				found++;
			} else {
				console.warn(`  Skipping "${entry.name}" — not named <YYYYMMDD>_<camera>_<film>_<lab>_<summary>.`);
			}
		}
		if (!found) {
			console.warn(`  No roll folders found in ${input} (and its own name isn't a roll name either).`);
		}
	}
	return rolls;
}

async function listScans(folder) {
	const entries = await readdir(folder, { withFileTypes: true });
	const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
	const unsupported = files.filter((f) => UNSUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()));
	if (unsupported.length) {
		console.warn(`    Skipping ${unsupported.length} file(s) the CDN can't serve (${unsupported[0]}…) — export JPEGs.`);
	}
	return files.filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())).sort(naturalSort);
}

/** Star rating (0–5, -1 = rejected) → pile priority (1–5). Unrated → 3. */
function priorityFromRating(rating) {
	if (typeof rating !== 'number' || rating === 0) return 3;
	if (rating < 0) return 1;
	return Math.min(5, Math.max(1, Math.round(rating)));
}

async function scanMeta(buffer) {
	let width;
	let height;
	try {
		({ width, height } = imageSize(buffer));
	} catch {
		// Leave dimensions unset; the site falls back to 3:2.
	}
	const tags = await exifr.parse(buffer, { xmp: true, ifd0: true, exif: false, gps: false }).catch(() => null);
	// Labs often save vertical shots sideways with an EXIF "rotate 90" flag.
	// Browsers and the CDN honor it, so record the size as displayed.
	const orientation = await exifr.orientation(buffer).catch(() => undefined);
	if (orientation >= 5 && orientation <= 8) [width, height] = [height, width];
	return { width, height, rating: tags?.Rating };
}

async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

async function processRoll(roll, { title, force, dryRun, storage, cdn }) {
	const jsonPath = path.join(CONTENT_DIR, `${roll.id}.json`);
	const exists = await fileExists(jsonPath);
	if (exists && !force) {
		console.log(`• ${roll.id} — already uploaded, skipping (pass --force to add scans).`);
		return null;
	}

	const existing = exists ? JSON.parse(await readFile(jsonPath, 'utf-8')) : null;
	const existingByFile = new Map((existing?.photos ?? []).map((p) => [p.filename, p]));
	console.log(`• ${roll.id}`);
	const filenames = await listScans(roll.folder);
	if (!filenames.length) {
		console.warn(`    No .jpg/.png/.webp scans in ${roll.folder}, skipping.`);
		return null;
	}
	let done = 0;
	const photos = await mapLimit(filenames, CONCURRENCY, async (filename) => {
		const prior = existingByFile.get(filename);
		const buffer = await readFile(path.join(roll.folder, filename));
		const meta = await scanMeta(buffer);
		let tone;
		if (!dryRun) {
			const remotePath = `film/${roll.id}/${filename}`;
			await uploadToBunny({ ...storage, remotePath, buffer });
			tone = await scanTone(cdn, remotePath).catch((err) => {
				console.warn(`\n    Couldn't measure ${filename}'s tone (${err.message}) — run measure-film-tone later.`);
				return prior?.tone;
			});
		}
		done++;
		process.stdout.write(`\r    ${dryRun ? 'Read' : 'Uploaded'} ${done}/${filenames.length} scan(s)`);
		return {
			filename,
			width: meta.width,
			height: meta.height,
			priority: prior?.priority ?? priorityFromRating(meta.rating),
			...(prior?.caption ? { caption: prior.caption } : {}),
			...(tone ? { tone } : {}),
		};
	});
	process.stdout.write('\n');

	// Keep scans already in the JSON that weren't in this folder.
	const fresh = new Set(filenames);
	for (const [filename, photo] of existingByFile) if (!fresh.has(filename)) photos.push(photo);

	const data = {
		title: existing?.title ?? title ?? humanizeToken(roll.summary),
		developed: roll.developed,
		camera: roll.camera,
		stock: roll.stock,
		lab: roll.lab,
		...(existing?.description ? { description: existing.description } : {}),
		photos,
	};
	if (!dryRun) await writeFile(jsonPath, rollJson(data));

	const rated = photos.filter((p) => p.priority !== 3).length;
	console.log(`    "${data.title}" · ${rated} scan(s) with a non-default priority`);
	return data;
}

async function main() {
	const { paths, title, force, dryRun } = parseArgs(process.argv.slice(2));
	const rolls = await findRolls(paths);
	if (!rolls.length) usageAndExit('No roll folders to upload.');
	if (title && rolls.length > 1) usageAndExit('--title only works when uploading a single roll.');

	const storage = dryRun
		? null
		: {
				zone: requireEnv('BUNNY_STORAGE_ZONE'),
				accessKey: requireEnv('BUNNY_STORAGE_ACCESS_KEY'),
				region: process.env.BUNNY_STORAGE_REGION || '',
			};
	const cdn = dryRun ? null : requireEnv('PUBLIC_BUNNY_CDN_URL');

	console.log(`${dryRun ? 'Checking' : 'Uploading'} ${rolls.length} roll(s)…\n`);
	const written = [];
	for (const roll of rolls) {
		const data = await processRoll(roll, { title, force, dryRun, storage, cdn });
		if (data) written.push(data);
	}

	// Give every new camera / film stock / lab a display name to review.
	const labels = JSON.parse(await readFile(LABELS_PATH, 'utf-8'));
	const added = [];
	for (const roll of written) {
		for (const [kind, key] of [
			['cameras', roll.camera],
			['stocks', roll.stock],
			['labs', roll.lab],
		]) {
			labels[kind] ??= {};
			if (labels[kind][key]) continue;
			labels[kind][key] = COMMON_LABELS[kind][key] ?? humanizeToken(key);
			added.push(`${kind.slice(0, -1)} "${key}" → "${labels[kind][key]}"`);
		}
	}
	if (added.length && !dryRun) {
		for (const kind of Object.keys(labels)) {
			labels[kind] = Object.fromEntries(Object.entries(labels[kind]).sort(([a], [b]) => a.localeCompare(b)));
		}
		await writeFile(LABELS_PATH, JSON.stringify(labels, null, 2) + '\n');
	}

	console.log(`\n${dryRun ? 'Would write' : 'Wrote'} ${written.length} roll file(s) in src/content/film/.`);
	if (added.length) {
		console.log(`${dryRun ? 'Would add' : 'Added'} display names to src/data/film-labels.json — check them:`);
		for (const line of added) console.log(`  ${line}`);
	}
	if (written.length) {
		console.log('Next: review each roll\'s "title" (guessed from the folder summary), then commit and push.');
	}
}

main().catch((err) => {
	console.error('\nUpload failed:', err.message);
	process.exit(1);
});
