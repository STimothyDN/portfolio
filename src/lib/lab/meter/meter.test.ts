/**
 * The photo meter's arithmetic, against hand-worked numbers: EXIF parsing
 * (both byte orders), the camera's exposure, pixels to stops, regions,
 * the lens's frame on the phone's picture, and the advice for classic
 * situations (Sunny 16, backlight, snow, slide film, pushing, expiry).
 */
import { describe, expect, it } from 'vitest';

import { readSky, pickSettings, sunnyRule, handheldLimit } from '../light';
import { advise, dialCheck, measure, placement, signed, stopsWords, zoneName, type AdviseInput, type Measurement } from './advise';
import { cameraEv100, readExif } from './exif';
import { equivalent35, filmGate, findSpot, lensBox, lumaMap, METER_OFFSET, readRegion, sceneStops, spread, srgbToLinear } from './luma';
import { autoScene, filmProfile, moonLight, sceneBy, SCENES, TONES } from './scenes';

/* ---------- a JPEG with EXIF, built by hand ---------- */

type Val = { tag: number; type: 2 | 3 | 4 | 5 | 10; value: number | [number, number] | string };

function tiff(le: boolean, ifd0: Val[], exif: Val[]): Uint8Array {
	const buf = new ArrayBuffer(1024);
	const v = new DataView(buf);
	v.setUint16(0, le ? 0x4949 : 0x4d4d);
	v.setUint16(2, 42, le);
	v.setUint32(4, 8, le);
	let data = 600; // out-of-line values go here
	const write = (at: number, list: Val[], next: number) => {
		v.setUint16(at, list.length, le);
		list.forEach((e, k) => {
			const p = at + 2 + k * 12;
			v.setUint16(p, e.tag, le);
			v.setUint16(p + 2, e.type, le);
			if (e.type === 2) {
				const s = `${e.value}\0`;
				v.setUint32(p + 4, s.length, le);
				const where = s.length <= 4 ? p + 8 : data;
				for (let c = 0; c < s.length; c++) v.setUint8(where + c, s.charCodeAt(c));
				if (s.length > 4) {
					v.setUint32(p + 8, data, le);
					data += s.length + (s.length % 2);
				}
			} else if (e.type === 5 || e.type === 10) {
				const [n, d] = e.value as [number, number];
				v.setUint32(p + 4, 1, le);
				v.setUint32(p + 8, data, le);
				if (e.type === 5) {
					v.setUint32(data, n, le);
					v.setUint32(data + 4, d, le);
				} else {
					v.setInt32(data, n, le);
					v.setInt32(data + 4, d, le);
				}
				data += 8;
			} else {
				v.setUint32(p + 4, 1, le);
				if (e.type === 3) v.setUint16(p + 8, e.value as number, le);
				else v.setUint32(p + 8, e.value as number, le);
			}
		});
		v.setUint32(at + 2 + list.length * 12, next, le);
	};
	const exifAt = 8 + 2 + (ifd0.length + 1) * 12 + 4;
	write(8, [...ifd0, { tag: 0x8769, type: 4, value: exifAt }], 0);
	write(exifAt, exif, 0);
	return new Uint8Array(buf, 0, data);
}

function jpeg(t: Uint8Array | null): ArrayBuffer {
	const parts: number[] = [0xff, 0xd8];
	// An APP0 (JFIF) first, as real files have.
	parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
	if (t) {
		const len = t.length + 8;
		parts.push(0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...t);
	}
	parts.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
	return new Uint8Array(parts).buffer;
}

const IPHONE: Val[] = [
	{ tag: 0x829a, type: 5, value: [1, 250] },
	{ tag: 0x829d, type: 5, value: [178, 100] },
	{ tag: 0x8827, type: 3, value: 50 },
	{ tag: 0x9203, type: 10, value: [8, 1] },
	{ tag: 0x9204, type: 10, value: [0, 1] },
	{ tag: 0x920a, type: 5, value: [6765, 1000] },
	{ tag: 0xa405, type: 3, value: 24 },
];

