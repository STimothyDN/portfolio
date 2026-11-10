/**
 * The almanac's numbers, checked against hand-worked fixtures. Run with
 * `npm test`. Small samples and the same-film confound get their own cases:
 * those are where a chart would mislead.
 */
import { describe, expect, it } from 'vitest';

import type { RollView } from '../inventory';
import { nudges } from '../nudges';
import { toneGroups, type DeskScan } from '../insight';
import { byPosition, hitRates, wilson, type ScanFact } from './keepers';
import { returnWindow, turnarounds } from './labs';
import { bestSpeed, speedFits, windowFor } from './light-fit';
import { money } from './money';
import { averageRoll, backlogByWeek, quantile, segments, spread } from './pipeline';
import { rhythm } from './rhythm';
import { shelf } from './shelf';

const roll = (o: Partial<RollView> & { id: string }): RollView =>
	({
		code: o.id.toUpperCase(),
		title: null,
		status: 'negatives',
		statusOn: '2026-10-01',
		exposures: 36,
		stock: { id: 's1', token: 'portra400', brand: 'Kodak', name: 'Kodak Portra 400', iso: 400, process: 'C-41', format: '35mm' },
		camera: { id: 'c1', name: 'X-700' },
		lab: { id: 'l1', name: 'Fotoshoppe' },
		shotAtIso: null,
		exposureComp: null,
		expires: null,
		purchasedOn: null,
		priceCents: null,
		purchasedFrom: null,
		storageSpot: null,
		labOrder: null,
		labDelivery: null,
		trackingOut: null,
		trackingBack: null,
		devCostCents: null,
		printsIncluded: false,
		printsCostCents: null,
		devNotes: null,
		negativesAt: null,
		publicRollId: null,
		notes: null,
		rewoundAtFrame: null,
		frameCount: 0,
		shareExposure: false,
		sharePlace: null,
		shareNotes: false,
		firstScanFrame: 1,
		...o,
	}) as RollView;

describe('pipeline', () => {
	it('quantiles interpolate between ranks', () => {
		expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
		expect(quantile([10], 0.25)).toBe(10);
		expect(quantile([], 0.5)).toBeNull();
	});

	it('spreads report median and the middle half', () => {
		expect(spread([2, 4, 6, 8, 100])).toEqual({ n: 5, median: 6, lo: 4, hi: 8, min: 2, max: 100 });
		expect(spread([])).toBeNull();
	});

	it('the average roll measures each leg only where both ends are dated', () => {
		const ms = {
			a: { camera: '2026-10-01', shot: '2026-10-11', lab: '2026-10-13', scanned: '2026-10-20' },
			b: { camera: '2026-10-05', shot: '2026-10-25' },
			c: { shot: '2026-10-01', lab: '2026-09-30' }, // backwards: ignored
		};
		const legs = averageRoll(ms);
		expect(legs.camera).toMatchObject({ n: 2, median: 15 });
		expect(legs.waiting).toMatchObject({ n: 1, median: 2 });
		expect(legs.lab).toMatchObject({ n: 1, median: 7 });
		expect(legs.filing).toBeNull();
	});

	it('segments run to today for the stage a roll is in', () => {
		const r = roll({ id: 'r1', status: 'lab', statusOn: '2026-10-13' });
		const s = segments(r, { r1: { camera: '2026-10-01', shot: '2026-10-11', lab: '2026-10-13' } }, '2026-10-20');
		expect(s.map((x) => [x.stage, x.from, x.to])).toEqual([
			['camera', '2026-10-01', '2026-10-11'],
			['shot', '2026-10-11', '2026-10-13'],
			['lab', '2026-10-13', '2026-10-20'],
		]);
	});

	it('backlog counts rolls waiting each week', () => {
		const r = roll({ id: 'r1', status: 'lab', statusOn: '2026-10-08' });
		const weeks = backlogByWeek([r], { r1: { shot: '2026-10-01', lab: '2026-10-08' } }, '2026-10-01', '2026-10-15');
		expect(weeks.map((w) => [w.week, w.counts.shot, w.counts.lab])).toEqual([
			['2026-10-01', 1, 0],
			['2026-10-08', 0, 1],
			['2026-10-15', 0, 0],
		]);
	});
});

