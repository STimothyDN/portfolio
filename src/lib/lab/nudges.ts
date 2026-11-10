/**
 * The bench's "Today" card: the few things worth doing next, ranked, each
 * with one button. Pure, from the bench's data, so the server render and the
 * island agree (and it's testable).
 */
import { daysBetween, expiryNote, formatExpiry, type RollStatus, type RollView } from './inventory';
import { daysHere } from './stats/pipeline';
import { returnWindow } from './stats/labs';
import type { Spread } from './stats/pipeline';
import type { StockForecast } from './pace';

export type NudgeAction =
	| { kind: 'step'; rollId: string; to: RollStatus }
	| { kind: 'load'; rollId?: string }
	| { kind: 'send'; rollId?: string }
	| { kind: 'href'; href: string };

export interface Nudge {
	key: string;
	tone: 'warn' | 'info' | 'good';
	/** One short sentence, with the roll code first where there is one. */
	text: string;
	label: string;
	action: NudgeAction;
	score: number;
	rollId?: string;
}

export interface NudgeInput {
	rolls: RollView[];
	today: string;
	turnaround: Record<string, Spread>;
	forecast: { byStock: Record<string, StockForecast>; monthsOfFilm: number | null };
	/** Owner only: scans can be linked from the film desk. */
	canLink: boolean;
	passkeys: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function nudges(input: NudgeInput, limit = 3): Nudge[] {
	const { rolls, today } = input;
	const out: Nudge[] = [];
	const by = (s: RollStatus) => rolls.filter((r) => r.status === s);

	// Shot and waiting: the longer, the louder.
	const waiting = by('shot').sort((a, b) => a.statusOn.localeCompare(b.statusOn));
	if (waiting.length) {
		const oldest = waiting[0];
		const days = daysHere(oldest, today);
		if (days >= 5 || waiting.length >= 3) {
			out.push({
				key: `send-${oldest.id}`,
				tone: days >= 14 ? 'warn' : 'info',
				text: waiting.length > 1 ? `${plural(waiting.length, 'roll')} waiting to go to a lab, the oldest ${plural(days, 'day')}.` : `${oldest.code} has waited ${plural(days, 'day')} to go to a lab.`,
				label: waiting.length > 1 ? 'Send a batch' : 'Send it',
				action: { kind: 'send', rollId: oldest.id },
				score: 40 + days * 2 + waiting.length * 4,
				rollId: oldest.id,
			});
		}
	}

	// At the lab: past the usual, or back any day now.
	for (const r of by('lab')) {
		const w = r.lab ? returnWindow(r.statusOn, input.turnaround[r.lab.id], today) : null;
		if (!w) continue;
		if (w.late || w.day > w.usual + 2) {
			out.push({
				key: `late-${r.id}`,
				tone: 'warn',
				text: `${r.code} has been at ${r.lab!.name} ${plural(w.day, 'day')}; it usually takes ${w.usual}.`,
				label: 'Scans arrived?',
				action: { kind: 'step', rollId: r.id, to: 'scanned' },
				score: 50 + (w.day - w.usual) * 3,
				rollId: r.id,
			});
		} else if (today >= w.from && today <= w.to) {
			out.push({
				key: `due-${r.id}`,
				tone: 'info',
				text: `${r.code}’s scans are due from ${r.lab!.name} (${w.text}).`,
				label: 'They’re in',
				action: { kind: 'step', rollId: r.id, to: 'scanned' },
				score: 30,
				rollId: r.id,
			});
		}
	}

	// Scans in: link them to the desk, or file the negatives.
	for (const r of by('scanned')) {
		const days = daysHere(r, today);
		if (input.canLink && !r.publicRollId) {
			out.push({ key: `link-${r.id}`, tone: 'info', text: `${r.code}’s scans aren’t linked to the film desk yet.`, label: 'Link scans', action: { kind: 'href', href: `/photography/lab/rolls/${r.code}/#scans` }, score: 26 + Math.min(days, 20), rollId: r.id });
		} else if (days >= 7 && r.labDelivery !== 'mail') {
			out.push({ key: `file-${r.id}`, tone: 'info', text: `${r.code}’s negatives are ready to pick up and file (${plural(days, 'day')}).`, label: 'Filed them', action: { kind: 'step', rollId: r.id, to: 'negatives' }, score: 20 + days, rollId: r.id });
		}
	}

	// In a camera: nearly done, or there a long time.
	for (const r of by('camera')) {
		const left = r.exposures - r.frameCount;
		const days = daysHere(r, today);
		if (r.frameCount > 0 && left <= 2) {
			out.push({ key: `finish-${r.id}`, tone: 'good', text: `${r.code} in the ${r.camera?.name ?? 'camera'} is on its last frames.`, label: 'Roll finished', action: { kind: 'step', rollId: r.id, to: 'shot' }, score: 35, rollId: r.id });
		} else if (days >= 60) {
			out.push({ key: `stale-${r.id}`, tone: 'info', text: `${r.code} has been in the ${r.camera?.name ?? 'camera'} ${Math.round(days / 30.4)} months.`, label: 'Shoot it', action: { kind: 'href', href: `/photography/lab/shoot/?roll=${r.code}` }, score: 15 + days / 10, rollId: r.id });
		}
	}

	// The fridge: film that won't keep, or nothing to load.
	const storage = by('storage');
	const late = storage
		.filter((r) => input.forecast.byStock[r.stock.id]?.late.includes(r.id) || expiryNote(r.expires, today)?.soon)
		.filter((r) => !expiryNote(r.expires, today)?.expired)
		.sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? ''));
	if (late[0]) {
		const r = late[0];
		out.push({ key: `expiry-${r.id}`, tone: 'warn', text: `${r.stock.name} (${r.code}) expires ${formatExpiry(r.expires)}, before you’d reach it.`, label: 'Load it next', action: { kind: 'load', rollId: r.id }, score: 28, rollId: r.id });
	}
	if (!by('camera').length && storage.length) {
		out.push({ key: 'nothing-loaded', tone: 'info', text: 'No camera has film in it.', label: 'Load a roll', action: { kind: 'load' }, score: 24 });
	}
	if (input.forecast.monthsOfFilm != null && input.forecast.monthsOfFilm < 1 && storage.length < 3) {
		out.push({ key: 'restock', tone: 'info', text: `About ${plural(storage.length, 'roll')} left in the fridge at the rate you shoot.`, label: 'Open the fridge', action: { kind: 'href', href: '/photography/lab/fridge/' }, score: 18 });
	}
	if (input.passkeys < 2) {
		out.push({ key: 'passkey', tone: 'info', text: input.passkeys ? 'Only one passkey: add one from your other device.' : 'No passkey yet.', label: 'Passkeys', action: { kind: 'href', href: '/photography/lab/account/' }, score: 10 });
	}

	return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Days until (negative: since) a 'YYYY-MM-DD'. */
export const daysUntil = (day: string, today: string) => daysBetween(today, day);
