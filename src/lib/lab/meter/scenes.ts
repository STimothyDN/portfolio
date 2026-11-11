/**
 * What you're shooting, as a photographer would think of it: the scene (its
 * light, what to point the meter at, how to read a whole-frame average in
 * it, and what matters), the tone of the thing metered (where it belongs on
 * the film), the filter on the lens, and the film's own latitude.
 *
 * Light values are EV at ISO 100, from the standard exposure tables (Sunny
 * 16 and the published night and indoor values). Daylight scenes that
 * depend on the sky (shade, snow, backlight…) are worked out from the
 * weather reading, so they follow the actual light.
 */
import type { SkyReading } from '../light';
import type { Latitude } from './luma';

export type ToneKey = 'mid' | 'skinLight' | 'skinDeep' | 'dark' | 'shadow' | 'light' | 'white' | 'sky' | 'source' | 'highlight';

export interface Tone {
	key: ToneKey;
	label: string;
	/** For example. */
	like: string;
	/** Stops above middle gray it belongs at (highlight: from the film). */
	place: number;
	/** Why, as a step in the reading. */
	why: string;
}

export const TONES: Tone[] = [
	{ key: 'mid', label: 'Mid-tone', like: 'grass, stone, asphalt, a gray card', place: 0, why: 'A mid-tone: what any meter assumes' },
	{ key: 'skinLight', label: 'Lighter skin', like: 'a pale or light face', place: 1, why: 'Lighter skin sits a stop above middle gray' },
	{ key: 'skinDeep', label: 'Deeper skin', like: 'a brown or dark face', place: 0, why: 'Deeper skin keeps its richness at middle gray' },
	{ key: 'dark', label: 'Dark tone', like: 'dark foliage, dark clothes, bark', place: -1, why: 'Dark tones sit a stop below middle gray' },
	{ key: 'shadow', label: 'Shadow detail', like: 'the darkest shadow that should show texture', place: -2, why: 'Shadow detail goes two stops under (Zone III)' },
	{ key: 'light', label: 'Light tone', like: 'pale stone, light sand, light clothes', place: 1, why: 'Light tones sit a stop above middle gray' },
	{ key: 'white', label: 'Snow, white', like: 'snow, white walls, white clothes', place: 2, why: 'White keeps its texture two stops over (Zone VII)' },
	{ key: 'sky', label: 'Sky', like: 'the sky beside the sun, never the sun', place: 1, why: 'Sky holds its colour a stop over' },
	{ key: 'source', label: 'Lit sign, flame', like: 'neon, a lamp shade, a fire', place: 2, why: 'A light source keeps its colour two stops over' },
	{ key: 'highlight', label: 'Brightest detail', like: 'the brightest thing that should keep texture', place: 3, why: 'The brightest detail goes where the film still holds it' },
];
export const toneBy = (key: ToneKey) => TONES.find((t) => t.key === key)!;

export type SceneGroup = 'day' | 'low' | 'night' | 'indoor';
export const GROUPS: { key: SceneGroup; label: string }[] = [
	{ key: 'day', label: 'Daylight' },
	{ key: 'low', label: 'Low sun' },
	{ key: 'night', label: 'Night' },
	{ key: 'indoor', label: 'Indoors' },
];

/** Which kind of setting to offer first. */
export type Prefer = 'everyday' | 'depth' | 'shallow' | 'motion' | 'street' | 'low';

export interface LightContext {
	sky: SkyReading;
	/** Sun's height, degrees. */
	altitude: number;
	/** The moon now: share lit, and its height. */
	moon?: { lit: number; altitude: number };
}

export interface SceneLight {
	ev: number;
	/** Where the number came from: "Sunny 16 table", "sky reading −3". */
	from: string;
}

