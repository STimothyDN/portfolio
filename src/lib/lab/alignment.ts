/**
 * Which logged frame each lab scan shows. Labs name scans their own way and
 * often scan a frame 0 or 00 first, so a roll records the frame number of its
 * first scan, and any frame can be pinned to a specific scan to close a gap
 * (a blank frame the lab skipped, say). Shared by the roll page, the build
 * that feeds the public lightbox, and the tests.
 */
import { formatAperture } from './inventory';

export interface AlignableFrame {
	number: number;
	scanFilename?: string | null;
}

/** scan filename → the frame it shows (scans in desk order). */
export function alignScans<F extends AlignableFrame>(scans: string[], frames: F[], firstScanFrame: number): Map<string, F> {
	const pinned = new Map<string, F>();
	const free = new Map<number, F>();
	for (const f of frames) {
		if (f.scanFilename) pinned.set(f.scanFilename, f);
		else if (!free.has(f.number)) free.set(f.number, f);
	}
	const out = new Map<string, F>();
	scans.forEach((file, i) => {
		const f = pinned.get(file) ?? free.get(firstScanFrame + i);
		if (f) out.set(file, f);
	});
	return out;
}

/** What the public lightbox gets for one frame. Short keys: it ships with every shared scan. */
export interface PublicExposure {
	/** "f/8" */
	a?: string;
	/** "1/125" */
	s?: string;
	/** lens name */
	l?: string;
	/** focal length, "50mm" */
	fl?: string;
	/** rated ISO */
	i?: number;
	/** the roll's public place */
	pl?: string;
	/** the frame's note, when notes are shared */
	nt?: string;
}

export interface ShareSettings {
	shareExposure: boolean;
	sharePlace: string | null;
	shareNotes: boolean;
	ratedIso: number | null;
}

/** A frame as the public may see it, under the roll's sharing settings. Null when there's nothing to show. */
export function publicExposure(
	f: { aperture: number | null; shutter: string | null; focalLength: number | null; note: string | null },
	lensName: string | null,
	share: ShareSettings
): PublicExposure | null {
	const e: PublicExposure = {};
	if (share.shareExposure) {
		if (f.aperture != null) e.a = formatAperture(f.aperture)!;
		if (f.shutter) e.s = f.shutter;
		if (lensName) e.l = lensName;
		if (f.focalLength) e.fl = `${f.focalLength}mm`;
		if (share.ratedIso) e.i = share.ratedIso;
	}
	if (share.sharePlace?.trim()) e.pl = share.sharePlace.trim();
	if (share.shareNotes && f.note?.trim()) e.nt = f.note.trim();
	return Object.keys(e).length ? e : null;
}

/** One line for previews: "f/8 · 1/125 · MD Rokkor 50mm · Durham, NC". */
export const exposureLine = (e: PublicExposure | null) =>
	e ? [e.a, e.s, e.l ?? e.fl, e.i ? `ISO ${e.i}` : null, e.pl].filter(Boolean).join(' · ') : '';
