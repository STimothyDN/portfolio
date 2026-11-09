/**
 * Rewind: a roll from the archive, developed about a year (or six months,
 * three months, a month) ago today, with a few of its best scans. For the
 * light table, so old work turns up while you plan new work.
 */
import { bunnyUrl } from '../../../utils/bunny';
import { getFilmRolls, rollFolder } from '../../../utils/film';
import { daysBetween, type RollView } from '../inventory';
import { addDays } from '../pace';

export interface Rewind {
	when: string;
	title: string;
	developed: string;
	/** The logbook roll it's linked to, if any. */
	code: string | null;
	count: number;
	scans: { src: string; w?: number; h?: number }[];
}

const WINDOWS = [
	{ days: 365, slack: 14, when: 'A year ago' },
	{ days: 182, slack: 10, when: 'Six months ago' },
	{ days: 91, slack: 10, when: 'Three months ago' },
	{ days: 30, slack: 5, when: 'A month ago' },
];

export async function rewind(rolls: Pick<RollView, 'code' | 'publicRollId'>[], today: string): Promise<Rewind | null> {
	const desk = await getFilmRolls();
	const codeOf = new Map(rolls.filter((r) => r.publicRollId).map((r) => [r.publicRollId!, r.code]));
	for (const w of WINDOWS) {
		const target = addDays(today, -w.days);
		const near = desk
			.map((r) => ({ r, off: Math.abs(daysBetween(r.data.developed.toISOString().slice(0, 10), target)) }))
			.filter((x) => x.off <= w.slack)
			.sort((a, b) => a.off - b.off)[0];
		if (!near) continue;
		const { r } = near;
		const best = [...r.data.photos]
			.map((p, i) => ({ p, i }))
			.sort((a, b) => b.p.priority - a.p.priority || a.i - b.i)
			.slice(0, 4)
			.sort((a, b) => a.i - b.i);
		return {
			when: w.when,
			title: r.data.title,
			developed: r.data.developed.toISOString().slice(0, 10),
			code: codeOf.get(r.id) ?? null,
			count: r.data.photos.length,
			scans: best.map(({ p }) => ({ src: bunnyUrl(`${rollFolder(r)}/${p.filename}`, { width: 420, format: 'webp', quality: 70 }), w: p.width, h: p.height })),
		};
	}
	return null;
}
