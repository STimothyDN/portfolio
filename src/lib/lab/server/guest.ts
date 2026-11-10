/**
 * The guest view: anyone signed out can look round the owner's lab, live and
 * read-only. The middleware sets `locals.guest` to the owner (never
 * `locals.user`, so every write action still refuses: they check
 * `locals.user`). Pages read with `viewerOf(locals)`, and everything they hand
 * to the browser goes through `forGuest()`, which takes out what the owner
 * keeps private: where frames were taken, and tracking and lab order numbers.
 */
import { eq } from 'drizzle-orm';

import type { LabConfig } from './config';
import type { LabUser } from './auth';
import { getDb } from './db/client';
import { user } from './db/schema';

/** Pages a guest may read. Shooting mode, labels, the account and the doors are for people signed in. */
export const GUEST_PAGES = /^\/photography\/lab(?:\/(?:fridge|gear|labs|frames|almanac|rolls(?:\/[^/]+)?|r\/[^/]+))?\/?$/;

let cached: { at: number; owner: LabUser | null } | null = null;

/** The lab's owner (whose lab guests see), cached for a few minutes per server instance. */
export async function guestOwner(config: LabConfig): Promise<LabUser | null> {
	// Locally the logbook gets reset under the server (tests), so don't trust a cache there.
	if (cached && !import.meta.env.DEV && Date.now() - cached.at < 5 * 60_000) return cached.owner;
	const d = await getDb(config);
	const [row] = await d.select().from(user).where(eq(user.role, 'owner')).limit(1);
	const owner = (row as unknown as LabUser | undefined) ?? null;
	// No owner yet (a fresh deployment): ask again next time.
	if (owner) cached = { at: Date.now(), owner };
	return owner;
}

/** Whose lab this page shows, and whether it's a guest looking. */
export function viewerOf(locals: App.Locals): { user: LabUser | null; guest: boolean } {
	if (locals.user) return { user: locals.user, guest: false };
	return { user: locals.guest ?? null, guest: !!locals.guest };
}

/** Fields a guest never sees, wherever they turn up in a page's data. */
const PRIVATE = new Set(['lat', 'lng', 'accuracy', 'trackingOut', 'trackingBack', 'labOrder']);

/** A deep copy of a page's data with the owner's private fields blanked (null). */
export function forGuest<T>(data: T): T {
	const walk = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object' && !(v instanceof Date)) {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v)) out[k] = PRIVATE.has(k) ? null : walk(x);
			return out;
		}
		return v;
	};
	return walk(data) as T;
}

/** For pages: the data as this viewer may see it. */
export const visible = <T>(data: T, guest: boolean): T => (guest ? forGuest(data) : data);
