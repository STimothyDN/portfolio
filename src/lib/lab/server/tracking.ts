/**
 * Live tracking status from 17TRACK (https://api.17track.net, v2.4), when
 * TRACKING_17TRACK_KEY is set. Each number is registered once (that's what
 * uses one of the account's tracking credits), then asked about at most every
 * two hours until it's delivered. Answers are kept in the `shipment` table, so
 * pages never wait on 17TRACK: the lab asks for fresh ones after it loads.
 */
import { and, eq, inArray, or } from 'drizzle-orm';

import type { TrackView } from '../tracking';
import type { LabDb } from './db/client';
import { roll, shipment } from './db/schema';

const API = 'https://api.17track.net/track/v2.4';
const FRESH_MS = 2 * 3_600_000;
const TIMEOUT_MS = 8000;
/** 17TRACK: "already registered" (so it's tracked either way). */
const ALREADY_REGISTERED = -18019901;

interface Accepted {
	number: string;
	carrier?: number;
	track_info?: {
		latest_status?: { status?: string | null };
		latest_event?: {
			description?: string | null;
			location?: string | null;
			time_iso?: string | null;
			time_utc?: string | null;
			address?: { city?: string | null; state?: string | null; country?: string | null } | null;
		} | null;
	};
}
interface Rejected {
	number: string;
	error?: { code?: number; message?: string };
}

async function call(key: string, path: 'register' | 'gettrackinfo', numbers: string[]) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${API}/${path}`, {
			method: 'POST',
			headers: { '17token': key, 'content-type': 'application/json' },
			body: JSON.stringify(numbers.map((number) => ({ number }))),
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as { code?: number; data?: { accepted?: Accepted[]; rejected?: Rejected[] } };
		if (body.code !== 0) throw new Error(`code ${body.code}`);
		return { accepted: body.data?.accepted ?? [], rejected: body.data?.rejected ?? [] };
	} finally {
		clearTimeout(timer);
	}
}

/** Only numbers on this person's own rolls get looked up: each one costs a credit. */
export async function ownNumbers(d: LabDb, userId: string, numbers: string[]): Promise<string[]> {
	if (!numbers.length) return [];
	const rows = await d
		.select({ out: roll.trackingOut, back: roll.trackingBack })
		.from(roll)
		.where(and(eq(roll.userId, userId), or(inArray(roll.trackingOut, numbers), inArray(roll.trackingBack, numbers))));
	const mine = new Set(rows.flatMap((r) => [r.out, r.back]).filter((n): n is string => !!n));
	return numbers.filter((n) => mine.has(n));
}

const toView = (r: typeof shipment.$inferSelect): TrackView => ({
	status: r.status,
	detail: r.detail,
	location: r.location,
	eventAt: r.eventAt ? r.eventAt.getTime() : null,
	checkedAt: r.checkedAt.getTime(),
});

/** The latest on each number: from the cache, refreshed from 17TRACK where it's stale. */
export async function trackNumbers(d: LabDb, userId: string, numbers: string[], key: string | undefined): Promise<Record<string, TrackView>> {
	if (!numbers.length) return {};
	const rows = await d
		.select()
		.from(shipment)
		.where(and(eq(shipment.userId, userId), inArray(shipment.number, numbers)));
	const known = new Map(rows.map((r) => [r.number, r]));
	const now = Date.now();
	const stale = numbers.filter((n) => {
		const r = known.get(n);
		return !r || (r.status !== 'Delivered' && now - r.checkedAt.getTime() > FRESH_MS);
	});

	if (key && stale.length) {
		try {
			const registered = new Set(stale.filter((n) => known.get(n)?.registered));
			const unregistered = stale.filter((n) => !registered.has(n));
			if (unregistered.length) {
				const reg = await call(key, 'register', unregistered.slice(0, 40));
				for (const a of reg.accepted) registered.add(a.number);
				for (const r of reg.rejected) if (r.error?.code === ALREADY_REGISTERED) registered.add(r.number);
			}
			const info = await call(key, 'gettrackinfo', stale.slice(0, 40));
			const checkedAt = new Date();
			const writes = [
				...info.accepted.map((a) => {
					const ev = a.track_info?.latest_event ?? null;
					const place = ev?.location || [ev?.address?.city, ev?.address?.state].filter(Boolean).join(', ') || null;
					const when = ev?.time_utc ?? ev?.time_iso ?? null;
					const values = {
						carrier: a.carrier ?? null,
						status: a.track_info?.latest_status?.status ?? null,
						detail: ev?.description ?? null,
						location: place,
						eventAt: when && !Number.isNaN(Date.parse(when)) ? new Date(when) : null,
						registered: true,
						checkedAt,
					};
					return d
						.insert(shipment)
						.values({ userId, number: a.number, ...values })
						.onConflictDoUpdate({ target: [shipment.userId, shipment.number], set: values });
				}),
				// Not found yet (or not trackable): remember we asked, so it isn't asked again right away.
				...info.rejected.map((r) =>
					d
						.insert(shipment)
						.values({ userId, number: r.number, registered: registered.has(r.number), checkedAt })
						.onConflictDoUpdate({ target: [shipment.userId, shipment.number], set: { registered: registered.has(r.number), checkedAt } })
				),
			];
			if (writes.length) await d.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
		} catch (e) {
			console.warn(`[film lab] Tracking lookup failed (${(e as Error).message}); showing the last known status.`);
		}
	}

	const fresh = await d
		.select()
		.from(shipment)
		.where(and(eq(shipment.userId, userId), inArray(shipment.number, numbers)));
	return Object.fromEntries(fresh.map((r) => [r.number, toView(r)]));
}
