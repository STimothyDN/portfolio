/**
 * Search across frames: "f/1.7 portra", "peru", "1/500 flash", "thin",
 * "october", "r-021". Settings, flags and dates are read as such; every
 * other word must appear somewhere on the frame (stock, camera, lens, roll
 * title, note or code). Everything in a query must match.
 */

export interface FrameQuery {
	aperture?: number;
	shutter?: string;
	flash?: boolean;
	noted?: boolean;
	scanned?: boolean;
	thin?: boolean;
	located?: boolean;
	/** 'YYYY-MM', 'YYYY' or '-MM' (a month in any year). */
	when?: string;
	code?: string;
	words: string[];
}

export interface SearchableFrame {
	code: string;
	title: string | null;
	stock: string;
	camera: string | null;
	lens: string | null;
	note: string | null;
	aperture: number | null;
	shutter: string | null;
	flash: boolean;
	lat: number | null;
	shotAt: number;
	tzOffset: number;
	scan: unknown;
	thin: boolean;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function parseQuery(q: string): FrameQuery {
	const out: FrameQuery = { words: [] };
	for (const raw of q.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
		let m: RegExpMatchArray | null;
		if ((m = raw.match(/^f\/?(\d+(?:\.\d+)?)$/))) out.aperture = Number(m[1]);
		else if ((m = raw.match(/^1\/(\d+)s?$/))) out.shutter = `1/${m[1]}`;
		else if ((m = raw.match(/^(\d+)s$/))) out.shutter = `${m[1]}s`;
		else if (raw === 'flash') out.flash = true;
		else if (raw === 'noted' || raw === 'notes' || raw === 'note') out.noted = true;
		else if (raw === 'scanned' || raw === 'scans' || raw === 'scan') out.scanned = true;
		else if (raw === 'thin' || raw === 'underexposed') out.thin = true;
		else if (raw === 'mapped' || raw === 'located') out.located = true;
		else if ((m = raw.match(/^r-?(\d+)$/))) out.code = `R-${m[1].padStart(3, '0')}`;
		else if ((m = raw.match(/^(\d{4})-(\d{2})$/))) out.when = `${m[1]}-${m[2]}`;
		else if ((m = raw.match(/^(20\d{2})$/))) out.when = m[1];
		else if (raw.length >= 3 && MONTHS.some((name) => name.startsWith(raw))) out.when = `-${String(MONTHS.findIndex((name) => name.startsWith(raw)) + 1).padStart(2, '0')}`;
		else out.words.push(raw);
	}
	return out;
}

export const isEmpty = (q: FrameQuery) => Object.keys(q).length === 1 && !q.words.length;

/** The frame's local 'YYYY-MM' (or '' when it has no time). */
const monthOf = (f: Pick<SearchableFrame, 'shotAt' | 'tzOffset'>) => (f.shotAt ? new Date(f.shotAt + f.tzOffset * 60_000).toISOString().slice(0, 7) : '');

export function matches(f: SearchableFrame, q: FrameQuery): boolean {
	if (q.aperture != null && (f.aperture == null || Math.abs(f.aperture - q.aperture) > 0.05)) return false;
	if (q.shutter && f.shutter !== q.shutter) return false;
	if (q.flash && !f.flash) return false;
	if (q.noted && !f.note) return false;
	if (q.scanned && !f.scan) return false;
	if (q.thin && !f.thin) return false;
	if (q.located && f.lat == null) return false;
	if (q.code && f.code !== q.code) return false;
	if (q.when) {
		const m = monthOf(f);
		if (!m) return false;
		if (q.when.startsWith('-') ? !m.endsWith(q.when) : !m.startsWith(q.when)) return false;
	}
	if (q.words.length) {
		const hay = squash([f.code, f.title, f.stock, f.camera, f.lens, f.note].filter(Boolean).join(' '));
		if (!q.words.every((w) => hay.includes(squash(w)))) return false;
	}
	return true;
}

/** The query read back as chips: "f/1.7", "1/500", "October", "“peru”". */
export function describe(q: FrameQuery): string[] {
	const out: string[] = [];
	if (q.aperture != null) out.push(`f/${q.aperture}`);
	if (q.shutter) out.push(q.shutter);
	if (q.flash) out.push('flash');
	if (q.noted) out.push('with a note');
	if (q.scanned) out.push('with a scan');
	if (q.thin) out.push('came back thin');
	if (q.located) out.push('on the map');
	if (q.code) out.push(q.code);
	if (q.when) {
		const [y, m] = q.when.startsWith('-') ? ['', q.when.slice(1)] : q.when.split('-');
		const month = m ? MONTHS[Number(m) - 1] : '';
		out.push([month ? month[0].toUpperCase() + month.slice(1) : '', y].filter(Boolean).join(' '));
	}
	for (const w of q.words) out.push(`“${w}”`);
	return out;
}
