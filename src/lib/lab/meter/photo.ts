/**
 * Reading a photo on the phone: its EXIF (from the first 256 KB) and a
 * small copy of its pixels for the meter. Nothing leaves the device; the
 * picture is shown from an object URL and forgotten when replaced.
 *
 * Decoding goes through an <img>, which applies the EXIF orientation the
 * same way the picture on screen does, so a tap lands where it looks.
 */
import { cameraEv100, readExif, type PhotoExif } from './exif';
import { lumaMap, type LumaMap } from './luma';

export interface Photo {
	/** Object URL for showing it. */
	url: string;
	/** As displayed (orientation applied). */
	w: number;
	h: number;
	map: LumaMap;
	exif: PhotoExif | null;
	camera: ReturnType<typeof cameraEv100>;
	at: number;
}

/** Long side of the copy the meter reads: plenty for spot and zones, quick on any phone. */
const SIDE = 320;

export async function readPhoto(file: File): Promise<Photo> {
	const exif = readExif(await file.slice(0, 256 * 1024).arrayBuffer());
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		const w = img.naturalWidth;
		const h = img.naturalHeight;
		if (!w || !h) throw new Error('empty');
		const scale = Math.min(1, SIDE / Math.max(w, h));
		const cw = Math.max(1, Math.round(w * scale));
		const ch = Math.max(1, Math.round(h * scale));
		const canvas = document.createElement('canvas');
		canvas.width = cw;
		canvas.height = ch;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new Error('no canvas');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, cw, ch);
		const map = lumaMap(ctx.getImageData(0, 0, cw, ch).data, cw, ch);
		return { url, w, h, map, exif, camera: cameraEv100(exif), at: Date.now() };
	} catch {
		URL.revokeObjectURL(url);
		throw new Error('That picture couldn’t be read here. Try taking it again, or pick a JPEG.');
	}
}