describe('labs', () => {
	it('turnaround per lab, and when a roll sent today comes back', () => {
		const rolls = [roll({ id: 'a' }), roll({ id: 'b' }), roll({ id: 'c', lab: { id: 'l2', name: 'Other' } })];
		const ms = { a: { lab: '2026-10-01', scanned: '2026-10-07' }, b: { lab: '2026-10-01', scanned: '2026-10-11' }, c: { lab: '2026-10-01', scanned: '2026-10-03' } };
		const t = turnarounds(rolls, ms);
		expect(t.l1).toMatchObject({ n: 2, median: 8, lo: 7, hi: 9 });
		const w = returnWindow('2026-11-01', t.l1, '2026-11-05')!;
		expect(w).toMatchObject({ from: '2026-11-08', to: '2026-11-10', day: 4, usual: 8, late: false });
		expect(w.text).toBe('Nov 8–10');
		expect(returnWindow('2026-11-01', t.l1, '2026-11-20')!.late).toBe(true);
	});

	it('one timed roll gives an "around" date, not a range', () => {
		const w = returnWindow('2026-11-01', spread([5]), '2026-11-01')!;
		expect(w.text).toBe('around Nov 6');
	});
});

describe('keepers', () => {
	it('Wilson intervals are wide for small samples', () => {
		const [lo, hi] = wilson(5, 9);
		expect(lo).toBeGreaterThan(0.25);
		expect(hi).toBeLessThan(0.82);
		expect(hi - lo).toBeGreaterThan(0.45);
		expect(wilson(0, 0)).toEqual([0, 0]);
	});

	const facts: ScanFact[] = [
		...Array.from({ length: 20 }, (_, i) => ({ roll: 'a', camera: 'x700', stock: 'p', lab: 'f', index: i + 1, count: 20, keeper: i < 10 })),
		...Array.from({ length: 20 }, (_, i) => ({ roll: 'b', camera: 'af1', stock: 'p', lab: 'f', index: i + 1, count: 20, keeper: i < 2 })),
		...Array.from({ length: 5 }, (_, i) => ({ roll: 'c', camera: 'tiny', stock: 'p', lab: 'f', index: i + 1, count: 5, keeper: true })),
	];

	it('hit rates rank groups and leave out tiny ones', () => {
		const r = hitRates(facts, (s) => s.camera);
		expect(r.map((x) => [x.key, x.k, x.n, x.rate])).toEqual([
			['x700', 10, 20, 0.5],
			['af1', 2, 20, 0.1],
		]);
	});

	it('position buckets go by strips of six', () => {
		const p = byPosition(facts);
		expect(p[0]).toMatchObject({ label: '1–6', n: 17 });
		expect(p.reduce((t, x) => t + x.n, 0)).toBe(45);
	});
});

describe('exposure on the same film', () => {
	it('a camera isn’t blamed for its film being flat (the confound)', () => {
		// Camera A only shoots a flat-scanning film; camera B shoots both. On the same film, A matches B.
		const scans: DeskScan[] = [];
		const add = (camera: string, stock: string, black: number, n: number) => {
			for (let i = 0; i < n; i++) scans.push({ roll: `${camera}-${stock}`, developed: '2026-10-01', camera, stock, lab: 'f', tone: [black, 0.4, 0.95] });
		};
		add('A', 'flat', 0.2, 30);
		add('B', 'flat', 0.2, 30);
		add('B', 'punchy', 0.03, 30);
		const groups = toneGroups(scans, 'camera', (k) => k);
		const a = groups.find((g) => g.key === 'A')!;
		expect(a.medianBlack).toBe(0.2);
		expect(a.lift).toBe(0); // no lift once compared on the same film
	});
});