export interface Scene {
	key: string;
	label: string;
	group: SceneGroup;
	light: (c: LightContext) => SceneLight;
	/** What to point the meter at. */
	meter: string;
	tone: ToneKey;
	/** A tone's placement in this scene, where it differs. */
	place?: Partial<Record<ToneKey, number>>;
	/** Stops more than a whole-frame average reads, in this scene. */
	average: number;
	averageWhy?: string;
	prefer: Prefer;
	/** Sunny 16 applies (a daylight scene). */
	daylight?: boolean;
	/** The light is warm (bulbs, flame): daylight film goes orange. */
	warm?: boolean;
	/** A rule beats a meter here: no photo reading. */
	rule?: 'moon' | 'fireworks';
	tips: string[];
}

const table = (ev: number, from = 'standard exposure table'): ((c: LightContext) => SceneLight) => () => ({ ev, from });
/** From the sky reading, a few stops off depending on whether the sun is out. */
const fromSky =
	(sun: number, cloud: number, lo = -2, hi = 17): ((c: LightContext) => SceneLight) =>
	({ sky }) => {
		const off = sky.sunOut ? sun : cloud;
		const ev = Math.max(lo, Math.min(hi, sky.ev + off));
		return { ev, from: off ? `sky reading ${off > 0 ? '+' : '−'}${Math.abs(off)}` : 'sky reading' };
	};

