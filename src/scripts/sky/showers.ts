/**
 * The annual meteor-shower calendar (IMO working list: peak dates to the
 * day, radiants at peak). Observatory pages add a shower's meteors —
 * flying out from its radiant, while that's above the horizon — and the
 * readout names the active shower, or the next one.
 */
type Shower = {
	name: string;
	/** Peak, as [month 1–12, day]. */
	peak: [number, number];
	/** Days of activity before/after the peak. */
	before: number;
	after: number;
	/** Zenithal hourly rate at peak — how strong it is. */
	zhr: number;
	/** Radiant at peak: [RA°, Dec°] (J2000). */
	radiant: [number, number];
};

const SHOWERS: Shower[] = [
	{ name: 'Quadrantids', peak: [1, 3], before: 6, after: 9, zhr: 110, radiant: [230, 49] },
	{ name: 'Lyrids', peak: [4, 22], before: 8, after: 8, zhr: 18, radiant: [271, 34] },
	{ name: 'Eta Aquariids', peak: [5, 6], before: 17, after: 22, zhr: 50, radiant: [338, -1] },
	{ name: 'Perseids', peak: [8, 12], before: 26, after: 12, zhr: 100, radiant: [48, 58] },
	{ name: 'Draconids', peak: [10, 8], before: 2, after: 2, zhr: 10, radiant: [262, 54] },
	{ name: 'Orionids', peak: [10, 21], before: 19, after: 17, zhr: 20, radiant: [95, 16] },
	{ name: 'Leonids', peak: [11, 17], before: 11, after: 13, zhr: 15, radiant: [152, 22] },
	{ name: 'Geminids', peak: [12, 14], before: 10, after: 6, zhr: 150, radiant: [112, 33] },
	{ name: 'Ursids', peak: [12, 22], before: 5, after: 4, zhr: 10, radiant: [217, 76] },
];

const DAY = 86400000;

/** Signed days from `date` to this shower's nearest peak (negative = past). */
function daysToPeak(shower: Shower, date: Date) {
	const [month, day] = shower.peak;
	const year = date.getFullYear();
	let best = Infinity;
	for (const y of [year - 1, year, year + 1]) {
		const diff = (Date.UTC(y, month - 1, day) - date.getTime()) / DAY;
		if (Math.abs(diff) < Math.abs(best)) best = diff;
	}
	return best;
}

export type ShowerStatus =
	| {
			active: true;
			name: string;
			/** 0–1, 1 at peak. */ strength: number;
			zhr: number;
			radiant: [number, number];
	  }
	| { active: false; name: string; /** Days to its peak. */ days: number };

export function showerStatus(date = new Date()): ShowerStatus {
	let strongest: (ShowerStatus & { active: true }) | null = null;
	let next: { name: string; days: number } | null = null;
	for (const shower of SHOWERS) {
		const d = daysToPeak(shower, date);
		const inWindow = d >= 0 ? d <= shower.before : -d <= shower.after;
		if (inWindow) {
			// Linear ramp up to the peak and back down over the window.
			const strength = 1 - (d >= 0 ? d / shower.before : -d / shower.after);
			if (!strongest || strength * shower.zhr > strongest.strength * strongest.zhr) {
				strongest = { active: true, name: shower.name, strength, zhr: shower.zhr, radiant: shower.radiant };
			}
		} else if (d > 0 && (!next || d < next.days)) {
			next = { name: shower.name, days: Math.ceil(d) };
		}
	}
	return strongest ?? { active: false, ...next! };
}

/** Extra meteor rate a shower adds over the sporadic background (×), with its radiant overhead. */
const extraRate = (status: ShowerStatus & { active: true }) => Math.min(2.5, status.zhr / 40) * status.strength;

/** Meteor-rate multiplier for the sky: 1 outside showers, up to 3.5× at a big peak. */
export function meteorRate(date = new Date()) {
	const status = showerStatus(date);
	return status.active ? 1 + extraRate(status) : 1;
}

/** The active shower, as the sky renderer wants it (radiant in degrees). */
export function activeShower(date = new Date()) {
	const status = showerStatus(date);
	if (!status.active) return null;
	const [ra, dec] = status.radiant;
	return { name: status.name, ra, dec, extra: extraRate(status) };
}
