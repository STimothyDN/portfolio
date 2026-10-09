import type { FilmRollData } from './types';

// Canister colors by film brand (read from the stock's display name), so a
// row of rolls reads like a real drawer of them. Unknown brands get a stable hue.
const BRANDS: [RegExp, string, string][] = [
	[/kodak|portra|ektar|gold|ultramax|colorplus|tri-?x/i, '#f2b705', '#2a1a05'],
	[/fuji|superia|velvia|provia/i, '#1d8a4c', '#f4f1e8'],
	[/lucky/i, '#c4262e', '#fbf3e6'],
	[/ilford|hp5|delta|fp4/i, '#ece9e2', '#151515'],
	[/cinestill/i, '#1b1b1d', '#e8392c'],
	[/lomo/i, '#2f5fb3', '#f4f1e8'],
];

/** Body color and label ink for a roll's film canister. */
export function canisterColors(roll: Pick<FilmRollData, 'stock' | 'stockLabel'>): { can: string; ink: string } {
	const brand = BRANDS.find(([re]) => re.test(roll.stockLabel));
	if (brand) return { can: brand[1], ink: brand[2] };
	const hue = [...roll.stock].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
	return { can: `oklch(58% 0.12 ${hue})`, ink: '#f7f4ee' };
}

/** Tokens carry their own leading space (if any), so rejoining is exact. */
const join = (tokens: string[]) => tokens.join('').trim();

/** Every way to break `tokens` into `k` lines, in order. */
function splits(tokens: string[], k: number): string[][] {
	if (k === 1) return [[join(tokens)]];
	const out: string[][] = [];
	for (let i = 1; i <= tokens.length - k + 1; i++) {
		for (const rest of splits(tokens.slice(i), k - 1)) out.push([join(tokens.slice(0, i)), ...rest]);
	}
	return out;
}

/**
 * Break `text` into up to `maxLines` lines — at spaces, or just after a slash
 * ("Asheville/Chapel Hill") — keeping the split that scores highest (ties go
 * to fewer lines). Used to fit names onto labels.
 */
export function bestSplit(
	text: string,
	maxLines: number,
	score: (lines: string[]) => number
): { lines: string[]; score: number } {
	// Words, each keeping a trailing slash and any space before it.
	const tokens = text.trim().match(/\s*(?:[^\s/]+\/?|\/)/g) ?? [text.trim()];
	let best = { lines: [text.trim()], score: -Infinity };
	for (let k = 1; k <= Math.min(maxLines, tokens.length); k++) {
		for (const lines of splits(tokens, k)) {
			const s = score(lines);
			if (s > best.score * 1.01 || best.score === -Infinity) best = { lines, score: s };
		}
	}
	return best;
}

/**
 * Lay the film stock's name out along the canister in up to three lines,
 * picking whichever split prints largest. `fit` is the type size as a fraction
 * of the label's length (--label-room), so it holds at every canister size:
 * capped overall, by the longest line's length, and by the lines' combined
 * thickness across the body.
 */
export function canLabel(name: string): { lines: string[]; fit: number } {
	const { lines, score } = bestSplit(name, 3, (ls) => {
		const longest = Math.max(...ls.map((l) => l.length));
		return Math.min(0.17, 1 / (longest * 0.74), 0.44 / (ls.length * 1.08));
	});
	return { lines, fit: Math.max(0.085, score) };
}