export const SCENES: Scene[] = [
	/* ---------- daylight ---------- */
	{
		key: 'sun', label: 'Bright sun', group: 'day', daylight: true, light: table(15, 'Sunny 16'),
		meter: 'something mid-toned in the same light, or a face (say its tone)', tone: 'mid', average: 0, prefer: 'everyday',
		tips: [
			'Hard light: keep the sun behind a shoulder for colour, to the side for texture.',
			'Faces squint and get dark eye sockets in high sun: turn them out of it, or step into open shade.',
			'Full-sun shadows sit about three stops under: negative film wants the little extra it gets here.',
		],
	},
	{
		key: 'hazy', label: 'Hazy sun', group: 'day', daylight: true, light: table(14, 'Sunny 16'),
		meter: 'a mid-tone in the light', tone: 'mid', average: 0, prefer: 'everyday',
		tips: ['Soft shadows flatter faces: one of the best portrait lights there is.', 'Haze flattens distant hills: on B&W, a yellow or orange filter cuts through it.'],
	},
	{
		key: 'cloudy', label: 'Cloudy bright', group: 'day', daylight: true, light: table(13, 'Sunny 16'),
		meter: 'a mid-tone; keep the white sky out of it', tone: 'mid', average: 2 / 3, averageWhy: 'A white sky in frame makes an average give too little', prefer: 'everyday',
		tips: ['No shadows to fight: colour and portraits both sing.', 'A blank white sky has no detail and fools meters: frame it out or let it go white.'],
	},
	{
		key: 'overcast', label: 'Heavy overcast', group: 'day', daylight: true, light: table(12, 'Sunny 16'),
		meter: 'a mid-tone', tone: 'mid', average: 2 / 3, averageWhy: 'A white sky in frame makes an average give too little', prefer: 'everyday',
		tips: ['Dim and even: open up rather than dropping below a safe shutter speed.', 'Colours saturate when it’s wet: leaves, streets and paint all deepen.'],
	},
	{
		key: 'shade', label: 'Open shade', group: 'day', daylight: true, light: fromSky(-3, -1.5, 6, 14),
		meter: 'the subject in the shade, not the bright scene behind', tone: 'mid', average: 2 / 3, averageWhy: 'Bright surroundings make an average give too little', prefer: 'shallow',
		tips: [
			'Find the edge of the shade: a face lit by open sky and bright ground glows.',
			'Shade under blue sky is cool on colour film: a warm reflector helps, or let the scan correct it.',
		],
	},
	{
		key: 'trees', label: 'Under trees', group: 'day', daylight: true, light: fromSky(-4.5, -2.5, 5, 13),
		meter: 'the shaded ground or a face in the shade, not the sun patches', tone: 'mid', average: 2 / 3, averageWhy: 'Sun patches make an average give too little', prefer: 'everyday',
		tips: [
			'Sun patches will blow out, and that’s fine on negative film: expose for the shade.',
			'Dappled light is cruel to faces: move until the face is all shade or all sun.',
			'Leaves bounce green light onto skin; the scan can correct it if you note it.',
			'It’s darker than it looks in a forest: brace on a trunk below 1/30.',
		],
	},
	{
		key: 'snow', label: 'Snow or beach', group: 'day', daylight: true, light: fromSky(1, 1, 6, 17),
		meter: 'the snow or sand itself', tone: 'white', average: 5 / 3, averageWhy: 'Snow makes an average give far too little', prefer: 'depth',
		tips: [
			'Every meter turns snow gray: metered snow needs two stops more, already done here.',
			'Sun on snow is the brightest light you’ll meet: fast film can run out of shutter (a polarizer or ND helps).',
			'Cold drains batteries and makes film brittle: wind gently, keep a spare battery in a pocket.',
		],
	},
	{
		key: 'backlit', label: 'Backlit', group: 'day', daylight: true, light: fromSky(-2, -1, 6, 15),
		meter: 'the shaded side of the face, up close, not the sky', tone: 'skinLight', average: 5 / 3, averageWhy: 'A bright background makes an average give far too little', prefer: 'shallow',
		tips: [
			'The background will go bright: that’s the look. Metering the sky would leave a silhouette.',
			'Flare: shade the lens with a hand or hood, or let it in on purpose.',
			'A reflector or a pop of flash brings the background back if you want both.',
		],
	},
	{
		key: 'landscape', label: 'Landscape', group: 'day', daylight: true, light: fromSky(0, 0),
		meter: 'the land (grass, rock, trees), then check the sky in the zones', tone: 'mid', average: 1 / 3, averageWhy: 'A bright sky makes an average give a little too little', prefer: 'depth',
		tips: [
			'Expose for the land and the sky still prints on negative film; expose for the sky and the land goes dark.',
			'Stop down and focus at the hyperfocal distance (the Focus tab has it).',
			'On B&W, a yellow (+1) or orange (+2) filter gives clouds weight; red (+3) turns blue sky near black.',
		],
	},
	{
		key: 'portrait', label: 'Portrait', group: 'day', daylight: true, light: fromSky(0, 0),
		meter: 'the face, filling the spot', tone: 'skinLight', average: 0, prefer: 'shallow',
		tips: [
			'Say what tone the face is: the meter assumes middle gray, and faces rarely are.',
			'Focus on the nearer eye; wide open, depth of field is a few centimetres.',
			'Soft light beats direct sun: open shade, a cloudy sky, or a window.',
		],
	},
	{
		key: 'action', label: 'Moving subjects', group: 'day', daylight: true, light: fromSky(0, 0),
		meter: 'a mid-tone where the action will be', tone: 'mid', average: 0, prefer: 'motion',
		tips: [
			'To freeze: 1/250 for walking, 1/500 for running, 1/1000 for sport.',
			'Pre-focus where they’ll be and wait for them to arrive.',
			'Or pan with them at 1/30–1/60: a sharp subject over streaked background.',
		],
	},
	{
		key: 'street', label: 'Street', group: 'day', daylight: true, light: fromSky(0, 0),
		meter: 'the light side of the street, once, then leave the dials', tone: 'mid', average: 0, prefer: 'street',
		tips: [
			'Zone focus: at f/8, focus at about 3 m and roughly 2–6 m is sharp (exact numbers in Focus).',
			'Re-meter when you cross into shade, not for every frame.',
		],
	},

	/* ---------- low sun ---------- */
	{
		key: 'golden', label: 'Golden hour', group: 'low', daylight: true,
		light: (c) => (c.sky.daylight && c.altitude < 10 ? { ev: c.sky.ev, from: 'sky reading' } : { ev: 13, from: 'golden-hour light, front-lit' }),
		meter: 'the sunlit side of your subject', tone: 'mid', average: 0, prefer: 'shallow',
		tips: [
			'Front light makes skin glow; side light rakes texture; backlight rims hair.',
			'The light drops about a stop every ten minutes near the horizon: re-meter often.',
		],
	},
	{
		key: 'sunset', label: 'Sunset sky', group: 'low', daylight: true,
		light: (c) => ({ ev: c.altitude > 3 ? 13 : c.altitude > -1 ? 12 : 10, from: 'sunset table' }),
		meter: 'the sky a little to the side of the sun, never the sun', tone: 'sky', average: -1, averageWhy: 'Less than the average keeps the colour (and silhouettes the land)', prefer: 'everyday',
		tips: [
			'Exposed for the sky, the land goes to silhouette; two stops more brings it back and washes the sky.',
			'Keep shooting after it drops: the deepest colour often comes 10–20 minutes later.',
		],
	},
	{
		key: 'blue', label: 'Blue hour', group: 'low',
		light: (c) => (!c.sky.daylight && c.altitude > -7 ? { ev: c.sky.ev, from: 'twilight reading' } : { ev: 9, from: 'just after sunset' }),
		meter: 'the sky opposite the glow', tone: 'sky', place: { sky: 0 }, average: -1 / 3, averageWhy: 'Dark buildings make an average give too much', prefer: 'low',
		tips: [
			'City lights balance with the sky about 20–30 minutes after sunset.',
			'On a tripod, stop down and let it run: reciprocity adds time (Long exposure tab).',
			'The sky dims fast: open up a stop every few minutes.',
		],
	},

	/* ---------- night ---------- */
	{
		key: 'citynight', label: 'Lit streets', group: 'night', light: table(7), warm: true,
		meter: 'a lit face or a shop window, not the dark sky', tone: 'mid', average: -1, averageWhy: 'Dark areas make an average give a stop too much', prefer: 'low',
		tips: [
			'Expose for the pools of light and let the shadows go black.',
			'Put people under signs and in window light: that’s where the picture is.',
			'Short a stop? Push: rate it higher and tell the lab “push +1”.',
		],
	},
	{
		key: 'neon', label: 'Neon and signs', group: 'night', light: table(9),
		meter: 'the sign itself', tone: 'source', place: { source: 5 / 3 }, average: -1, averageWhy: 'Dark areas make an average give a stop too much', prefer: 'low',
		tips: ['Wet pavement doubles the colour.', 'CineStill and other no-remjet films glow red around bright lights: part of the charm.'],
	},
	{
		key: 'fire', label: 'Campfire', group: 'night', light: table(5, 'faces lit by a fire'), warm: true,
		meter: 'a face lit by the flames', tone: 'skinLight', average: -5 / 3, averageWhy: 'The dark around makes an average give far too much', prefer: 'low',
		tips: [
			'The fire itself will glow bright: that’s right.',
			'Very warm light: daylight film turns skin orange-gold. Lean into it.',
			'Wide open and braced on a knee or log: 1/30 holds still faces.',
		],
	},
	{
		key: 'moon', label: 'The moon', group: 'night', rule: 'moon',
		light: (c) => moonLight(c.moon),
		meter: '', tone: 'highlight', average: 0, prefer: 'everyday',
		tips: [
			'Looney 11: f/11 at 1/ISO for a full moon, a stop more for each phase thinner.',
			'A 50mm lens draws the moon half a millimetre wide on film: include the land, or use your longest lens.',
			'A moonlit landscape is about 17 stops darker than the moon: minutes at f/4, plus reciprocity.',
		],
	},
	{
		key: 'fireworks', label: 'Fireworks', group: 'night', rule: 'fireworks', light: table(9),
		meter: '', tone: 'source', average: 0, prefer: 'everyday',
		tips: [
			'Tripod, focus at infinity, bulb: open for one to three bursts.',
			'Hold a dark card over the lens between bursts to stack several in one frame.',
			'Stand upwind so the smoke drifts away from the show.',
		],
	},

	/* ---------- indoors ---------- */
	{
		key: 'window', label: 'Window light', group: 'indoor', light: fromSky(-5, -5, 6, 11),
		meter: 'the lit side of the face', tone: 'skinLight', average: 2 / 3, averageWhy: 'The bright window makes an average give too little', prefer: 'shallow',
		tips: [
			'Face the window for soft light, turn side-on for shape.',
			'A white card or sheet opposite fills the shadow side.',
			'It drops off fast: a step back from the window costs a stop.',
		],
	},
	{
		key: 'interior', label: 'Bright interior', group: 'indoor', light: table(8, 'offices, shops, galleries'),
		meter: 'a mid-tone in the room, not the windows', tone: 'mid', average: 0, prefer: 'low',
		tips: ['Fluorescent and LED light can go green on colour film; the scan corrects most of it.'],
	},
	{
		key: 'home', label: 'Lamps at home', group: 'indoor', light: table(6, 'home interiors'), warm: true,
		meter: 'a face by the lamp', tone: 'skinLight', average: -2 / 3, averageWhy: 'Dark corners make an average give too much', prefer: 'low',
		tips: [
			'Put the lamp beside the face and expose for it.',
			'Hand-held at the limit: brace, breathe out, squeeze.',
		],
	},
	{
		key: 'stage', label: 'Stage and gigs', group: 'indoor', light: table(8, 'stage lighting'),
		meter: 'the lit performer’s face, not the stage', tone: 'skinLight', average: -5 / 3, averageWhy: 'A dark stage makes an average give far too much', prefer: 'low',
		tips: [
			'Stage light changes constantly: meter the brightest look and wait for it to come back.',
			'B&W pushes beautifully to 1600 or 3200 here.',
		],
	},
	{
		key: 'candle', label: 'Candlelight', group: 'indoor', light: table(4, 'candle-lit close-up'), warm: true,
		meter: 'a face lit by the flame', tone: 'skinLight', average: -1, averageWhy: 'The dark around makes an average give too much', prefer: 'low',
		tips: [
			'One candle is about EV 4 at a face’s distance; several close by help a lot.',
			'Push territory: ISO 400 film rated at 1600, and tell the lab.',
		],
	},
];
export const sceneBy = (key: string) => SCENES.find((s) => s.key === key) ?? null;

