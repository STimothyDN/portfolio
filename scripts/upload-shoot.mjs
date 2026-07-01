#!/usr/bin/env node
/**
 * Uploads a folder of photos to Bunny.net Storage and scaffolds/updates the
 * shoot's content collection JSON file with filenames, dimensions, and EXIF.
 *
 * Must be run with env vars loaded, e.g. via the `upload-shoot` npm script
 * (`node --env-file=.env scripts/upload-shoot.mjs ...`) — a bare
 * `node scripts/upload-shoot.mjs` will not have BUNNY_STORAGE_* available.
 *
 * Usage:
 *   npm run upload-shoot -- <folder> <shoot-slug> "<Title>" <YYYY-MM-DD> ["Location"] [--missing-photo-location "Location"] [--prompt-missing-photo-locations] [--force]
 *
 * Examples:
 *   npm run upload-shoot -- ./photos 2026-06-30-golden-gate-park "Golden Gate Park" 2026-06-30 "San Francisco, CA"
 *   npm run upload-shoot -- ./photos 2026-06-30-golden-gate-park "Golden Gate Park" 2026-06-30 --missing-photo-location "San Francisco, CA"
 *   npm run upload-shoot -- ./photos 2026-06-30-city-walk "City Walk" 2026-06-30 --prompt-missing-photo-locations
 *   npm run upload-shoot -- ./more-photos 2026-06-30-golden-gate-park "Golden Gate Park" 2026-06-30 --force
 */

import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import exifr from 'exifr';
import { imageSize } from 'image-size';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const CONTENT_DIR = path.resolve(import.meta.dirname, '../src/content/photography');

function usageAndExit(message) {
	if (message) console.error(`\nError: ${message}\n`);
	console.error(
		'Usage: npm run upload-shoot -- <folder> <shoot-slug> "<Title>" <YYYY-MM-DD> ["Location"] [--missing-photo-location "Location"] [--prompt-missing-photo-locations] [--force]'
	);
	process.exit(1);
}

function parseArgs(argv) {
	const positional = [];
	let force = false;
	let missingPhotoLocation;
	let promptMissingPhotoLocations = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--force') {
			force = true;
			continue;
		}
		if (arg === '--missing-photo-location') {
			missingPhotoLocation = argv[i + 1];
			if (!missingPhotoLocation || missingPhotoLocation.startsWith('--')) {
				usageAndExit('--missing-photo-location requires a location value.');
			}
			i++;
			continue;
		}
		if (arg === '--prompt-missing-photo-locations') {
			promptMissingPhotoLocations = true;
			continue;
		}
		if (arg.startsWith('--')) usageAndExit(`Unknown option "${arg}".`);
		positional.push(arg);
	}

	const [folder, slug, title, date, location] = positional;
	if (!folder || !slug || !title || !date) {
		usageAndExit('Missing required arguments.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		usageAndExit(`Date must be in YYYY-MM-DD format, got "${date}".`);
	}
	return { folder, slug, title, date, location, missingPhotoLocation, promptMissingPhotoLocations, force };
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		usageAndExit(
			`Missing required env var ${name}. Make sure .env is populated and you're running via "npm run upload-shoot".`
		);
	}
	return value;
}

