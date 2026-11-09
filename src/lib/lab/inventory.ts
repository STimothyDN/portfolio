/**
 * Film Lab inventory: shapes and helpers shared by the server pages and the
 * browser islands (nothing here touches the database).
 */

export const STAGES = ['storage', 'camera', 'shot', 'lab', 'scanned', 'negatives'] as const;
export type Stage = (typeof STAGES)[number];
export type RollStatus = Stage | 'lost';

export const STATUS_LABEL: Record<RollStatus, string> = {
	storage: 'In storage',
	camera: 'In camera',
	shot: 'Shot',
	lab: 'At the lab',
	scanned: 'Scans in',
	negatives: 'Negatives home',
	lost: 'Lost or ruined',
};

/** What moving a roll into each stage is called on its button. */
export const STEP_VERB: Record<RollStatus, string> = {
	storage: 'Back to storage',
	camera: 'Load into a camera',
	shot: 'Mark roll finished',
	lab: 'Sent to a lab',
	scanned: 'Scans arrived',
	negatives: 'Negatives home',
	lost: 'Mark lost or ruined',
};

export const nextStage = (status: RollStatus): Stage | null => {
	if (status === 'lost') return null;
	const i = STAGES.indexOf(status);
	return STAGES[i + 1] ?? null;
};

export const PROCESSES = ['C-41', 'B&W', 'E-6', 'ECN-2'] as const;
export const FORMATS = ['35mm', '120', '110', 'Instant', 'Other'] as const;
export const CAMERA_KINDS: Record<string, string> = {
	slr: 'SLR',
	rangefinder: 'Rangefinder',
	'point-and-shoot': 'Point-and-shoot',
	tlr: 'TLR',
	'medium-format': 'Medium format',
	other: 'Other',
};
export const GEAR_STATUS: Record<string, string> = {
	active: 'In rotation',
	shelf: 'On the shelf',
	repair: 'Needs repair',
	gone: 'Sold or gifted',
	wishlist: 'Wishlist',
};
export const SERVICE_KINDS: Record<string, string> = {
	battery: 'New battery',
	seals: 'Light seals',
	cla: 'CLA',
	repair: 'Repair',
	clean: 'Cleaned',
	other: 'Other',
};

export interface StockView {
	id: string;
	token: string | null;
	brand: string;
	name: string;
	iso: number | null;
	process: string;
	format: string;
	exposures: number;
	wishlist: boolean;
	notes: string | null;
}

export interface CameraView {
	id: string;
	token: string | null;
	brand: string;
	name: string;
	kind: string;
	format: string;
	mount: string | null;
	fixedLens: string | null;
	battery: string | null;
	batteryChangedOn: string | null;
	serial: string | null;
	acquiredOn: string | null;
	priceCents: number | null;
	acquiredFrom: string | null;
	status: string;
	notes: string | null;
}

export interface LensView {
	id: string;
	brand: string;
	name: string;
	mount: string;
	focalMin: number | null;
	focalMax: number | null;
	maxAperture: number | null;
	serial: string | null;
	acquiredOn: string | null;
	priceCents: number | null;
	acquiredFrom: string | null;
	status: string;
	notes: string | null;
}

export interface LabView {
	id: string;
	token: string | null;
	name: string;
	location: string | null;
	url: string | null;
	costCents: number | null;
	notes: string | null;
}

export interface RollView {
	id: string;
	code: string;
	title: string | null;
	status: RollStatus;
	statusOn: string;
	exposures: number;
	stock: Pick<StockView, 'id' | 'token' | 'brand' | 'name' | 'iso' | 'process' | 'format'>;
	camera: { id: string; name: string } | null;
	lab: { id: string; name: string } | null;
	shotAtIso: number | null;
	expires: string | null;
	purchasedOn: string | null;
	priceCents: number | null;
	purchasedFrom: string | null;
	storageSpot: string | null;
	labOrder: string | null;
	devCostCents: number | null;
	devNotes: string | null;
	negativesAt: string | null;
	publicRollId: string | null;
	notes: string | null;
	rewoundAtFrame: number | null;
	/** Frames logged so far. */
	frameCount: number;
	/** Public film desk sharing (off until switched on). */
	shareExposure: boolean;
	sharePlace: string | null;
	shareNotes: boolean;
	/** Frame number of the lab's first scan. */
	firstScanFrame: number;
}

export interface FrameView {
	id: string;
	clientId: string;
	rollId: string;
	number: number;
	/** Epoch ms. */
	shotAt: number;
	/** Minutes east of UTC where it was taken. */
	tzOffset: number;
	cameraId: string | null;
	lensId: string | null;
	focalLength: number | null;
	aperture: number | null;
	shutter: string | null;
	flash: boolean;
	lat: number | null;
	lng: number | null;
	accuracy: number | null;
	note: string | null;
	/** Pinned to this scan, overriding the roll's alignment. */
	scanFilename: string | null;
}

/** What the phone sends: a frame by its client id, or its removal. (Scan pins are set separately.) */
export type FrameInput = Omit<FrameView, 'id' | 'scanFilename'> & { deleted?: boolean };

/* ---------- exposure ---------- */

/** Full stops plus the common widest apertures of real lenses. */
export const APERTURES = [1, 1.2, 1.4, 1.7, 1.8, 2, 2.8, 3.5, 4, 4.5, 5.6, 8, 11, 16, 22, 32];
export const SHUTTERS = ['B', '1s', '1/2', '1/4', '1/8', '1/15', '1/30', '1/60', '1/125', '1/250', '1/500', '1/1000', '1/2000', '1/4000'];