/**
 * No scene picked: the light as the sky reading has it, or (with a photo
 * that carries the phone's exposure) as the photo shows it, so a picture
 * from earlier in the day isn't read as night.
 */
export function autoScene(sky: SkyReading, photoEv: number | null = null): Scene {
	const night = photoEv != null ? photoEv < 10 : !sky.daylight;
	return {
		key: 'auto',
		label: photoEv != null ? (night ? 'Low light' : 'Daylight') : sky.label,
		group: night ? 'night' : 'day',
		daylight: !night,
		light: (c) => ({ ev: c.sky.ev, from: 'sky reading' }),
		meter: night ? 'the lit part of the scene, not the dark sky' : 'something mid-toned in the light, or a face (say its tone)',
		tone: 'mid',
		average: night ? -1 : 0,
		averageWhy: night ? 'Dark areas make an average give a stop too much' : undefined,
		prefer: night ? 'low' : 'everyday',
		tips: [],
	};
}

/** Looney 11 (f/11 at 1/ISO for a full moon), a stop more per thinner phase, and a stop for a low moon. */
export function moonLight(m?: { lit: number; altitude: number }): SceneLight {
	const full = Math.log2(121 * 100); // f/11 at 1/100 on ISO 100: EV 13.56
	if (!m) return { ev: full, from: 'Looney 11' };
	const phase = m.lit > 0.9 ? 0 : m.lit > 0.6 ? 1 : m.lit > 0.4 ? 2 : 3;
	const low = m.altitude < 15 ? 1 : 0;
	const words = ['full', 'gibbous', 'half', 'crescent'][phase];
	return { ev: full - phase - low, from: `Looney 11, ${words} moon${low ? ', low in the sky' : ''}` };
}

