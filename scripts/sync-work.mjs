#!/usr/bin/env node
/**
 * Writes src/data/work-signals.json: what the work pages chart about each
 * project beyond its Markdown frontmatter.
 *
 * - spectrum: the screenshot's colour, measured here with sharp — chroma per
 *   5° of OKLCH hue (72 bins, normalised to the strongest), its mean chroma
 *   over every pixel (how colourful the whole frame is, which scales the
 *   bins when drawn), the share of near-neutral pixels, mean lightness, and a
 *   five-colour palette (k-means in OKLab). The work pages draw it as an
 *   emission spectrum.
 * - github (projects whose `link` is a GitHub repo): created/pushed dates,
 *   stars, forks, homepage, the language breakdown in bytes and every commit's
 *   author date on the default branch — the activity light curve.
 *
 * GitHub's unauthenticated API allows 60 requests an hour, plenty for a
 * handful of repos; set GITHUB_TOKEN in .env to lift it. If GitHub can't be
 * reached, the previous snapshot's github block is kept.
 *
 * Usage:
 *   npm run sync-work
 *   npm run sync-work -- --offline   # spectra only, keep the github blocks
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'src/content/work');
const OUT = path.join(ROOT, 'src/data/work-signals.json');
const offline = process.argv.includes('--offline');
const token = process.env.GITHUB_TOKEN;

/* ── Colour ─────────────────────────────────────────────────────────── */

const SAMPLE_W = 200;
const BINS = 72;
/** Below this OKLCH chroma a pixel reads as grey. */
const NEUTRAL_C = 0.03;

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LUT = Array.from({ length: 256 }, (_, v) => toLinear(v / 255));

function oklab(r, g, b) {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function oklabToHex([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return `#${rgb
		.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v))))) * 255))
		.map((v) => v.toString(16).padStart(2, '0'))
		.join('')}`;
}

/** Seeded so a re-run on the same image writes the same palette. */
function lcg(seed) {
	let s = seed;
	return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** k-means++ in OKLab; returns clusters by share, largest first. */
function palette(points, k) {
	const rand = lcg(4231);
	const n = points.length / 3;
	const dist = (i, c) => {
		const dl = points[i * 3] - c[0];
		const da = points[i * 3 + 1] - c[1];
		const db = points[i * 3 + 2] - c[2];
		return dl * dl + da * da + db * db;
	};
	const pick = (i) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
	const centres = [pick(Math.floor(rand() * n))];
	const d2 = new Float64Array(n).fill(Infinity);
	while (centres.length < k) {
		let total = 0;
		for (let i = 0; i < n; i++) total += d2[i] = Math.min(d2[i], dist(i, centres.at(-1)));
		let r = rand() * total;
		let i = 0;
		while (i < n - 1 && (r -= d2[i]) > 0) i++;
		centres.push(pick(i));
	}
	const owner = new Int32Array(n);
	for (let iter = 0; iter < 24; iter++) {
		const sums = centres.map(() => [0, 0, 0, 0]);
		for (let i = 0; i < n; i++) {
			let best = 0;
			for (let c = 1; c < k; c++) if (dist(i, centres[c]) < dist(i, centres[best])) best = c;
			owner[i] = best;
			const s = sums[best];
			s[0] += points[i * 3];
			s[1] += points[i * 3 + 1];
			s[2] += points[i * 3 + 2];
			s[3]++;
		}
		sums.forEach((s, c) => s[3] && (centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
	}
	const counts = new Array(k).fill(0);
	for (let i = 0; i < n; i++) counts[owner[i]]++;
	return centres
		.map((c, i) => ({ hex: oklabToHex(c), share: round(counts[i] / n, 3) }))
		.filter((c) => c.share > 0)
		.sort((a, b) => b.share - a.share);
}

const round = (v, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

async function spectrum(file) {
	const { data, info } = await sharp(file)
		.resize({ width: SAMPLE_W, withoutEnlargement: false })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const n = info.width * info.height;
	const bins = new Float64Array(BINS);
	const points = new Float64Array(n * 3);
	let neutral = 0;
	let lightness = 0;
	let chroma = 0;
	for (let i = 0, o = 0; i < n; i++, o += info.channels) {
		const [L, a, b] = oklab(LUT[data[o]], LUT[data[o + 1]], LUT[data[o + 2]]);
		points.set([L, a, b], i * 3);
		lightness += L;
		const C = Math.hypot(a, b);
		chroma += C;
		if (C < NEUTRAL_C) {
			neutral++;
			continue;
		}
		const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
		// Split each pixel between its two nearest bins so the lines don't alias.
		const x = h / (360 / BINS) - 0.5;
		const lo = Math.floor(x);
		const t = x - lo;
		bins[(lo + BINS) % BINS] += C * (1 - t);
		bins[(lo + 1) % BINS] += C * t;
	}
	const peak = Math.max(...bins) || 1;
	return {
		bins: Array.from(bins, (v) => round(v / peak, 3)),
		chroma: round(chroma / n, 4),
		neutral: round(neutral / n, 3),
		lightness: round(lightness / n, 3),
		palette: palette(points, 5),
	};
}

/* ── GitHub ─────────────────────────────────────────────────────────── */

const REPO = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/;

async function gh(url) {
	const res = await fetch(url, {
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': 'timothy-navarro-portfolio',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
	return { body: await res.json(), link: res.headers.get('link') ?? '' };
}

async function github(owner, name) {
	const base = `https://api.github.com/repos/${owner}/${name}`;
	const [{ body: repo }, { body: languages }] = await Promise.all([gh(base), gh(`${base}/languages`)]);
	const commits = [];
	for (let url = `${base}/commits?per_page=100`; url; ) {
		const { body, link } = await gh(url);
		commits.push(...body.map((c) => c.commit.author?.date ?? c.commit.committer?.date).filter(Boolean));
		url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
	}
	commits.sort();
	return {
		repo: repo.full_name,
		createdAt: repo.created_at,
		pushedAt: repo.pushed_at,
		stars: repo.stargazers_count,
		forks: repo.forks_count,
		homepage: repo.homepage || undefined,
		languages,
		commits,
	};
}

/* ── Main ───────────────────────────────────────────────────────────── */

async function main() {
	let previous = {};
	try {
		previous = JSON.parse(await readFile(OUT, 'utf-8')).projects ?? {};
	} catch {
		/* first run */
	}

	const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md')).sort();
	const projects = {};
	for (const file of files) {
		const source = await readFile(path.join(CONTENT_DIR, file), 'utf-8');
		const front = parseYaml(source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
		// Collection ids are the lower-cased file names.
		const id = path.basename(file, '.md').toLowerCase();
		const entry = { spectrum: await spectrum(path.resolve(CONTENT_DIR, front.img)) };

		const repo = String(front.link ?? '').match(REPO);
		if (repo) {
			if (offline) {
				if (previous[id]?.github) entry.github = previous[id].github;
			} else {
				try {
					entry.github = await github(repo[1], repo[2]);
				} catch (err) {
					console.warn(`  ! ${id}: ${err.message} — keeping the last snapshot`);
					if (previous[id]?.github) entry.github = previous[id].github;
				}
			}
		}
		projects[id] = entry;
		const gh = entry.github ? `, ${entry.github.commits.length} commits` : '';
		console.log(`  ${id}: spectrum${gh}`);
	}

	await writeFile(OUT, `${JSON.stringify({ syncedAt: new Date().toISOString(), projects }, null, '\t')}\n`);
	console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
