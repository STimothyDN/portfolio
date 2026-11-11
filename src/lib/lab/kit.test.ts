import { describe, expect, it } from 'vitest';

import { edgeFromFilename, suggestAlignment } from './alignment';
import { batteryBox, cameraBatteries, shoppingList } from './batteries';
import { agitationWindows, bwTimeAt, planRun, processOf, recipesFor, reusedTime, BUILT_IN, chemistryState } from './darkroom';
import { batteryKey, batteryOf, batteryText, shuttersFor } from './inventory';
import { pickSettings } from './light';
import { nudges } from './nudges';
import { filmNeed, framesPerDay, lightOf, packingList, pickRolls, speedMix, tripDates } from './trip';
import type { RollView } from './inventory';

describe('batteries', () => {
	it('reads the ways people write a battery', () => {
		expect(batteryOf('2 × LR44')).toEqual({ count: 2, key: 'LR44', name: 'LR44' });
		expect(batteryOf('2x SR44')).toMatchObject({ count: 2, key: 'LR44' });
		expect(batteryOf('LR44 x2')).toMatchObject({ count: 2, key: 'LR44' });
		expect(batteryOf('4LR44 (6 V)')).toMatchObject({ count: 1, key: '4LR44' });
		expect(batteryOf('CR123A')).toMatchObject({ count: 1, key: 'CR123A' });
		expect(batteryOf('')).toBeNull();
		expect(batteryKey('357')).toBe('LR44');
		expect(batteryText(2, 'LR44')).toBe('2 × LR44');
	});

	const cams = [
		{ id: 'a', name: 'X-700', battery: '2 × LR44', batteryChangedOn: '2024-01-10', status: 'active' },
		{ id: 'b', name: 'Epic', battery: 'CR123A', batteryChangedOn: '2026-10-01', status: 'active' },
		{ id: 'c', name: 'Sold', battery: '2 × LR44', batteryChangedOn: null, status: 'gone' },
	];
	it('knows which sets are old and what the box covers', () => {
		const per = cameraBatteries(cams, '2026-11-11');
		expect(per.map((c) => c.cameraId)).toEqual(['a', 'b']);
		expect(per[0]).toMatchObject({ key: 'LR44', cells: 2, old: true });
		const box = batteryBox(cams, [{ type: 'LR44', onHand: 1 }], '2026-11-11');
		const lr = box.find((r) => r.type === 'LR44')!;
		expect(lr).toMatchObject({ onHand: 1, sets: 0, short: true });
		expect(shoppingList(box).find((s) => s.type === 'LR44')?.need).toBe(3);
	});
});

describe('battery nudge', () => {
	it('flags an old set in a loaded camera when the box can’t cover it', () => {
		const rolls = [{ id: 'r', code: 'R-1', status: 'camera', statusOn: '2026-11-01', exposures: 36, frameCount: 3, camera: { id: 'a', name: 'X-700' }, stock: { id: 's' } }] as unknown as RollView[];
		const box = batteryBox([{ id: 'a', name: 'X-700', battery: '2 × LR44', batteryChangedOn: '2024-01-10', status: 'active' }], [], '2026-11-11');
		const n = nudges({ rolls, today: '2026-11-11', turnaround: {}, forecast: { byStock: {}, monthsOfFilm: null }, canLink: false, passkeys: 2, box });
		expect(n[0].key).toBe('battery-a');
		expect(n[0].text).toMatch(/X-700’s batteries are 34 months old and the box has no LR44/);
	});
});

describe('shutter range', () => {
	it('offers only the speeds the camera has, from its model when not filled in', () => {
		const x700 = shuttersFor({ token: 'minoltax700', shutterFastest: null, shutterSlowest: null });
		expect(x700.at(-1)).toBe('1/1000');
		expect(x700).toContain('B');
		expect(shuttersFor({ token: null, shutterFastest: '1/500', shutterSlowest: '1/30' })).toEqual(['B', '1/30', '1/60', '1/125', '1/250', '1/500']);
		expect(shuttersFor(null).at(-1)).toBe('1/4000');
	});
	it('keeps the meter inside that range', () => {
		const shutters = shuttersFor({ token: 'minoltax700', shutterFastest: null, shutterSlowest: null });
		const p = pickSettings(17, [1.7, 2, 2.8, 4, 5.6, 8, 11, 16, 22], { shutters });
		for (const pick of p.picks) expect(['1/1000', '1/500', '1/250', '1/125']).toContain(pick.setting.shutter);
	});
});

describe('scan alignment suggestions', () => {
	it('reads edge numbers from lab file names', () => {
		expect(edgeFromFilename('TimothyNav300519-R1-001-00.jpg')).toBe(-1);
		expect(edgeFromFilename('TimothyNav300519-R1-003-0.jpg')).toBe(0);
		expect(edgeFromFilename('TimothyNav300519-R1-013-5.jpg')).toBe(5);
		expect(edgeFromFilename('IMG_0012.jpg')).toBeNull();
		expect(edgeFromFilename('12A.jpg')).toBe(12);
	});
	it('sets the shift and pins around a skipped frame', () => {
		const scans = ['x-001-00.jpg', 'x-003-0.jpg', 'x-005-1.jpg', 'x-007-2.jpg', 'x-009-3.jpg', 'x-013-5.jpg', 'x-015-6.jpg'].map((file) => ({ file }));
		const frames = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `f${n}`, number: n, aperture: 8, shutter: '1/125', flash: false }));
		const s = suggestAlignment(scans, frames, 1)!;
		expect(s.basis).toBe('names');
		expect(s.firstScanFrame).toBe(-1);
		expect(s.pins).toEqual([
			{ number: 5, frameId: 'f5', file: 'x-013-5.jpg' },
			{ number: 6, frameId: 'f6', file: 'x-015-6.jpg' },
		]);
		expect(s.why).toMatch(/frame 4 wasn’t scanned/);
		expect(s.matched).toBe(5);
	});
	it('falls back to the light when names say nothing', () => {
		const evs = [15, 8, 13, 6, 14, 9, 12, 7];
		const frames = evs.map((ev, i) => ({ number: i + 1, aperture: 8, shutter: `1/${Math.round(2 ** ev / 64)}`, flash: false }));
		// The lab scanned a frame 0 first, then frames 1–8; brighter scenes scan brighter.
		const scans = [{ file: 's0.jpg', tone: [0.1, 0.4, 0.9] as [number, number, number] }, ...evs.map((ev, i) => ({ file: `s${i + 1}x.jpg`, tone: [0.05, ev / 20, 0.95] as [number, number, number] }))];
		const s = suggestAlignment(scans, frames, 1)!;
		expect(s.basis).toBe('light');
		expect(s.firstScanFrame).toBe(0);
	});
});