/* ---------- filters ---------- */

export interface Filter {
	key: string;
	label: string;
	/** Exposure factor, as stops. */
	stops: number;
	bw?: boolean;
}

export const FILTERS: Filter[] = [
	{ key: 'none', label: 'No filter', stops: 0 },
	{ key: 'yellow', label: 'Yellow (×2)', stops: 1, bw: true },
	{ key: 'orange', label: 'Orange (×4)', stops: 2, bw: true },
	{ key: 'red', label: 'Red (×8)', stops: 3, bw: true },
	{ key: 'green', label: 'Green (×4)', stops: 2, bw: true },
	{ key: 'polarizer', label: 'Polarizer', stops: 4 / 3 },
	{ key: '85b', label: '85B warming', stops: 2 / 3 },
	{ key: '80a', label: '80A cooling', stops: 2 },
	{ key: 'nd2', label: 'ND 0.3 (1 stop)', stops: 1 },
	{ key: 'nd8', label: 'ND 0.9 (3 stops)', stops: 3 },
	{ key: 'nd64', label: 'ND 1.8 (6 stops)', stops: 6 },
	{ key: 'nd1000', label: 'ND 3.0 (10 stops)', stops: 10 },
];
export const filterBy = (key: string) => FILTERS.find((f) => f.key === key) ?? FILTERS[0];