describe('film for the light', () => {
	it('the hand-held window shifts a stop per doubling of speed', () => {
		const [lo100] = windowFor(100);
		const [lo400] = windowFor(400);
		expect(Math.round((lo100 - lo400) * 100) / 100).toBe(2);
	});

	it('counts frames too dim for their film, and finds the speed that fits', () => {
		const frames = [...Array.from({ length: 10 }, () => ({ ev: 6, iso: 100 })), ...Array.from({ length: 10 }, () => ({ ev: 12, iso: 100 }))];
		const [fit] = speedFits(frames);
		expect(fit).toMatchObject({ iso: 100, n: 20, under: 0.5, over: 0 });
		// ISO 200 is the slowest film that keeps both groups hand-holdable (slower wins a tie: finer grain).
		expect(bestSpeed(frames)?.iso).toBe(200);
		expect(bestSpeed(frames.slice(0, 5))).toBeNull();
	});
});

describe('money', () => {
	it('film counts when bought, the lab when sent, and the year is projected', () => {
		const rolls = [
			roll({ id: 'a', purchasedOn: '2026-09-02', priceCents: 1500, devCostCents: 1800, printsCostCents: 500 }),
			roll({ id: 'b', purchasedOn: '2026-10-02', priceCents: 1000, devCostCents: 1800, printsIncluded: true, printsCostCents: 900 }),
		];
		const ms = { a: { lab: '2026-10-10' }, b: { lab: '2026-11-01' } };
		const m = money(rolls, ms, '2026-11-09', { a: 36, b: 24 })!;
		expect(m.months.map((x) => [x.month, x.film, x.lab])).toEqual([
			['2026-09', 1500, 0],
			['2026-10', 1000, 2300],
			['2026-11', 0, 1800],
		]);
		expect(m.thisYear).toBe(6600);
		expect(m.perMonth).toBe(2200);
		expect(m.projection).toBe(6600 + 2200);
		expect(m.perFrame[0]).toMatchObject({ cents: Math.round(6600 / 60), rolls: 2 });
	});
});

describe('rhythm and shelf life', () => {
	it('hours are counted where the frame was taken', () => {
		// 23:30 UTC on Nov 1 is 7:30 pm in New York (−240).
		const r = rhythm([{ shotAt: Date.UTC(2026, 10, 1, 23, 30), tzOffset: -240 }], [], {}, '2026-11-09');
		expect(r.hours[19]).toBe(1);
		expect(r.weekdays[0]).toBe(1);
	});

	it('flags rolls you’d reach after their date', () => {
		const rolls = [roll({ id: 'a', status: 'storage', expires: '2026-12' }), roll({ id: 'b', status: 'storage', expires: '2027-12' })];
		const rows = shelf(rolls, { s1: { perMonth: 0.5, onHand: 2, monthsLeft: 4, late: [] } }, '2026-11-09');
		expect(rows.map((r) => [r.code, r.late])).toEqual([
			['A', false],
			['B', false],
		]);
		const slow = shelf(rolls, { s1: { perMonth: 0.2, onHand: 2, monthsLeft: 10, late: [] } }, '2026-11-09');
		expect(slow[0].late).toBe(true);
	});
});

describe('nudges', () => {
	it('rank a lab running late, then a long wait, above a roll nearly done', () => {
		const today = '2026-11-09';
		const rolls = [
			roll({ id: 'w', status: 'shot', statusOn: '2026-10-20' }),
			roll({ id: 'l', status: 'lab', statusOn: '2026-10-20' }),
			roll({ id: 'c', status: 'camera', statusOn: '2026-11-01', frameCount: 35 }),
		];
		const n = nudges({ rolls, today, turnaround: { l1: spread([6, 7, 8])! }, forecast: { byStock: {}, monthsOfFilm: null }, canLink: false, passkeys: 2 });
		expect(n.map((x) => x.key)).toEqual(['late-l', 'send-w', 'finish-c']);
		expect(n[0].text).toMatch(/at Fotoshoppe 20 days; it usually takes 7/);
		expect(n[1].text).toMatch(/W has waited 20 days/);
	});
});
