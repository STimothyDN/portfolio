/**
 * The meter's judgement: from a measured spot (or the sky, with no photo),
 * the scene, the film and what's on the lens, to an exposure, settings that
 * fit the camera, where the scene's shadows and highlights land on the film,
 * and what a photographer standing beside you would say.
 *
 * Exposure arithmetic, in EV at ISO 100 throughout: the exposure to give is
 * the reading minus every stop of extra light asked for (placing skin a stop
 * over middle gray, a third more for negative film, a filter's factor, the
 * roll's compensation). Where a tone lands on the film is its reading minus
 * that exposure: 0 is middle gray, +1 a stop over, and so on.
 */
import { formatAperture } from '../inventory';
import { circleOfConfusion, correctedSeconds, evAtIso, formatDistance, formatEv, formatSeconds, handheldLimit, hyperfocal, pickSettings, reciprocityFor, sunnyRule, type Picks } from '../light';
import { shutterSeconds } from '../almanac';
import { METER_OFFSET, readRegion, spread, type Box, type LumaMap, type Region } from './luma';
import { filmProfile, filterBy, toneBy, type FilmProfile, type LightContext, type Scene, type ToneKey } from './scenes';

/* ---------- a measurement from a photo ---------- */

export interface Measurement {
	/** The metered spot or area, as a spot meter would read it: EV at ISO 100. */
	ev: number;
	kind: Region['kind'];
	/** The phone clipped most of what was metered: the truth is at least (or at most) this. */
	bound: 'at-least' | 'at-most' | null;
	/** Where the absolute level comes from. */
	from: 'settings' | 'brightness' | 'estimate';
	/** EV at ISO 100 of a pixel at 0 scene stops (for drawing the false colour). */
	level: number;
	/** The frame the lens sees, as EV at ISO 100: centre-weighted average and the spread. */
	frame: { average: number; deep: number; shadows: number; median: number; highlights: number; brightest: number; hi: number; lo: number };
}

/**
 * Read a region of a photo. With the phone's exposure (`camera`), the level
 * is absolute; without it, the frame's centre-weighted average is pinned to
 * `anchor` (the scene's typical light) and everything else is relative.
 */
export function measure(
	map: LumaMap,
	region: Region,
	box: Box,
	camera: { ev: number; from: 'settings' | 'brightness' } | null,
	anchor: number,
	calibration = 0
): Measurement {
	const frame = readRegion(map, { kind: 'frame' }, box);
	const level = camera ? camera.ev + METER_OFFSET + calibration : anchor - frame.stops;
	const r = region.kind === 'frame' ? frame : readRegion(map, region, box);
	const s = spread(map, box);
	return {
		ev: level + r.stops,
		kind: region.kind,
		bound: r.hi > 0.25 ? 'at-least' : r.lo > 0.25 ? 'at-most' : null,
		from: camera ? camera.from : 'estimate',
		level,
		frame: {
			average: level + frame.stops,
			deep: level + s.p2,
			shadows: level + s.p5,
			median: level + s.p50,
			highlights: level + s.p95,
			brightest: level + s.p98,
			hi: s.hi,
			lo: s.lo,
		},
	};
}

/* ---------- advice ---------- */

export interface AdviseInput {
	scene: Scene;
	ctx: LightContext;
	measured: Measurement | null;
	/** What was metered (spot or area). */
	tone: ToneKey;
	stock: { name: string; brand: string | null; token: string | null; process: string; format: string };
	/** Box speed, and the speed this roll is rated at. */
	boxIso: number | null;
	iso: number;
	comp: number;
	filter: string;
	/** Stops more (or less) the user asked for. */
	nudge: number;
	apertures: number[];
	widest: number | null;
	/** The lens on the camera, as a 35mm focal length. */
	focal35: number | null;
	manual: boolean;
	/** "2019-06": when the film expires. */
	expires: string | null;
	today: string;
	/** The lens's real focal length, mm (for focus hints). */
	focal?: number | null;
	/** How this camera's negatives come back against the same film elsewhere (+ thin, − dense). */
	lift?: number | null;
	/** Minutes since the reading photo was taken. */
	age?: number | null;
}

