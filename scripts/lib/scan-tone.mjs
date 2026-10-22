/**
 * Measures a scan's tonality — what the film desk's Negative view works back
 * from (src/components/film/negative.ts). Fetches a small PNG of the scan from
 * the CDN, decodes it, and returns its black point, log-average ("key") and
 * white point as sRGB-encoded luminance, 0–1 to two decimals.
 */

import { inflateSync } from 'node:zlib';

const SIZE = 160;

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const round2 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

/** [black, key, white] for one scan, by its CDN path (e.g. `film/<roll>/<scan>`). */
export async function scanTone(cdn, remotePath) {
	const res = await fetch(`${cdn}/${encodePath(remotePath)}?width=${SIZE}&format=png`);
	if (!res.ok) throw new Error(`${res.status} for ${remotePath}`);
	const { width, height, channels, pixels } = decodePng(new Uint8Array(await res.arrayBuffer()));

	const lum = new Float64Array(width * height);
	const lut = Array.from({ length: 256 }, (_, v) => toLinear(v / 255));
	for (let i = 0, o = 0; i < lum.length; i++, o += channels) {
		lum[i] = 0.2126 * lut[pixels[o]] + 0.7152 * lut[pixels[o + 1]] + 0.0722 * lut[pixels[o + 2]];
	}
	let logSum = 0;
	for (const y of lum) logSum += Math.log(y + 1e-4);
	const sorted = Float64Array.from(lum).sort();
	const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

	// 0.5% / 99.5%: past dust specks and the odd blown specular, not the subject.
	return [at(0.005), Math.exp(logSum / lum.length), at(0.995)].map((y) => round2(toSrgb(y)));
}

/** Minimal 8-bit, non-interlaced PNG decoder (all the CDN's optimizer emits). */
function decodePng(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let width = 0;
	let height = 0;
	let channels = 0;
	const idat = [];
	for (let at = 8; at < bytes.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		const data = bytes.subarray(at + 8, at + 8 + length);
		if (type === 'IHDR') {
			width = view.getUint32(at + 8);
			height = view.getUint32(at + 12);
			const [depth, color, , , interlace] = data.subarray(8);
			channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
			if (depth !== 8 || !channels || interlace) throw new Error('Unsupported PNG layout');
		} else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		at += 12 + length;
	}

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const out = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = y * stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? out[row + x - channels] : 0;
			const b = y ? out[row - stride + x] : 0;
			const c = x >= channels && y ? out[row - stride + x - channels] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[row + x] = v & 0xff;
		}
	}
	// Gray(+alpha) → read as RGB by repeating the gray sample.
	if (channels < 3) {
		const rgb = new Uint8Array(width * height * 3);
		for (let i = 0; i < width * height; i++) rgb.fill(out[i * channels], i * 3, i * 3 + 3);
		return { width, height, channels: 3, pixels: rgb };
	}
	return { width, height, channels, pixels: out };
}