/** The apertures a lens can set: from its widest (f/1.7) to f/22. */
export function aperturesFor(widest: number | null | undefined): number[] {
	const full = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
	if (!widest) return full;
	return [widest, ...full.filter((a) => a > widest + 0.05)];
}

/** "35mm f/2.8" → 2.8 */
export function widestFromText(text: string | null | undefined): number | null {
	const m = text?.match(/f\/?\s*(\d+(?:\.\d+)?)/i);
	return m ? Number(m[1]) : null;
}

export const formatAperture = (a: number | null) => (a == null ? null : `f/${Number.isInteger(a) ? a : a.toFixed(1).replace(/\.0$/, '')}`);

/** "f/8 · 1/125", "auto", with flash noted. */
export function formatExposure(f: Pick<FrameView, 'aperture' | 'shutter' | 'flash'>): string {
	const parts = [formatAperture(f.aperture), f.shutter].filter(Boolean) as string[];
	const exp = parts.length ? parts.join(' · ') : 'auto';
	return f.flash ? `${exp} · flash` : exp;
}

/** The wall-clock time a frame was taken, where it was taken ("2:41 pm"). Same on server and phone. */
export function frameTime(f: Pick<FrameView, 'shotAt' | 'tzOffset'>, withDate = false): string {
	// Frames added afterwards, without a time, are stored at 0.
	if (!f.shotAt) return '—';
	const d = new Date(f.shotAt + f.tzOffset * 60_000);
	const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).toLowerCase();
	if (!withDate) return time;
	return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${time}`;
}

/** Round a coordinate to about 100 m: rough location, as asked. */
export const roughCoord = (v: number) => Math.round(v * 1000) / 1000;

/** The next frame to shoot: after the highest logged, or past the rewind point on a reloaded roll. */
export function nextFrameNumber(frames: Pick<FrameView, 'number'>[], rewoundAtFrame: number | null): number {
	const top = frames.reduce((m, f) => Math.max(m, f.number), 0);
	// Reloading a rewound roll: wind on past the last frame plus one spare.
	if (rewoundAtFrame && top <= rewoundAtFrame) return rewoundAtFrame + 2;
	return top + 1;
}

export interface RollEventView {
	id: string;
	status: RollStatus;
	on: string;
	note: string | null;
}

/** Everything a step form may need to pick from. */
export interface StepChoices {
	cameras: Pick<CameraView, 'id' | 'name' | 'format' | 'status'>[];
	labs: Pick<LabView, 'id' | 'name' | 'costCents'>[];
	/** Desk rolls not yet linked to a logbook roll, best matches first per roll (computed client-side). */
	deskRolls: DeskRollOption[];
}

export interface DeskRollOption {
	id: string;
	title: string;
	developed: string;
	camera: string;
	stock: string;
	lab: string;
	count: number;
}

/* ---------- formatting ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Oct 23, 2026' (no Date objects, so no timezone shifts). */
export function formatDay(day: string | null | undefined, withYear = true): string {
	if (!day) return '';
	const [y, m, d] = day.split('-').map(Number);
	if (!y || !m || !d) return day;
	return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

/** 'YYYY-MM' → '06/28', as printed on film boxes. */
export const formatExpiry = (ym: string | null | undefined) => (ym ? `${ym.slice(5, 7)}/${ym.slice(2, 4)}` : '');

export const formatMoney = (cents: number | null | undefined) =>
	cents == null ? '' : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

export const toCents = (dollars: string | number | null | undefined): number | null => {
	if (dollars === '' || dollars == null) return null;
	const n = typeof dollars === 'number' ? dollars : Number(String(dollars).replace(/[$,\s]/g, ''));
	return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const dayNumber = (day: string) => {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, m - 1, d) / 864e5;
};

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
export const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));

export function formatDays(days: number): string {
	if (days <= 0) return 'today';
	if (days === 1) return '1 day';
	if (days < 60) return `${days} days`;
	return `${Math.round(days / 30.4)} months`;
}

/** Today in Durham, as 'YYYY-MM-DD'. The server passes it to islands so both renders agree. */
export const todayInDurham = (now = new Date()) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

/**
 * How far past its date a roll is, and the usual rule of thumb for it:
 * about one stop of extra exposure per decade (cold-stored film needs less).
 */
export function expiryNote(expires: string | null, today: string): { expired: boolean; soon: boolean; text: string } | null {
	if (!expires) return null;
	const [ey, em] = expires.split('-').map(Number);
	const [ty, tm] = today.split('-').map(Number);
	const monthsPast = (ty - ey) * 12 + (tm - em);
	if (monthsPast > 0) {
		const years = monthsPast / 12;
		const stops = Math.max(1, Math.round(years / 10));
		return {
			expired: true,
			soon: false,
			text: years >= 2 ? `expired ${ey} · shoot about +${stops} stop${stops > 1 ? 's' : ''}` : `expired ${formatExpiry(expires)}`,
		};
	}
	return { expired: false, soon: monthsPast > -4, text: `exp ${formatExpiry(expires)}` };
}

/** "push +1", "pull −1" or null, from the speed it was shot at against the box speed. */
export function pushPull(boxIso: number | null, shotAt: number | null): string | null {
	if (!boxIso || !shotAt || boxIso === shotAt) return null;
	const stops = Math.log2(shotAt / boxIso);
	const rounded = Math.round(stops * 3) / 3;
	const label = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1).replace(/\.0$/, '');
	return stops > 0 ? `push +${label}` : `pull −${label}`;
}

/** The next R-### code after the highest one in use. */
export function nextCode(codes: string[], offset = 0): string {
	const max = codes.reduce((m, c) => Math.max(m, Number(c.replace(/\D/g, '')) || 0), 0);
	return `R-${String(max + 1 + offset).padStart(3, '0')}`;
}
