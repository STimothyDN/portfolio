#!/usr/bin/env node
/**
 * Packs the Yale Bright Star Catalogue (5th revised ed., Hoffleit & Warren
 * 1991 — CDS catalogue V/50) into the compact star list the observatory sky
 * draws from (src/scripts/sky/bright-stars.json).
 *
 * Every star with a J2000 position and a V magnitude is kept (~9,100, the
 * naked-eye sky to about mag 6.5), sorted brightest first so the renderer can
 * stop at any magnitude limit. Each star is four integers in one flat array:
 * RA and Dec in hundredths of a degree, V magnitude and B−V colour in tenths.
 *
 * Usage (the catalogue isn't kept in the repo):
 *   curl -O https://cdsarc.cds.unistra.fr/ftp/cats/V/50/catalog.gz
 *   gunzip catalog.gz
 *   node scripts/build-star-catalog.mjs path/to/catalog
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../src/scripts/sky/bright-stars.json');

const input = process.argv[2];
if (!input) {
	console.error('Usage: node scripts/build-star-catalog.mjs path/to/catalog');
	process.exit(1);
}

// Fixed-width columns from the catalogue's ReadMe (1-based, inclusive).
const field = (line, from, to) => line.slice(from - 1, to).trim();
const number = (line, from, to) => {
	const text = field(line, from, to);
	return text === '' ? null : Number(text);
};

const stars = [];
for (const line of (await readFile(input, 'latin1')).split('\n')) {
	const raH = number(line, 76, 77);
	const vmag = number(line, 103, 107);
	// Blank positions mark stars later removed from the catalogue (novae, etc.).
	if (raH === null || vmag === null) continue;
	const ra = (raH + number(line, 78, 79) / 60 + number(line, 80, 83) / 3600) * 15;
	const sign = field(line, 84, 84) === '-' ? -1 : 1;
	const dec = sign * (number(line, 85, 86) + number(line, 87, 88) / 60 + number(line, 89, 90) / 3600);
	// No measured colour: assume a white (A-type) star.
	const bv = number(line, 110, 114) ?? 0.2;
	stars.push({ ra, dec, vmag, bv });
}

stars.sort((a, b) => a.vmag - b.vmag);
const data = stars.flatMap((s) => [
	Math.round(s.ra * 100),
	Math.round(s.dec * 100),
	Math.round(s.vmag * 10),
	Math.round(s.bv * 10),
]);

await writeFile(
	OUT,
	JSON.stringify({
		source: 'Yale Bright Star Catalogue, 5th rev. ed. (Hoffleit & Warren 1991), CDS V/50',
		format: 'flat [raCentideg, decCentideg, vmagDeci, bvDeci] per star, brightest first',
		count: stars.length,
		data,
	})
);
console.log(`Wrote ${stars.length} stars (mag ${stars[0].vmag} … ${stars.at(-1).vmag}) to ${path.relative(process.cwd(), OUT)}`);
