#!/usr/bin/env node
/**
 * Generates succinct captions for every photo across all shoot JSONs in
 * src/content/photography/ that doesn't have one yet, using a locally
 * deployed LM Studio server running google/gemma-4-12b (see scripts/caption.mjs).
 *
 * Photos aren't stored in the repo, so each captionless photo is downloaded
 * from the Bunny CDN (resized via Bunny Optimizer when enabled) before being
 * sent to the model. Each shoot JSON is rewritten after every generated
 * caption, so an interrupted run keeps its progress.
 *
 * Must be run with env vars loaded, e.g. via the `generate-caption` npm script
 * (`node --env-file=.env scripts/generate-caption.mjs`) — PUBLIC_BUNNY_CDN_URL
 * is required.
 *
 * Usage:
 *   npm run generate-caption
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateCaption, fetchCaptionImage, lmStudioAvailable, lmStudioBaseUrl, LM_STUDIO_MODEL } from './caption.mjs';

const CONTENT_DIR = path.resolve(import.meta.dirname, '../src/content/photography');

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		console.error(
			`Missing required env var ${name}. Make sure .env is populated and you're running via "npm run generate-caption".`
		);
		process.exit(1);
	}
	return value;
}

async function main() {
	const cdnBase = requireEnv('PUBLIC_BUNNY_CDN_URL').replace(/\/+$/, '');

	if (!(await lmStudioAvailable())) {
		console.error(
			`LM Studio server is not reachable at ${lmStudioBaseUrl()}. Start LM Studio with ${LM_STUDIO_MODEL} loaded and try again.`
		);
		process.exit(1);
	}

	const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.json')).sort();
	let generated = 0;
	let failed = 0;

	for (const file of files) {
		const slug = path.basename(file, '.json');
		const shootFilePath = path.join(CONTENT_DIR, file);
		const shoot = JSON.parse(await readFile(shootFilePath, 'utf-8'));

		const pending = shoot.photos.filter((p) => !p.caption);
		if (pending.length === 0) continue;

		console.log(`\n${slug}: ${pending.length} photo(s) missing captions`);

		for (const photo of pending) {
			const captionContext = [shoot.title, photo.location?.name ?? shoot.location].filter(Boolean).join(' — ');
			try {
				const { buffer, mimeType } = await fetchCaptionImage(cdnBase, slug, photo.filename);
				photo.caption = await generateCaption(buffer, mimeType, { context: captionContext });
				await writeFile(shootFilePath, JSON.stringify(shoot, null, 2) + '\n');
				generated++;
				console.log(`  ${photo.filename}: ${photo.caption}`);
			} catch (error) {
				failed++;
				console.warn(`  ${photo.filename}: FAILED — ${error.message}`);
			}
		}
	}

	if (generated === 0 && failed === 0) {
		console.log('All photos already have captions — nothing to do.');
	} else {
		console.log(`\nGenerated ${generated} caption(s)${failed ? `, ${failed} failed` : ''}.`);
		console.log('Next steps: review the generated captions, then commit and push.');
	}
}

main().catch((err) => {
	console.error('\nCaption generation failed:', err.message);
	process.exit(1);
});
