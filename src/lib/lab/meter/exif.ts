/**
 * The exposure a phone (or any camera) wrote into a JPEG: shutter time,
 * aperture, ISO, its own brightness reading, and the lens's focal length.
 * A small reader for the EXIF block in the APP1 segment (TIFF inside), with
 * no dependency: only the handful of tags the meter needs, every offset
 * bounds-checked, and null for anything that isn't a readable JPEG.
 */

export interface PhotoExif {
	/** Seconds. */
	exposureTime: number | null;
	fNumber: number | null;
	iso: number | null;
	/** APEX brightness value (Bv): the camera's own reading of the scene. */
	brightness: number | null;
	/** Exposure compensation dialled in when it was taken, stops. */
	bias: number | null;
	/** Real focal length, mm. */
	focal: number | null;
	/** The same as a 35mm-film focal length (how wide the phone saw). */
	focal35: number | null;
	make: string | null;
	model: string | null;
}

const TAG = {
	make: 0x010f,
	model: 0x0110,
	exifIfd: 0x8769,
	exposureTime: 0x829a,
	fNumber: 0x829d,
	iso: 0x8827,
	shutterApex: 0x9201,
	apertureApex: 0x9202,
	brightness: 0x9203,
	bias: 0x9204,
	focal: 0x920a,
	focal35: 0xa405,
} as const;

/** Bytes per component, by TIFF type. */
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

type Entry = { type: number; count: number; at: number };

/** EXIF from the start of a JPEG (the first 128 KB is plenty), or null. */
export function readExif(buffer: ArrayBuffer): PhotoExif | null {
	try {
		const tiff = findTiff(new DataView(buffer));
		return tiff ? parseTiff(new DataView(buffer, tiff.start, tiff.length)) : null;
	} catch {
		return null;
	}
}

/** Where the TIFF block of the Exif APP1 segment sits in a JPEG. */
function findTiff(v: DataView): { start: number; length: number } | null {
	if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
	let i = 2;
	while (i + 4 <= v.byteLength) {
		if (v.getUint8(i) !== 0xff) return null;
		const marker = v.getUint8(i + 1);
		if (marker === 0xff) {
			i++; // fill byte
			continue;
		}
		if (marker === 0xda || marker === 0xd9) return null; // image data: no EXIF before it
		const length = v.getUint16(i + 2);
		if (length < 2) return null;
		// "Exif\0\0"
		if (marker === 0xe1 && i + 10 <= v.byteLength && v.getUint32(i + 4) === 0x45786966 && v.getUint16(i + 8) === 0) {
			const start = i + 10;
			return { start, length: Math.min(length - 8, v.byteLength - start) };
		}
		i += 2 + length;
	}
	return null;
}

function parseTiff(v: DataView): PhotoExif | null {
	if (v.byteLength < 8) return null;
	const order = v.getUint16(0);
	if (order !== 0x4949 && order !== 0x4d4d) return null;
	const le = order === 0x4949;
	if (v.getUint16(2, le) !== 42) return null;

	const ifd0 = readIfd(v, v.getUint32(4, le), le);
	const exifAt = ifd0.get(TAG.exifIfd);
	const exif = exifAt ? readIfd(v, uint(v, exifAt, le), le) : new Map<number, Entry>();
	const num = (tag: number) => {
		const e = exif.get(tag) ?? ifd0.get(tag);
		return e ? value(v, e, le) : null;
	};

	let exposureTime = num(TAG.exposureTime);
	let fNumber = num(TAG.fNumber);
	// APEX fallbacks: Tv = −log2(t), Av = 2·log2(N).
	const tv = num(TAG.shutterApex);
	const av = num(TAG.apertureApex);
	if (!(exposureTime && exposureTime > 0) && tv != null) exposureTime = 2 ** -tv;
	if (!(fNumber && fNumber > 0) && av != null) fNumber = Math.sqrt(2 ** av);
	const pos = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

	const out: PhotoExif = {
		exposureTime: pos(exposureTime),
		fNumber: pos(fNumber),
		iso: pos(num(TAG.iso)),
		brightness: finite(num(TAG.brightness)),
		bias: finite(num(TAG.bias)),
		focal: pos(num(TAG.focal)),
		focal35: pos(num(TAG.focal35)),
		make: text(v, ifd0.get(TAG.make)),
		model: text(v, ifd0.get(TAG.model)),
	};
	return Object.values(out).some((x) => x != null) ? out : null;
}

const finite = (n: number | null) => (n != null && Number.isFinite(n) ? n : null);

function readIfd(v: DataView, at: number, le: boolean): Map<number, Entry> {
	const out = new Map<number, Entry>();
	if (at + 2 > v.byteLength) return out;
	const n = v.getUint16(at, le);
	for (let k = 0; k < n; k++) {
		const e = at + 2 + k * 12;
		if (e + 12 > v.byteLength) break;
		const type = v.getUint16(e + 2, le);
		const count = v.getUint32(e + 4, le);
		const size = (SIZE[type] ?? 0) * count;
		if (!size) continue;
		// Four bytes or fewer sit in the entry itself; more, at an offset into the TIFF.
		const dataAt = size <= 4 ? e + 8 : v.getUint32(e + 8, le);
		if (dataAt + size > v.byteLength) continue;
		out.set(v.getUint16(e, le), { type, count, at: dataAt });
	}
	return out;
}

/** The first component as a number (rationals divided out). */
function value(v: DataView, e: Entry, le: boolean): number | null {
	switch (e.type) {
		case 1:
		case 7:
			return v.getUint8(e.at);
		case 3:
			return v.getUint16(e.at, le);
		case 4:
			return v.getUint32(e.at, le);
		case 9:
			return v.getInt32(e.at, le);
		case 5: {
			const d = v.getUint32(e.at + 4, le);
			return d ? v.getUint32(e.at, le) / d : null;
		}
		case 10: {
			const d = v.getInt32(e.at + 4, le);
			return d ? v.getInt32(e.at, le) / d : null;
		}
		default:
			return null;
	}
}

function uint(v: DataView, e: Entry, le: boolean): number {
	return e.type === 3 ? v.getUint16(e.at, le) : v.getUint32(e.at, le);
}

function text(v: DataView, e: Entry | undefined): string | null {
	if (!e || e.type !== 2) return null;
	let s = '';
	for (let k = 0; k < e.count; k++) {
		const c = v.getUint8(e.at + k);
		if (!c) break;
		s += String.fromCharCode(c);
	}
	return s.trim() || null;
}

/**
 * The exposure the camera actually gave, as EV at ISO 100, from its
 * settings; failing those, from its brightness reading (EV100 = Bv + 5,
 * less any compensation it was told to add). Null when neither is there
 * or the numbers are implausible.
 */
export function cameraEv100(x: PhotoExif | null): { ev: number; from: 'settings' | 'brightness' } | null {
	if (!x) return null;
	if (x.exposureTime && x.fNumber && x.iso) {
		const ev = Math.log2((x.fNumber * x.fNumber) / x.exposureTime) - Math.log2(x.iso / 100);
		if (ev > -10 && ev < 23) return { ev, from: 'settings' };
	}
	if (x.brightness != null) {
		const ev = x.brightness + 5 - (x.bias ?? 0);
		if (ev > -10 && ev < 23) return { ev, from: 'brightness' };
	}
	return null;
}
