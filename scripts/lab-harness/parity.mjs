// Compare the public static pages of two builds after normalizing hashes and random ids.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const [a, b] = process.argv.slice(2);
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []; });
const norm = (s) => s
	.replace(/icon-gradient-[\w-]+/g, 'G')
	.replace(/\buid="[^"]*"/g, 'uid')
	.replace(/\/_astro\/[^"'\s)?]+/g, '/_astro/X')
	.replace(/astro-[a-z0-9]{8}/g, 'astro-X')
	.replace(/data-astro-cid-[a-z0-9]+/g, 'cid')
	.replace(/data-astro-transition-scope="[^"]*"/g, 'scope')
	.replace(/<link rel="dns-prefetch" href="https:\/\/photo-port.b-cdn.net">/g, '')
	.replace(/https:\/\/photo-port.b-cdn.net/g, 'undefined')
	.replace(/<link rel="preconnect" href="undefined"( crossorigin)?>/g, '');
let diffs = 0, files = 0;
for (const f of walk(a)) {
	const rel = relative(a, f);
	if (rel.startsWith('lab') || rel.startsWith('photography/lab')) continue;
	files++;
	const other = join(b, rel);
	if (!existsSync(other)) { console.log('missing', rel); diffs++; continue; }
	if (norm(readFileSync(f, 'utf8')) !== norm(readFileSync(other, 'utf8'))) { console.log('differs', rel); diffs++; }
}
console.log(`${files} pages compared, ${diffs} differ`);
