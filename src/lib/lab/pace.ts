/**
 * Rates: how fast a loaded roll is going, and how fast the fridge empties.
 * Pure date arithmetic on 'YYYY-MM-DD' strings, shared by the light table,
 * the fridge and their islands.
 */
import { daysBetween, formatDay, type RollView } from './inventory';

/** 'YYYY-MM-DD' plus n days. */
export function addDays(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + Math.round(n))).toISOString().slice(0, 10);
}

/** The last day of a 'YYYY-MM' expiry month. */
const endOfMonth = (ym: string) => {
	const [y, m] = ym.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export interface Pace {
	/** "about 3 frames a day", "about 4 a week". */
	rate: string;
	/** "done around Nov 14", "last frames: time to rewind". */
	finish: string;
	/** When it's been in the camera a long time: a gentle nudge. */
	nudge: string | null;
}

/** A loaded roll's pace, from frames logged since it went in. Null until there's enough to go on. */
export function rollPace(r: Pick<RollView, 'frameCount' | 'exposures' | 'statusOn'>, today: string): Pace | null {
	const days = daysBetween(r.statusOn, today);
	if (r.frameCount < 3 || days < 1) return null;
	const perDay = r.frameCount / days;
	const left = r.exposures - r.frameCount;
	const rate = perDay >= 0.95 ? `about ${Math.round(perDay)} ${Math.round(perDay) === 1 ? 'frame' : 'frames'} a day` : perDay * 7 >= 0.95 ? `about ${Math.round(perDay * 7)} a week` : 'a few a month';
	const finishIn = left / perDay;
	const finish = left <= 0 ? 'last frames: time to rewind' : finishIn > 365 ? 'over a year to go at this pace' : `done around ${formatDay(addDays(today, finishIn), finishIn > 300)}`;
	const nudge = days >= 90 ? `In the camera ${Math.round(days / 30.4)} months: shoot it out soon, latent images fade slowly.` : null;
	return { rate, finish, nudge };
}

export interface StockForecast {
	/** Rolls of it loaded per month, recently. */
	perMonth: number;
	/** Rolls on hand. */
	onHand: number;
	/** How long they'll last at that rate, months (null if it isn't being used). */
	monthsLeft: number | null;
	/** Rolls (oldest expiry first) you won't get to before they expire, at that rate. */
	late: string[];
}

/**
 * How fast each stock leaves the fridge: rolls loaded over the last six
 * months (or since the first load, if sooner), against what's on hand.
 */
export function restockForecast(
	rolls: Pick<RollView, 'id' | 'status' | 'expires' | 'stock'>[],
	loadedOn: Record<string, string | undefined>,
	today: string
): { byStock: Record<string, StockForecast>; perMonth: number; monthsOfFilm: number | null } {
	const from = addDays(today, -182);
	const loads = rolls.filter((r) => {
		const d = loadedOn[r.id];
		return d && d >= from && d <= today;
	});
	const first = loads.map((r) => loadedOn[r.id]!).sort()[0];
	const windowDays = first ? Math.max(30, daysBetween(first, today)) : 182;
	const months = windowDays / 30.44;
	const byStock: Record<string, StockForecast> = {};
	const stocks = new Set(rolls.map((r) => r.stock.id));
	for (const id of stocks) {
		const used = loads.filter((r) => r.stock.id === id).length;
		const inFridge = rolls
			.filter((r) => r.stock.id === id && r.status === 'storage')
			.sort((a, b) => (a.expires ?? '9999').localeCompare(b.expires ?? '9999'));
		const perMonth = used / months;
		const late = perMonth
			? inFridge.filter((r, i) => r.expires && addDays(today, ((i + 0.5) / perMonth) * 30.44) > endOfMonth(r.expires)).map((r) => r.id)
			: [];
		byStock[id] = { perMonth: Math.round(perMonth * 10) / 10, onHand: inFridge.length, monthsLeft: perMonth ? Math.round((inFridge.length / perMonth) * 10) / 10 : null, late };
	}
	const perMonth = loads.length / months;
	const onHand = rolls.filter((r) => r.status === 'storage').length;
	return { byStock, perMonth: Math.round(perMonth * 10) / 10, monthsOfFilm: perMonth ? Math.round((onHand / perMonth) * 10) / 10 : null };
}

/** "6 weeks", "4 months", "a year and more". */
export function formatMonths(m: number): string {
	if (m < 1.5) return `${Math.max(1, Math.round(m * 4.35))} weeks`;
	if (m >= 12) return 'a year and more';
	return `${Math.round(m)} months`;
}