describe('EXIF', () => {
	it('reads exposure, ISO, brightness and focal length (little-endian)', () => {
		const x = readExif(jpeg(tiff(true, [{ tag: 0x010f, type: 2, value: 'Apple' }, { tag: 0x0110, type: 2, value: 'iPhone 15 Pro' }], IPHONE)))!;
		expect(x.exposureTime).toBeCloseTo(1 / 250, 6);
		expect(x.fNumber).toBeCloseTo(1.78, 6);
		expect(x.iso).toBe(50);
		expect(x.brightness).toBe(8);
		expect(x.focal35).toBe(24);
		expect(x.make).toBe('Apple');
		expect(x.model).toBe('iPhone 15 Pro');
	});

	it('reads big-endian files the same', () => {
		const x = readExif(jpeg(tiff(false, [{ tag: 0x010f, type: 2, value: 'Google' }], IPHONE)))!;
		expect(x.exposureTime).toBeCloseTo(1 / 250, 6);
		expect(x.iso).toBe(50);
		expect(x.make).toBe('Google');
	});

	it('falls back to the APEX values when the plain ones are missing', () => {
		const x = readExif(
			jpeg(
				tiff(true, [], [
					{ tag: 0x9201, type: 10, value: [7, 1] }, // Tv 7 → 1/128 s
					{ tag: 0x9202, type: 5, value: [2, 1] }, // Av 2 → f/2
					{ tag: 0x8827, type: 3, value: 100 },
				])
			)
		)!;
		expect(x.exposureTime).toBeCloseTo(1 / 128, 6);
		expect(x.fNumber).toBeCloseTo(2, 6);
		expect(cameraEv100(x)!.ev).toBeCloseTo(9, 6);
	});

	it('gives null for files without EXIF, or that aren’t JPEGs', () => {
		expect(readExif(jpeg(null))).toBeNull();
		expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
		expect(readExif(new ArrayBuffer(0))).toBeNull();
		// Truncated mid-segment.
		expect(readExif(jpeg(tiff(true, [], IPHONE)).slice(0, 40))).toBeNull();
	});

	it('works out the exposure the camera gave', () => {
		const x = readExif(jpeg(tiff(true, [], IPHONE)))!;
		// log2(1.78² × 250) − log2(50 / 100) = 9.63 + 1
		expect(cameraEv100(x)!.ev).toBeCloseTo(Math.log2(1.78 * 1.78 * 250) + 1, 6);
		expect(cameraEv100(x)!.from).toBe('settings');
		// Brightness only: EV100 = Bv + 5, less any compensation.
		expect(cameraEv100({ ...x, exposureTime: null, fNumber: null, iso: null, brightness: 7, bias: 1 })).toEqual({ ev: 11, from: 'brightness' });
		expect(cameraEv100(null)).toBeNull();
		expect(cameraEv100({ ...x, exposureTime: null, brightness: null })).toBeNull();
	});
});

/* ---------- pixels ---------- */

function image(w: number, h: number, pixel: (x: number, y: number) => number): Uint8ClampedArray {
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const v = pixel(x, y);
			const p = (y * w + x) * 4;
			out[p] = out[p + 1] = out[p + 2] = v;
			out[p + 3] = 255;
		}
	return out;
}