export interface Step {
	label: string;
	/** Stops of extra exposure (+ more light). */
	stops: number;
}

export type NoteTone = 'ok' | 'tip' | 'warn' | 'bad';
export interface Note {
	tone: NoteTone;
	text: string;
	/** A one-tap fix: add this many stops. */
	nudge?: number;
	/** A one-tap fix: put this filter on. */
	filter?: string;
}

export interface ZoneMark {
	key: 'metered' | 'shadows' | 'highlights';
	label: string;
	/** Stops from the film's middle gray at this exposure. */
	at: number;
	bound: 'at-least' | 'at-most' | null;
}

export interface Fixed {
	label: string;
	aperture: number;
	shutter: string;
}

export interface Bracket {
	label: string;
	text: string;
	/** Set when it's a position on the dials (tap to set). */
	aperture?: number;
	shutter?: string;
}

export interface Advice {
	/** Where the reading starts. */
	base: { ev: number; label: string; from: string };
	steps: Step[];
	/** EV at ISO 100 to expose for. */
	e100: number;
	/** EV at the film's speed: what the dials are set for. */
	evIso: number;
	/** Sunny 16's aperture for this light (at 1/ISO), when it applies. */
	rule: string | null;
	picks: Picks;
	/** A setting a rule gives outright (fireworks). */
	fixed: Fixed | null;
	film: FilmProfile;
	marks: ZoneMark[];
	notes: Note[];
	/** Three frames that cover the doubt, when there is some. */
	bracket: Bracket[] | null;
	/** What a photographer would say, in a sentence or two. */
	call: string;
}

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** "Zone VI" for a tone a stop over middle gray. */
export const zoneName = (at: number) => `Zone ${ROMAN[Math.max(0, Math.min(10, Math.round(5 + at)))]}`;

/** "a stop", "⅔ stop", "1⅓ stops", "2 stops". */
export function stopsWords(n: number): string {
	const a = Math.abs(n);
	if (Math.abs(a - 1) < 0.1) return 'a stop';
	if (a < 0.9) return `${formatEv(a).replace(/^0/, '')} stop`;
	return `${formatEv(a)} stops`;
}