function naturalSort(a, b) {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function formatShutterSpeed(exposureTime) {
	if (!exposureTime) return undefined;
	if (exposureTime >= 1) return `${exposureTime}s`;
	const denominator = Math.round(1 / exposureTime);
	return `1/${denominator}s`;
}

function formatCamera(make, model) {
	if (!make && !model) return undefined;
	if (make && model?.startsWith(make)) return model;
	return [make, model].filter(Boolean).join(' ');
}

function decimalGpsCoordinate(value, ref) {
	let coordinate;
	if (typeof value === 'number') {
		coordinate = value;
	} else if (Array.isArray(value) && value.length >= 3) {
		const [degrees, minutes, seconds] = value.map(Number);
		coordinate = degrees + minutes / 60 + seconds / 3600;
	}

	if (!Number.isFinite(coordinate)) return undefined;
	if (ref === 'S' || ref === 'W') return -Math.abs(coordinate);
	return coordinate;
}

function extractExifLocation(exif) {
	const latitude = decimalGpsCoordinate(exif.latitude ?? exif.GPSLatitude, exif.GPSLatitudeRef);
	const longitude = decimalGpsCoordinate(exif.longitude ?? exif.GPSLongitude, exif.GPSLongitudeRef);

	if (latitude === undefined || longitude === undefined) return undefined;
	return { latitude, longitude, source: 'exif' };
}

function manualLocation(name) {
	if (!name) return undefined;
	const trimmed = name.trim();
	if (!trimmed) return undefined;
	return { name: trimmed, source: 'manual' };
}

async function extractPhotoMeta(buffer) {
	const exif = await exifr.parse(buffer, { exif: true, gps: true, ifd0: true, tiff: true }).catch(() => null);

	let width;
	let height;
	try {
		const dimensions = imageSize(buffer);
		width = dimensions.width;
		height = dimensions.height;
	} catch {
		// Some files may not be readable by image-size; leave dimensions unset.
	}

	if (!exif) return { width, height };

	const camera = formatCamera(exif.Make, exif.Model);
	const lens = exif.LensModel;
	const focalLength = exif.FocalLength ? `${Math.round(exif.FocalLength)}mm` : undefined;
	const aperture = exif.FNumber ? `f/${exif.FNumber}` : undefined;
	const shutterSpeed = formatShutterSpeed(exif.ExposureTime);
	const iso = exif.ISO;
	const capturedAt = exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.toISOString() : undefined;
	const location = extractExifLocation(exif);

	const exifData = { camera, lens, focalLength, aperture, shutterSpeed, iso, capturedAt };
	const hasExif = Object.values(exifData).some((v) => v !== undefined);

	return { width, height, exif: hasExif ? exifData : undefined, location };
}

async function uploadToBunny({ zone, region, accessKey, shootSlug, filename, buffer }) {
	const host = region ? `${region}.storage.bunnycdn.com` : 'storage.bunnycdn.com';
	const url = `https://${host}/${zone}/photography/${shootSlug}/${filename}`;

	for (let attempt = 1; attempt <= 2; attempt++) {
		const res = await fetch(url, {
			method: 'PUT',
			headers: { AccessKey: accessKey, 'Content-Type': 'application/octet-stream' },
			body: buffer,
		});
		if (res.ok) return;
		if (attempt === 2) {
			throw new Error(`Upload failed for ${filename}: ${res.status} ${res.statusText}`);
		}
	}
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const { folder, slug, title, date, location, missingPhotoLocation, promptMissingPhotoLocations, force } = parseArgs(
		process.argv.slice(2)
	);

	const zone = requireEnv('BUNNY_STORAGE_ZONE');
	const accessKey = requireEnv('BUNNY_STORAGE_ACCESS_KEY');
	const region = process.env.BUNNY_STORAGE_REGION || '';

	const shootFilePath = path.join(CONTENT_DIR, `${slug}.json`);
	const shootExists = await fileExists(shootFilePath);
	if (shootExists && !force) {
		usageAndExit(
			`${slug}.json already exists in src/content/photography/. Pass --force to add more photos to this shoot without losing existing captions.`
		);
	}

	let existingPhotosByFilename = new Map();
	let existingShoot;
	if (shootExists) {
		existingShoot = JSON.parse(await readFile(shootFilePath, 'utf-8'));
		existingPhotosByFilename = new Map(existingShoot.photos.map((p) => [p.filename, p]));
	}

	const dirEntries = await readdir(folder, { withFileTypes: true });
	const filenames = dirEntries
		.filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
		.map((e) => e.name)
		.sort(naturalSort);

	if (filenames.length === 0) {
		usageAndExit(`No image files found in ${folder}.`);
	}

	console.log(`Uploading ${filenames.length} photo(s) from ${folder} to shoot "${slug}"...\n`);

	const rl = promptMissingPhotoLocations ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
	const photos = [];
	try {
		for (const [i, filename] of filenames.entries()) {
			const filePath = path.join(folder, filename);
			const buffer = await readFile(filePath);

			const meta = await extractPhotoMeta(buffer);
			await uploadToBunny({ zone, region, accessKey, shootSlug: slug, filename, buffer });

			const existing = existingPhotosByFilename.get(filename);
			let photoLocation = existing?.location ?? meta.location ?? manualLocation(missingPhotoLocation);
			if (!photoLocation && rl) {
				const answer = await rl.question(`Location for ${filename} (blank to skip): `);
				photoLocation = manualLocation(answer);
			}

			photos.push({
				filename,
				caption: existing?.caption ?? '',
				width: meta.width,
				height: meta.height,
				exif: meta.exif,
				location: photoLocation,
			});

			console.log(`Uploaded ${i + 1}/${filenames.length}: ${filename}`);
		}
	} finally {
		rl?.close();
	}

	// Preserve any existing photos not present in this batch (e.g. a --force run
	// pointed at a folder that's a subset of what's already uploaded).
	const newFilenames = new Set(filenames);
	for (const [filename, photo] of existingPhotosByFilename) {
		if (!newFilenames.has(filename)) photos.push(photo);
	}

	const shoot = {
		title: existingShoot?.title ?? title,
		date: existingShoot?.date ?? date,
		location: location ?? existingShoot?.location,
		description: existingShoot?.description,
		coverPhoto: existingShoot?.coverPhoto,
		photos,
	};

	await writeFile(shootFilePath, JSON.stringify(shoot, null, 2) + '\n');

	console.log(`\nWrote src/content/photography/${slug}.json`);
	console.log('Next steps: fill in captions for the new photos, then commit and push.');
}

main().catch((err) => {
	console.error('\nUpload failed:', err.message);
	process.exit(1);
});