describe('pixels to stops', () => {
	it('linearises sRGB', () => {
		expect(srgbToLinear(0)).toBe(0);
		expect(srgbToLinear(255)).toBeCloseTo(1, 6);
		expect(srgbToLinear(118)).toBeCloseTo(0.181, 3);
	});

	it('undoes a phone’s tone curve: gray stays, highlights open out', () => {
		expect(sceneStops(0)).toBe(0);
		const at = (byte: number) => sceneStops(Math.log2(srgbToLinear(byte) / 0.18));
		expect(at(118)).toBeCloseTo(0, 1);
		expect(at(245)).toBeGreaterThan(3.2);
		expect(at(245)).toBeLessThan(3.8);
		expect(at(20)).toBeLessThan(-4.2);
		expect(at(20)).toBeGreaterThan(-5);
		// Monotonic all the way.
		for (let b = 1; b < 255; b++) expect(at(b + 1)).toBeGreaterThan(at(b));
	});

	it('the meter offset is about a third of a stop', () => {
		expect(METER_OFFSET).toBeCloseTo(0.3, 2);
	});

	it('reads a spot, an area and the whole frame', () => {
		// Left half middle gray, right half near-white.
		const map = lumaMap(image(40, 30, (x) => (x < 20 ? 118 : 245)), 40, 30);
		const left = readRegion(map, { kind: 'spot', x: 0.25, y: 0.5, r: 0.05 });
		const right = readRegion(map, { kind: 'spot', x: 0.75, y: 0.5, r: 0.05 });
		expect(left.stops).toBeCloseTo(0, 1);
		expect(right.stops).toBeGreaterThan(3.2);
		expect(right.hi).toBe(0);
		const area = readRegion(map, { kind: 'area', x0: 0.6, y0: 0.2, x1: 0.9, y1: 0.8 });
		expect(area.stops).toBeCloseTo(right.stops, 3);
		// Averaged in linear light: the bright half dominates.
		const frame = readRegion(map, { kind: 'frame' });
		expect(frame.stops).toBeGreaterThan(2);
		expect(frame.stops).toBeLessThan(right.stops);
	});

	it('flags what the phone clipped or crushed', () => {
		const map = lumaMap(image(20, 20, (x) => (x < 10 ? 2 : 255)), 20, 20);
		expect(readRegion(map, { kind: 'spot', x: 0.75, y: 0.5, r: 0.1 }).hi).toBe(1);
		expect(readRegion(map, { kind: 'spot', x: 0.25, y: 0.5, r: 0.1 }).lo).toBe(1);
	});

	it('spreads the frame into percentiles', () => {
		// A ramp from black to white, left to right.
		const map = lumaMap(image(256, 4, (x) => x), 256, 4);
		const s = spread(map);
		expect(s.p2).toBeLessThan(s.p5);
		expect(s.p5).toBeLessThan(s.p50);
		expect(s.p50).toBeLessThan(s.p95);
		expect(s.p95).toBeLessThanOrEqual(s.p98);
		expect(s.hi).toBeCloseTo(6 / 256, 3);
	});

	it('finds the brightest and darkest parts that still have detail', () => {
		// Gray, with a bright (unclipped) patch top-right and a dark one bottom-left, and a clipped strip.
		const map = lumaMap(
			image(60, 40, (x, y) => (x > 55 ? 255 : x > 40 && y < 12 ? 230 : x < 15 && y > 28 ? 30 : 118)),
			60,
			40
		);
		const b = findSpot(map, 'brightest', 0.04)!;
		const d = findSpot(map, 'darkest', 0.04)!;
		expect(b.kind === 'spot' && b.x > 0.6 && b.x < 0.93 && b.y < 0.35).toBe(true);
		expect(d.kind === 'spot' && d.x < 0.3 && d.y > 0.65).toBe(true);
	});
});