/** "+⅓", "−1⅔". */
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatEv(Math.abs(n)).replace(/^0(?=[⅓⅔])/, '')}`;

/** Where a tone belongs in this scene, on this film. */
export function placement(tone: ToneKey, scene: Scene, film: FilmProfile): number {
	if (tone === 'highlight') return Math.min(3, film.shoulder);
	return scene.place?.[tone] ?? toneBy(tone).place;
}

const third = (n: number) => Math.round(n * 3) / 3;
/** Up to the next third of a stop (a hair's grace for rounding). */
const upThird = (n: number) => Math.ceil(n * 3 - 0.05) / 3;
const DIAL = ['1s', '1/2', '1/4', '1/8', '1/15', '1/30', '1/60', '1/125', '1/250', '1/500', '1/1000', '1/2000', '1/4000'];

export function advise(i: AdviseInput): Advice {
	const { scene, ctx } = i;
	const film = filmProfile(i.stock, i.boxIso, i.iso);
	const light = scene.light(ctx);
	const m = scene.rule ? null : i.measured;
	const tone = toneBy(i.tone);
	const steps: Step[] = [];

	/* The reading, and where what was metered belongs. */
	let base: Advice['base'];
	if (m) {
		const source = m.from === 'estimate' ? `estimated from ${light.from}` : m.from === 'brightness' ? 'from the phone’s light reading' : 'from the phone’s exposure';
		if (m.kind === 'frame') {
			base = { ev: m.ev, label: 'Whole frame, centre-weighted', from: source };
			if (scene.average) steps.push({ label: scene.averageWhy ?? 'For this scene', stops: scene.average });
		} else {
			base = { ev: m.ev, label: `${m.kind === 'spot' ? 'Spot' : 'Area'}: ${tone.label.toLowerCase()}`, from: source };
			const place = placement(i.tone, scene, film);
			if (place) steps.push({ label: tone.why, stops: place });
		}
	} else {
		base = { ev: light.ev, label: scene.label, from: light.from };
	}

	/* What the film, the filter and the roll add. */
	const exposingForShadows = !!m && m.kind !== 'frame' && i.tone === 'shadow';
	if (film.kind !== 'slide' && Math.abs(film.push) <= 0.2 && i.comp <= 0 && !exposingForShadows && !scene.rule) {
		steps.push({ label: film.kind === 'bw' ? 'Negative film: a third more for shadow detail' : 'Colour negative likes light: a third more', stops: 1 / 3 });
	}
	const filter = filterBy(i.filter);
	if (filter.stops) steps.push({ label: `${filter.label} filter`, stops: filter.stops });
	if (i.nudge) steps.push({ label: 'Your adjustment', stops: i.nudge });
	if (i.comp) steps.push({ label: `This roll’s ${signed(i.comp)} EV`, stops: i.comp });

	const e100 = base.ev - steps.reduce((s, x) => s + x.stops, 0);
	const evIso = evAtIso(e100, i.iso);
	const limit = handheldLimit(i.focal35);
	let picks = pickSettings(evIso, i.apertures, { handheld: limit, prefer: scene.prefer });
	let fixed: Fixed | null = null;
	if (scene.rule === 'fireworks') {
		// f/8 at ISO 100, a stop smaller for each doubling of speed, on bulb.
		const want = 8 * Math.sqrt(i.iso / 100);
		const aperture = i.apertures.reduce((b, a) => (Math.abs(Math.log2(a / want)) < Math.abs(Math.log2(b / want)) ? a : b), i.apertures[0]);
		fixed = { label: 'Tripod, bulb', aperture, shutter: 'B' };
		picks = { picks: [], slow: null, over: 0, handheld: limit };
	}

	/* Where the scene lands on the film. */
	const marks: ZoneMark[] = m
		? [
				{ key: 'shadows', label: 'Shadows', at: m.frame.shadows - e100, bound: m.frame.lo > 0.05 ? 'at-most' : null },
				{ key: 'metered', label: m.kind === 'frame' ? 'Average' : 'Metered', at: m.ev - e100, bound: m.bound },
				{ key: 'highlights', label: 'Highlights', at: m.frame.highlights - e100, bound: m.frame.hi > 0.05 ? 'at-least' : null },
			]
		: [];

	const notes: Note[] = [];
	const say = (tone: NoteTone, text: string, fix?: Pick<Note, 'nudge' | 'filter'>) => notes.push({ tone, text, ...fix });
	const stock = i.stock.name;
	let doubt = film.kind === 'slide' || scene.rule === 'moon';
	let consequence = '';

	/* How good the reading is. */
	if (m) {
		if (m.bound === 'at-least') {
			doubt = true;
			say('warn', 'The phone saw only white there, so it’s at least this bright. Tap a patch with some detail, or hold a finger on that spot in the phone’s camera to lock exposure there, and retake.');
		} else if (m.bound === 'at-most') {
			doubt = true;
			say('warn', 'The phone saw only black there, so it’s at most this bright. Tap something lighter, or lock the phone’s exposure on it and retake.');
		}
		if (m.from === 'estimate') {
			doubt = true;
			say('tip', `This photo carries no exposure data, so its level is pinned to the ${light.from}. Light and dark within it are still right relative to each other.`);
		}
	}

	/* Does the scene fit the film? */
	if (m) {
		const lo = m.frame.shadows - e100;
		const hi = m.frame.highlights - e100;
		const range = hi - lo;
		const holds = film.shoulder - film.toe;
		const burns = hi > film.shoulder + 0.15;
		const blocks = lo < film.toe - 0.15;
		if (!burns && !blocks) {
			say('ok', `It all fits: shadows at ${zoneName(lo)}, highlights at ${zoneName(hi)}, inside what ${stock} holds.`);
			consequence = 'Shadows and highlights both hold.';
		} else if (burns && blocks) {
			doubt = true;
			say(
				film.kind === 'slide' ? 'bad' : 'warn',
				`The scene spans ${stopsWords(range)}, more than ${stock} holds (about ${formatEv(holds)}). Choose which end to lose, or fill the shadows with a reflector or flash.`
			);
			consequence = film.kind === 'slide' ? 'Shadows go black and the brightest parts burn.' : 'The deepest shadows go black and the brightest parts print white.';
		} else if (blocks) {
			const need = upThird(film.toe - lo);
			const spare = film.shoulder - hi;
			if (spare >= need) {
				say('tip', `Shadows land at ${zoneName(lo)}: they’ll go black. ${stopsWords(need)[0].toUpperCase()}${stopsWords(need).slice(1)} more keeps them, and the highlights still fit.`, { nudge: need });
				consequence = 'The deepest shadows go black.';
			} else {
				say('tip', `Shadows land at ${zoneName(lo)} and go black; there’s no room to lift them without losing the highlights. Fill them, or let them go.`);
				consequence = 'The deepest shadows go black.';
			}
		} else {
			const over = upThird(hi - film.shoulder);
			const spare = lo - film.toe;
			const text =
				film.kind === 'slide'
					? `Highlights land at ${zoneName(hi)}: past what slide film holds, they’ll burn clear. Meter the brightest detail instead, or use a graduated ND on the sky.`
					: `Highlights land at ${zoneName(hi)}: past what ${stock} holds, they’ll print white.`;
			say(film.kind === 'slide' ? 'bad' : 'warn', spare >= over ? `${text} ${stopsWords(over)[0].toUpperCase()}${stopsWords(over).slice(1)} less keeps them and the shadows still hold.` : text, spare >= over ? { nudge: -over } : undefined);
			consequence = 'The brightest parts burn out.';
		}
		if (m.frame.hi > 0.1 && !burns) say('tip', 'The phone clipped part of this frame white: those parts may be brighter than shown.');
		if (scene.key !== 'backlit' && scene.key !== 'sunset' && m.kind === 'frame' && m.frame.highlights - m.frame.median > 3.5 && m.frame.hi > 0.08) {
			say('tip', 'A lot of bright light behind? If it’s behind your subject, pick Backlit and tap the face.');
		}
	}

	/* The film itself. */
	if (film.push > 0.2) {
		say('tip', `Pushed ${stopsWords(film.push)}: meter for the mid-tones; deep shadows go regardless. Tell the lab “push +${Math.round(film.push)}”.`);
	} else if (film.push < -0.2) {
		say(
			'tip',
			film.kind === 'slide'
				? `Rated ${stopsWords(-film.push)} slower than the box: on slide film every frame comes out lighter. Intended?`
				: `Rated ${stopsWords(-film.push)} slower than the box: every frame gets the extra, for denser negatives and finer grain.`
		);
	}
	const expiredYears = i.expires ? (Date.parse(`${i.today}T00:00:00Z`) - Date.parse(`${i.expires.length === 7 ? `${i.expires}-28` : i.expires}T00:00:00Z`)) / 31_557_600_000 : 0;
	if (expiredYears >= 2 && Math.abs(film.push) <= 0.2 && i.comp <= 0) {
		const perDecade = film.kind === 'negative' ? 1 : film.kind === 'bw' ? 0.5 : 0.33;
		const extra = third(Math.max(1 / 3, (expiredYears / 10) * perDecade));
		say('tip', `Expired ${Math.floor(expiredYears)} years: give it about ${stopsWords(extra)} more (rate it near ISO ${Math.round(i.iso / 2 ** extra)}).`, { nudge: extra });
	}
	if (film.kind === 'slide') say('tip', 'Slide film shows every third of a stop: protect the highlights, and bracket by half stops on the aperture ring when it matters.');
	else if (/ektar/i.test(stock)) say('tip', 'Ektar punishes underexposure with muddy shadows: if in doubt, give more.');
	else if (/portra/i.test(stock)) say('tip', 'Portra takes two stops over without complaint; under, it goes muddy and grainy.');
	if (film.tungsten && scene.daylight) {
		if (i.filter === '85b') say('ok', 'The 85B balances this tungsten film for daylight.');
		else say('tip', `${stock} is balanced for tungsten light: in daylight it goes blue. An 85B filter fixes it.`, { filter: '85b' });
	} else if (film.tungsten && scene.warm) {
		say('ok', `${stock} is balanced for warm light like this: colours come out true.`);
	} else if (!film.tungsten && scene.warm && film.kind !== 'bw') {
		say('tip', 'Daylight film under warm light turns orange; the scan corrects some. An 80A filter neutralises it, at two stops’ cost.');
	}
	if (film.kind === 'bw' && i.filter === 'none' && ['landscape', 'sun', 'hazy', 'snow'].includes(scene.key)) {
		say('tip', 'On B&W, a yellow filter gives the sky some weight; orange gives drama.', { filter: 'yellow' });
	}

	/* What your own negatives say about this camera. */
	if (i.lift != null && i.lift >= 0.025 && !scene.rule && e100 < 12.5 && i.nudge < 0.9) {
		say('tip', 'Your scans from this camera come back thin in dim light: give it a stop more.', { nudge: 1 });
	}

	/* The camera. */
	if (i.manual && picks.slow) {
		doubt = true;
		const at = i.apertures.find((a) => a >= 8) ?? i.apertures.at(-1)!;
		const metered = (at * at) / 2 ** evIso;
		const corrected = correctedSeconds(metered, reciprocityFor(i.stock));
		say(
			'tip',
			`On a tripod at ${formatAperture(at)}: ${formatSeconds(metered)}${corrected > metered * 1.15 ? `, or ${formatSeconds(corrected)} once reciprocity is counted` : ''}.`
		);
	} else if (i.manual && picks.picks[0] && i.focal35 && i.focal35 > 30) {
		const t = picks.picks[0].setting.seconds;
		if (t >= limit / 1.6) say('tip', `At ${Math.round(i.focal35)}mm, hold at 1/${Math.round(1 / limit)} or faster; brace on something below that.`);
	}
	if (i.manual && picks.over > 0.5) say('tip', 'Too bright for the fastest setting: a polarizer (1½ stops) or an ND filter brings it back in range.', { filter: picks.over > 2.5 ? 'nd8' : 'polarizer' });
	if (!i.manual) {
		if (scene.key === 'backlit') say('tip', 'An automatic camera exposes for the bright background: use its backlight button, or the flash to light the face.');
		else if (scene.key === 'snow') say('tip', 'Automatic exposure turns snow gray: use +1.5 if the camera has it.');
		else if (scene.group === 'night' || scene.key === 'candle' || scene.key === 'home') say('tip', 'The flash only reaches about 3 m: switch it off for distant lights, and brace the camera.');
	}

	/* Where to focus, when the scene wants depth. */
	const lead = picks.picks[0]?.setting;
	if (i.manual && lead && i.focal && (scene.prefer === 'depth' || scene.prefer === 'street')) {
		const H = hyperfocal(i.focal, lead.aperture, circleOfConfusion(i.stock.format));
		if (H < 60) say('tip', `At ${formatAperture(lead.aperture)} on the ${i.focal}mm, focus at ${formatDistance(H)}: everything from ${formatDistance(H / 2)} to infinity is sharp.`);
	}

	/* The light itself. */
	if (m && i.age != null && scene.group !== 'indoor' && i.age >= (ctx.sky.daylight && ctx.altitude < 10 ? 5 : 15)) {
		say('tip', `This reading is ${Math.round(i.age)} minutes old, and the light has likely moved: take a new one.`);
	}
	if (scene.rule === 'moon' && ctx.moon) {
		if (ctx.moon.lit < 0.05) say('warn', 'It’s a new moon: there’s nothing to photograph tonight.');
		else if (ctx.moon.altitude < 0) say('warn', 'The moon is below the horizon right now.');
	}
	if (scene.group !== 'indoor' && ctx.sky.daylight && ctx.altitude < 10 && ctx.altitude > -1) {
		say('tip', 'The sun is low: the light changes about a stop every ten minutes now. Re-meter every few frames.');
	}

	/* A bracket, when there's doubt. */
	let bracket: Bracket[] | null = null;
	const first = picks.picks[0]?.setting;
	if (doubt && first && i.manual) {
		const idx = DIAL.indexOf(first.shutter);
		const dial = `${formatAperture(first.aperture)} · ${first.shutter}`;
		if (film.kind === 'slide') {
			// Slide: half a stop either way, on the aperture ring's half clicks.
			bracket = [
				{ label: '−½', text: `${dial}, half a click smaller` },
				{ label: 'Metered', text: dial, aperture: first.aperture, shutter: first.shutter },
				{ label: '+½', text: `${dial}, half a click wider` },
			];
		} else if (idx >= 2) {
			// Negative film: never under; one and two stops over.
			bracket = [0, 1, 2].map((k) => ({
				label: k ? `+${k}` : 'Metered',
				text: `${formatAperture(first.aperture)} · ${DIAL[idx - k]}`,
				aperture: first.aperture,
				shutter: DIAL[idx - k],
			}));
		}
	}

	/* What a photographer would say. */
	const setting = fixed
		? `${formatAperture(fixed.aperture)} on bulb`
		: first
			? `${formatAperture(first.aperture)} at ${first.shutter}`
			: picks.slow
				? `${formatAperture(picks.slow.aperture)} needs ${formatSeconds(picks.slow.seconds)}`
				: '';
	const rule = !m && scene.daylight ? sunnyRule(light.ev) : null;
	let opening: string;
	if (m && m.kind !== 'frame') {
		const place = placement(i.tone, scene, film);
		opening = `${tone.label} ${place ? `placed ${stopsWords(place)} ${place > 0 ? 'over' : 'under'} middle gray` : 'kept at middle gray'}`;
	} else if (m) {
		opening = scene.average ? `Whole frame, ${signed(scene.average)} for ${scene.key === 'auto' ? 'the light' : scene.label.toLowerCase()}` : 'Whole frame, as read';
	} else if (scene.rule === 'moon') opening = light.from;
	else if (scene.rule === 'fireworks') opening = 'Fireworks don’t need a meter';
	else opening = rule ? `${scene.label}: Sunny 16 says ${rule} at 1/${i.iso}` : `${scene.label}, about EV ${formatEv(light.ev)}`;
	const call = [setting ? `${opening}: ${setting}.` : `${opening}.`, consequence].filter(Boolean).join(' ');

	return { base, steps, e100, evIso, rule, picks, fixed, film, marks, notes, bracket, call };
}

/** How the dials as set compare with an exposure (EV at the film's speed). */
export function dialCheck(evIso: number, aperture: number | null, shutter: string | null, slide = false): { tone: 'ok' | 'warn' | 'bad'; text: string } | null {
	const t = shutterSeconds(shutter);
	if (aperture == null || t == null) return null;
	const over = Math.round((evIso - Math.log2((aperture * aperture) / t)) * 3) / 3;
	if (Math.abs(over) < 0.34) return { tone: 'ok', text: 'right on the reading.' };
	const stops = `${formatEv(Math.abs(over))} ${Math.abs(over) > 1.2 ? 'stops' : 'stop'}`;
	if (over > 0) {
		if (slide) return { tone: over <= 0.7 ? 'warn' : 'bad', text: `${stops} over: slide film will burn. Close down or speed up.` };
		return over <= 2.4 ? { tone: 'ok', text: `${stops} over, fine on negative film.` } : { tone: 'warn', text: `${stops} over: close down or speed up.` };
	}
	return { tone: over >= -0.7 ? 'warn' : 'bad', text: `${stops} under: open up or slow down.` };
}