/* ---------- film ---------- */

export interface FilmProfile extends Latitude {
	kind: 'negative' | 'bw' | 'slide';
	/** "colour negative", "slide film". */
	words: string;
	/** Stops pushed (+) or over-rated (−) against box speed. */
	push: number;
	tungsten: boolean;
}

const LATITUDE: [RegExp, Partial<Latitude>][] = [
	[/velvia/i, { toe: -2, shoulder: 1.7 }],
	[/provia|ektachrome|e100|astia|fortia|chrome/i, { toe: -2.3, shoulder: 2 }],
	[/ektar/i, { toe: -2.5, shoulder: 4 }],
	[/portra/i, { toe: -3, shoulder: 5.5 }],
	[/gold|ultramax|colorplus|superia|fuji\s*(200|400)|pro\s*image|lomography\s*color/i, { toe: -2.5, shoulder: 4.5 }],
	[/cinestill|vision\s*3|5219|5207|5203|5213|candido/i, { toe: -3, shoulder: 5 }],
	[/tri-?x|hp5|fp4|ilford\s*(hp|fp)/i, { toe: -3, shoulder: 4.5 }],
	[/delta\s*3200|t-?max\s*p?3200|tmz/i, { toe: -2.5, shoulder: 4 }],
];

/** How much shadow and highlight a stock holds, as rated on this roll. */
export function filmProfile(stock: { name: string; brand?: string | null; token?: string | null; process: string }, box: number | null, rated: number | null): FilmProfile {
	const text = `${stock.brand ?? ''} ${stock.name} ${stock.token ?? ''}`;
	const kind = stock.process === 'E-6' ? 'slide' : stock.process === 'B&W' ? 'bw' : 'negative';
	let lat: Latitude = kind === 'slide' ? { toe: -2.3, shoulder: 2 } : kind === 'bw' ? { toe: -3, shoulder: 4 } : { toe: -3, shoulder: 5 };
	for (const [re, l] of LATITUDE) if (re.test(text)) {
		lat = { ...lat, ...l };
		break;
	}
	const push = box && rated ? Math.round(Math.log2(rated / box) * 3) / 3 : 0;
	if (push < -0.2) {
		// Rated slower: every frame gets the extra, so the window sits lower against the rated meter.
		lat = { toe: lat.toe + push, shoulder: lat.shoulder + push };
	} else if (push > 0.2) {
		// Pushed: shadows are lost, contrast climbs.
		lat = { toe: lat.toe + 0.5 * push, shoulder: lat.shoulder - 0.3 * push };
	}
	return {
		...lat,
		kind,
		words: kind === 'slide' ? 'slide film' : kind === 'bw' ? 'B&W negative' : 'colour negative',
		push,
		tungsten: /800t|500t|200t|\b\d{3}t\b|tungsten|5219|5213|64t/i.test(text),
	};
}