describe('the film camera’s frame on the phone’s picture', () => {
	it('knows the formats', () => {
		expect(filmGate('35mm', 'Nikon FM2').label).toBe('35mm');
		expect(filmGate('35mm', 'Olympus Pen F').label).toBe('half frame');
		expect(filmGate('35mm', 'Pentax K1000').label).toBe('35mm');
		expect(filmGate('120', 'Mamiya 7').label).toBe('6×7');
		expect(filmGate('120', 'Mamiya 645 Pro').label).toBe('6×4.5');
		expect(filmGate('120', 'Hasselblad 500C/M').label).toBe('6×6');
		expect(filmGate('120', 'Fuji GW690').label).toBe('6×9');
		// An 80mm on 6×6 sees about what a 44mm does on 35mm.
		expect(equivalent35(80, filmGate('120', 'Hasselblad'))).toBeCloseTo(43.7, 0);
	});

	it('draws a 50mm’s view inside a 26mm phone picture', () => {
		const { box, wider } = lensBox(4000, 3000, 26, 50, filmGate('35mm', null));
		expect(wider).toBe(false);
		expect(box.x1 - box.x0).toBeCloseTo(0.541, 2);
		expect(box.y1 - box.y0).toBeCloseTo(0.481, 2);
		expect((box.x0 + box.x1) / 2).toBeCloseTo(0.5, 6);
		// Portrait picture: the frame turns with it.
		const p = lensBox(3000, 4000, 26, 50, filmGate('35mm', null)).box;
		expect(p.y1 - p.y0).toBeGreaterThan(p.x1 - p.x0);
		// A 21mm sees more than the phone.
		expect(lensBox(4000, 3000, 26, 21, filmGate('35mm', null)).wider).toBe(true);
	});
});

/* ---------- settings ---------- */