describe('darkroom', () => {
	it('shortens black-and-white time when it’s warmer, within the charts’ range', () => {
		expect(bwTimeAt(540, 20, 20)).toBe(540);
		expect(bwTimeAt(540, 20, 22)).toBeLessThan(540);
		expect(bwTimeAt(540, 20, 30)).toBe(bwTimeAt(540, 20, 24));
	});
	it('lengthens a reused C-41 kit and plans the steps', () => {
		expect(reusedTime(210, 5, 2)).toBe(231);
		const cs41 = BUILT_IN.find((r) => r.id === 'cs41-c41')!;
		const plan = planRun({ spec: cs41, tempC: 39, rollsBefore: 5 });
		expect(plan.devSeconds).toBe(231);
		expect(plan.steps.find((s) => s.develop)?.seconds).toBe(231);
	});
	it('agitates on schedule', () => {
		expect(agitationWindows(540, 'ilford').slice(0, 3)).toEqual([
			[0, 10],
			[60, 70],
			[120, 130],
		]);
		expect(agitationWindows(600, 'stand')).toEqual([
			[0, 30],
			[300, 310],
		]);
	});
	it('offers recipes for the roll’s film first', () => {
		const list = recipesFor(BUILT_IN, { process: 'B&W', film: 'Ilford HP5 Plus 400', ei: 800 });
		expect(list[0].id).toBe('hp5-ddx-800');
		expect(processOf('C-41')).toBe('c41');
	});
	it('says when chemistry is spent', () => {
		const c = { id: 'k', name: 'Cs41', kind: 'c41', mixedOn: '2026-10-01', capacityRolls: 24, rollsUsed: 23, lifeDays: 60, retiredOn: null, notes: null };
		expect(chemistryState(c, '2026-11-01').tone).toBe('low');
		expect(chemistryState({ ...c, rollsUsed: 24 }, '2026-11-01').spent).toBe(true);
	});
});

describe('trip planner', () => {
	const roll = (code: string, iso: number, expires: string | null = null) =>
		({ id: code, code, stock: { iso, name: `ISO ${iso}` }, shotAtIso: null, expires, rewoundAtFrame: null }) as unknown as RollView;
	it('works out days, pace and film', () => {
		expect(tripDates('2026-11-20', '2026-11-23')).toHaveLength(4);
		const day = (d: string, h: number) => ({ shotAt: Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`), tzOffset: 0 });
		expect(framesPerDay([day('2026-10-01', 9), day('2026-10-01', 10), day('2026-10-02', 9), day('2026-10-03', 9), day('2026-10-03', 11), day('2026-10-03', 12)])).toBe(2);
		// 48 frames less 10 left in the camera = 38: two rolls, plus a spare.
		expect(filmNeed(4, 12, 36, 10)).toEqual({ frames: 48, rolls: 3, inCameras: 10 });
	});
	it('mixes speeds by the light and picks rolls from the fridge', () => {
		expect(lightOf({ date: 'x', code: 0, cloud: 10, rain: 0, tMax: 20, tMin: 10 })).toBe('bright');
		expect(lightOf({ date: 'x', code: 63, cloud: 90, rain: 80, tMax: 20, tMin: 10 })).toBe('dim');
		const mix = speedMix(['bright', 'bright', 'dim'], 4, true);
		expect(mix.slow + mix.mid + mix.fast).toBe(4);
		expect(mix.fast).toBeGreaterThan(0);
		const { picked, short } = pickRolls([roll('A', 100, '2027-01'), roll('B', 100, '2026-12'), roll('C', 400), roll('D', 800)], { slow: 1, mid: 1, fast: 2 });
		expect(picked.find((p) => p.band === 'slow')?.roll.code).toBe('B');
		// Fast film is picked first (it's the scarce kind): the 400 stands in for a second 800, a 100 for the 400.
		expect(short).toEqual({ slow: 0, mid: 0, fast: 0 });
		expect(picked.filter((p) => p.standIn).map((p) => p.roll.code)).toEqual(['C', 'A']);
	});
	it('reminds about batteries, empty cameras and x-rays', () => {
		const items = packingList({
			cameras: [{ id: 'a', name: 'X-700', loaded: false, framesLeft: null }],
			batteries: [{ cameraId: 'a', name: 'X-700', key: 'LR44', cells: 2, months: 30, old: true }],
			box: [{ type: 'LR44', onHand: 4 }],
			flying: true,
			fastRolls: 2,
			days: 5,
		});
		expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(['batt-a', 'load-a', 'xray']));
		expect(items.find((i) => i.key === 'xray')?.tone).toBe('warn');
	});
});