const LENS = [1.7, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

describe('settings', () => {
	it('Sunny 16 at ISO 400 gives three ways, as before', () => {
		const p = pickSettings(17, LENS);
		expect(p.picks.map((x) => `${x.label} f/${x.setting.aperture} ${x.setting.shutter}`)).toEqual(['Everyday f/8 1/2000', 'Freeze motion f/5.6 1/4000', 'Deep focus f/16 1/500']);
	});

	it('holds a long lens to one over its focal length', () => {
		expect(handheldLimit(90)).toBeCloseTo(1 / 90, 6);
		expect(handheldLimit(28)).toBeCloseTo(1 / 30, 6);
		expect(handheldLimit(null)).toBeCloseTo(1 / 30, 6);
		// EV 10 at the film's speed: f/2 is 1/256 … f/5.6 is 1/32.
		const p = pickSettings(10, LENS, { handheld: handheldLimit(90) });
		expect(p.picks.every((x) => x.setting.seconds <= (1 / 90) * 1.26)).toBe(true);
		// f/4 wants 1/64: the dial's 1/60 is too slow for 90mm; f/2.8 at 1/125 holds.
		expect(p.picks.some((x) => x.setting.aperture === 4)).toBe(false);
		expect(p.picks.some((x) => x.setting.aperture === 2.8)).toBe(true);
	});

	it('leads with what the scene asks for', () => {
		expect(pickSettings(17, LENS, { prefer: 'depth' }).picks[0].label).toBe('Deep focus');
		expect(pickSettings(17, LENS, { prefer: 'shallow' }).picks[0].label).toBe('Shallow focus');
		expect(pickSettings(17, LENS, { prefer: 'street' }).picks[0]).toMatchObject({ label: 'Zone focus' });
		expect(pickSettings(8, LENS, { prefer: 'low' }).picks[0]).toMatchObject({ label: 'Wide open', setting: { aperture: 1.7 } });
	});

	it('offers a braced setting when nothing can be hand-held', () => {
		// EV 5.5: f/1.7 needs about 1/16.
		const p = pickSettings(5.5, LENS, { handheld: 1 / 30 });
		expect(p.slow).not.toBeNull();
		expect(p.picks[0]).toMatchObject({ label: 'Braced', setting: { aperture: 1.7, shutter: '1/15' } });
	});

	it('says Sunny 16 in words', () => {
		expect(sunnyRule(15)).toBe('f/16');
		expect(sunnyRule(13)).toBe('f/8');
		expect(sunnyRule(16)).toBe('f/22');
		expect(sunnyRule(12.5)).toBeNull();
		expect(sunnyRule(7)).toBeNull();
	});
});

/* ---------- advice ---------- */

const NOON = readSky(55, { cover: 5, code: 0 });
const PORTRA = { name: 'Portra 400', brand: 'Kodak', token: 'portra400', process: 'C-41', format: '35mm' };
const VELVIA = { name: 'Velvia 50', brand: 'Fujifilm', token: 'velvia50', process: 'E-6', format: '35mm' };

function input(over: Partial<AdviseInput> = {}): AdviseInput {
	return {
		scene: sceneBy('sun')!,
		ctx: { sky: NOON, altitude: 55 },
		measured: null,
		tone: 'mid',
		stock: PORTRA,
		boxIso: 400,
		iso: 400,
		comp: 0,
		filter: 'none',
		nudge: 0,
		apertures: LENS,
		widest: 1.7,
		focal35: 50,
		manual: true,
		expires: null,
		today: '2026-11-10',
		...over,
	};
}

function measured(ev: number, over: Partial<Measurement> = {}, frame: Partial<Measurement['frame']> = {}): Measurement {
	return {
		ev,
		kind: 'spot',
		bound: null,
		from: 'settings',
		level: ev,
		frame: { average: ev, deep: ev - 3, shadows: ev - 2, median: ev, highlights: ev + 2, brightest: ev + 2.5, hi: 0, lo: 0, ...frame },
		...over,
	};
}

describe('the sky and the scenes', () => {
	it('knows when the sun is out', () => {
		expect(NOON.sunOut).toBe(true);
		expect(readSky(55, { cover: 99, code: 3 }).sunOut).toBe(false);
		expect(readSky(-10, null).sunOut).toBe(false);
	});

	it('works shade, snow and backlight out from the sky', () => {
		const ctx = { sky: NOON, altitude: 55 };
		expect(sceneBy('shade')!.light(ctx).ev).toBe(12);
		expect(sceneBy('snow')!.light(ctx).ev).toBe(16);
		expect(sceneBy('backlit')!.light(ctx).ev).toBe(13);
		const grey = { sky: readSky(55, { cover: 90, code: 3 }), altitude: 55 };
		expect(sceneBy('shade')!.light(grey).ev).toBe(11.5);
		expect(sceneBy('snow')!.light(grey).ev).toBe(14);
	});

	it('every scene is complete', () => {
		for (const s of SCENES) {
			expect(s.tips.length, s.key).toBeGreaterThan(0);
			expect(TONES.some((t) => t.key === s.tone), s.key).toBe(true);
			expect(s.rule || s.meter, s.key).toBeTruthy();
			const ev = s.light({ sky: NOON, altitude: 55, moon: { lit: 1, altitude: 40 } }).ev;
			expect(ev, s.key).toBeGreaterThan(-6);
			expect(ev, s.key).toBeLessThan(18);
		}
		expect(new Set(SCENES.map((s) => s.key)).size).toBe(SCENES.length);
	});

	it('Looney 11, by phase and height', () => {
		expect(moonLight({ lit: 1, altitude: 40 }).ev).toBeCloseTo(13.56, 2);
		expect(moonLight({ lit: 0.75, altitude: 40 }).ev).toBeCloseTo(12.56, 2);
		expect(moonLight({ lit: 0.2, altitude: 8 }).ev).toBeCloseTo(9.56, 2);
	});

	it('film latitude: slide is narrow, pushing costs shadows', () => {
		const slide = filmProfile(VELVIA, 50, 50);
		expect(slide.kind).toBe('slide');
		expect(slide.shoulder - slide.toe).toBeLessThan(4);
		const portra = filmProfile(PORTRA, 400, 400);
		expect(portra.shoulder - portra.toe).toBeGreaterThan(8);
		const pushed = filmProfile({ name: 'HP5 Plus', brand: 'Ilford', token: 'hp5', process: 'B&W' }, 400, 1600);
		expect(pushed.push).toBe(2);
		expect(pushed.toe).toBe(-2);
		expect(filmProfile({ name: 'CineStill 800T', brand: 'CineStill', token: 'cs800t', process: 'C-41' }, 800, 800).tungsten).toBe(true);
		expect(filmProfile(PORTRA, 400, 400).tungsten).toBe(false);
	});
});

describe('advice', () => {
	it('Sunny 16 with no photo: the table, plus a third for negative film', () => {
		const a = advise(input());
		expect(a.base.ev).toBe(15);
		expect(a.rule).toBe('f/16');
		expect(a.steps).toEqual([{ label: 'Colour negative likes light: a third more', stops: 1 / 3 }]);
		expect(a.e100).toBeCloseTo(14.667, 3);
		expect(a.evIso).toBeCloseTo(16.667, 3);
		expect(a.call).toMatch(/Sunny 16 says f\/16 at 1\/400/);
		expect(a.marks).toEqual([]);
	});

	it('slide film gets no extra, and a warning to protect highlights', () => {
		const a = advise(input({ stock: VELVIA, boxIso: 50, iso: 50 }));
		expect(a.steps).toEqual([]);
		expect(a.evIso).toBe(14);
		expect(a.notes.some((n) => /Slide film shows every third/.test(n.text))).toBe(true);
	});

	it('backlit portrait: the face metered, placed a stop over', () => {
		const a = advise(input({ scene: sceneBy('backlit')!, measured: measured(12), tone: 'skinLight' }));
		expect(a.base.label).toBe('Spot: lighter skin');
		expect(a.steps.map((s) => s.stops)).toEqual([1, 1 / 3]);
		expect(a.e100).toBeCloseTo(12 - 4 / 3, 6);
		expect(a.marks.find((m) => m.key === 'metered')!.at).toBeCloseTo(4 / 3, 6);
		expect(a.picks.picks[0].label).toBe('Shallow focus');
		expect(a.call).toMatch(/^Lighter skin placed a stop over middle gray: f\//);
	});

	it('snow metered as white comes back to Sunny 16', () => {
		const a = advise(input({ scene: sceneBy('snow')!, measured: measured(17), tone: 'white', stock: VELVIA, boxIso: 50, iso: 50 }));
		expect(a.e100).toBe(15);
	});

	it('a whole-frame reading takes the scene’s correction', () => {
		const a = advise(input({ scene: sceneBy('snow')!, measured: measured(16, { kind: 'frame' }), stock: VELVIA, boxIso: 50, iso: 50 }));
		expect(a.steps[0]).toMatchObject({ stops: 5 / 3 });
		expect(a.e100).toBeCloseTo(16 - 5 / 3, 6);
		const night = advise(input({ scene: sceneBy('stage')!, measured: measured(6, { kind: 'frame' }), stock: VELVIA, boxIso: 50, iso: 50 }));
		expect(night.e100).toBeCloseTo(6 + 5 / 3, 6);
	});

	it('exposing for the shadows skips the negative-film extra', () => {
		const a = advise(input({ measured: measured(10), tone: 'shadow' }));
		expect(a.steps).toEqual([{ label: 'Shadow detail goes two stops under (Zone III)', stops: -2 }]);
		expect(a.e100).toBe(12);
	});

	it('highlights placed where the film holds them', () => {
		const sun = sceneBy('sun')!;
		expect(placement('highlight', sun, filmProfile(VELVIA, 50, 50))).toBe(1.7);
		expect(placement('highlight', sun, filmProfile(PORTRA, 400, 400))).toBe(3);
		expect(placement('sky', sceneBy('blue')!, filmProfile(PORTRA, 400, 400))).toBe(0);
		expect(placement('sky', sceneBy('sunset')!, filmProfile(PORTRA, 400, 400))).toBe(1);
	});

	it('says when the scene doesn’t fit, and how to fix it', () => {
		// Slide film, highlights three stops over the metered mid-tone.
		const slide = advise(input({ stock: VELVIA, boxIso: 50, iso: 50, measured: measured(13, {}, { highlights: 16, shadows: 12 }) }));
		expect(slide.notes.find((n) => n.tone === 'bad')!.text).toMatch(/Highlights land at Zone VIII/);
		// Negative film, shadows four stops under with room above: lift them.
		const neg = advise(input({ measured: measured(13, {}, { shadows: 8.5, highlights: 14 }) }));
		const lift = neg.notes.find((n) => n.nudge && n.nudge > 0)!;
		expect(lift.text).toMatch(/Shadows land at Zone I/);
		// −4⅙ to the toe at −3: 1⅙, up to the next third.
		expect(lift.nudge).toBeCloseTo(4 / 3, 6);
		// Fits.
		const fits = advise(input({ measured: measured(13) }));
		expect(fits.notes[0]).toMatchObject({ tone: 'ok' });
		expect(fits.call).toMatch(/Shadows and highlights both hold/);
	});

	it('a clipped reading is a lower bound, and asks for a retake or bracket', () => {
		const a = advise(input({ measured: measured(15, { bound: 'at-least' }) }));
		expect(a.notes[0].text).toMatch(/at least this bright/);
		expect(a.bracket?.map((b) => b.label)).toEqual(['Metered', '+1', '+2']);
	});

	it('no exposure data: estimated, and bracketed', () => {
		const a = advise(input({ measured: measured(13, { from: 'estimate' }) }));
		expect(a.base.from).toMatch(/estimated/);
		expect(a.notes.some((n) => /no exposure data/.test(n.text))).toBe(true);
		expect(a.bracket).not.toBeNull();
	});

	it('pushed film: no extra, and a word for the lab', () => {
		const hp5 = { name: 'HP5 Plus', brand: 'Ilford', token: 'hp5', process: 'B&W', format: '35mm' };
		const a = advise(input({ stock: hp5, boxIso: 400, iso: 1600, scene: sceneBy('citynight')! }));
		expect(a.steps).toEqual([]);
		expect(a.notes.some((n) => /push \+2/.test(n.text))).toBe(true);
	});

	it('expired film: about a stop a decade, offered as a nudge', () => {
		const a = advise(input({ expires: '2012-06' }));
		const n = a.notes.find((x) => /Expired 14 years/.test(x.text))!;
		expect(n.nudge).toBeCloseTo(4 / 3, 6);
	});

	it('filters and the roll’s compensation add up', () => {
		const a = advise(input({ filter: 'orange', comp: 1, stock: { ...PORTRA, process: 'B&W', name: 'Tri-X 400' } }));
		// No negative-film extra when the roll already gets +1.
		expect(a.steps.map((s) => [s.label, s.stops])).toEqual([
			['Orange (×4) filter', 2],
			['This roll’s +1 EV', 1],
		]);
		expect(a.e100).toBe(12);
	});

	it('tungsten film in daylight: an 85B, offered', () => {
		const a = advise(input({ stock: { name: 'CineStill 800T', brand: 'CineStill', token: 'cs800t', process: 'C-41', format: '35mm' }, boxIso: 800, iso: 800 }));
		expect(a.notes.find((n) => n.filter === '85b')).toBeTruthy();
		const indoors = advise(input({ scene: sceneBy('home')!, stock: { name: 'CineStill 800T', brand: 'CineStill', token: 'cs800t', process: 'C-41', format: '35mm' }, boxIso: 800, iso: 800 }));
		expect(indoors.notes.some((n) => n.tone === 'ok' && /balanced for warm light/.test(n.text))).toBe(true);
	});

	it('fireworks: f/8 at ISO 100, a stop smaller per doubling, on bulb', () => {
		expect(advise(input({ scene: sceneBy('fireworks')!, iso: 100, boxIso: 100 })).fixed).toMatchObject({ aperture: 8, shutter: 'B' });
		expect(advise(input({ scene: sceneBy('fireworks')! })).fixed).toMatchObject({ aperture: 16, shutter: 'B' });
	});

	it('a photo is ignored where a rule beats a meter', () => {
		const a = advise(input({ scene: sceneBy('moon')!, ctx: { sky: readSky(-30, null), altitude: -30, moon: { lit: 1, altitude: 40 } }, measured: measured(3) }));
		expect(a.base.ev).toBeCloseTo(13.56, 2);
		expect(a.marks).toEqual([]);
	});

	it('the night sky’s own reading when nothing is picked', () => {
		const sky = readSky(-20, null);
		const a = advise(input({ scene: autoScene(sky), ctx: { sky, altitude: -20 } }));
		expect(a.base.ev).toBe(7);
		expect(a.picks.picks[0].label).toBe('Wide open');
	});

	it('your own negatives: a camera that comes back thin gets a stop in dim light', () => {
		const dim = advise(input({ scene: sceneBy('trees')!, lift: 0.04 }));
		expect(dim.notes.find((n) => /come back thin/.test(n.text))?.nudge).toBe(1);
		expect(advise(input({ lift: 0.04 })).notes.some((n) => /come back thin/.test(n.text))).toBe(false);
	});

	it('landscape and street get the hyperfocal distance for the lead setting', () => {
		const a = advise(input({ scene: sceneBy('landscape')!, focal: 50 }));
		expect(a.picks.picks[0].label).toBe('Deep focus');
		expect(a.notes.some((n) => /focus at 5\.\d m/.test(n.text) && /to infinity is sharp/.test(n.text))).toBe(true);
	});

	it('an old reading asks for a new one, sooner when the sun is low', () => {
		expect(advise(input({ measured: measured(13), age: 20 })).notes.some((n) => /20 minutes old/.test(n.text))).toBe(true);
		expect(advise(input({ measured: measured(13), age: 8 })).notes.some((n) => /minutes old/.test(n.text))).toBe(false);
		const low = { sky: readSky(6, { cover: 5, code: 0 }), altitude: 6 };
		expect(advise(input({ measured: measured(13), age: 8, ctx: low })).notes.some((n) => /8 minutes old/.test(n.text))).toBe(true);
	});

	it('point-and-shoots get advice for the scene', () => {
		const a = advise(input({ manual: false, scene: sceneBy('backlit')! }));
		expect(a.notes.some((n) => /backlight button/.test(n.text))).toBe(true);
	});
});

describe('measuring a photo', () => {
	it('with the phone’s exposure, absolute; without, pinned to the anchor', () => {
		const map = lumaMap(image(40, 30, () => 118), 40, 30);
		const spot = { kind: 'spot', x: 0.5, y: 0.5, r: 0.05 } as const;
		const withExif = measure(map, spot, { x0: 0, y0: 0, x1: 1, y1: 1 }, { ev: 12, from: 'settings' }, 15);
		expect(withExif.ev).toBeCloseTo(12 + METER_OFFSET, 1);
		expect(withExif.from).toBe('settings');
		const calibrated = measure(map, spot, { x0: 0, y0: 0, x1: 1, y1: 1 }, { ev: 12, from: 'settings' }, 15, 1 / 3);
		expect(calibrated.ev - withExif.ev).toBeCloseTo(1 / 3, 6);
		const est = measure(map, { kind: 'frame' }, { x0: 0, y0: 0, x1: 1, y1: 1 }, null, 15);
		expect(est.ev).toBeCloseTo(15, 6);
		expect(est.from).toBe('estimate');
	});
});

describe('words', () => {
	it('zones, stops and signs', () => {
		expect(zoneName(0)).toBe('Zone V');
		expect(zoneName(1.2)).toBe('Zone VI');
		expect(zoneName(-7)).toBe('Zone 0');
		expect(stopsWords(1)).toBe('a stop');
		expect(stopsWords(1 / 3)).toBe('⅓ stop');
		expect(stopsWords(4 / 3)).toBe('1⅓ stops');
		expect(signed(1 / 3)).toBe('+⅓');
		expect(signed(-5 / 3)).toBe('−1⅔');
	});

	it('checks the dials, harder on slide film', () => {
		expect(dialCheck(12, 8, '1/60')!.tone).toBe('ok');
		expect(dialCheck(12, 8, '1/30')!.text).toMatch(/fine on negative/);
		expect(dialCheck(12, 8, '1/30', true)!.tone).toBe('bad');
		expect(dialCheck(12, null, '1/30')).toBeNull();
	});
});
