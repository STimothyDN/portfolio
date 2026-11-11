/** The darkroom's reads: saved recipes, chemistry batches, and rolls developed at home. */
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

import type { ChemistryView, RecipeSpec } from '../darkroom';
import type { LabDb } from './db/client';
import { chemistry, devRecipe, lab, roll, trip } from './db/schema';

export interface SavedRecipe extends RecipeSpec {
	id: string;
	name: string;
}

export async function listRecipes(d: LabDb, userId: string): Promise<SavedRecipe[]> {
	const rows = await d.select().from(devRecipe).where(eq(devRecipe.userId, userId)).orderBy(asc(devRecipe.name));
	return rows.flatMap((r) => {
		try {
			return [{ ...(JSON.parse(r.spec) as RecipeSpec), id: r.id, name: r.name }];
		} catch {
			return [];
		}
	});
}

export async function listChemistry(d: LabDb, userId: string): Promise<ChemistryView[]> {
	const rows = await d.select().from(chemistry).where(eq(chemistry.userId, userId)).orderBy(desc(chemistry.mixedOn));
	return rows.map(({ userId: _u, createdAt: _c, ...c }) => c);
}

/** The home darkroom "lab", made the first time a roll is developed at home. */
export async function homeLabId(d: LabDb, userId: string, create = true): Promise<string | null> {
	const [row] = await d.select({ id: lab.id }).from(lab).where(and(eq(lab.userId, userId), eq(lab.home, true))).limit(1);
	if (row || !create) return row?.id ?? null;
	const id = crypto.randomUUID();
	await d.insert(lab).values({ id, userId, name: 'Home darkroom', home: true, notes: 'Your own tank and chemistry.' });
	return id;
}

/** Rolls with a development run recorded (newest first). */
export async function developedAtHome(d: LabDb, userId: string) {
	return d
		.select({ id: roll.id, code: roll.code, devRun: roll.devRun, statusOn: roll.statusOn })
		.from(roll)
		.where(and(eq(roll.userId, userId), isNotNull(roll.devRun)))
		.orderBy(desc(roll.statusOn))
		.limit(40);
}

/* ---------- trips (the trip planner shares this module: both plan time away from the bench) ---------- */

export interface TripView {
	id: string;
	name: string;
	place: string | null;
	lat: number | null;
	lng: number | null;
	startOn: string;
	endOn: string;
	plan: string;
}

export async function listTrips(d: LabDb, userId: string): Promise<TripView[]> {
	const rows = await d.select().from(trip).where(eq(trip.userId, userId)).orderBy(desc(trip.startOn));
	return rows.map(({ userId: _u, createdAt: _c, updatedAt: _m, ...t }) => t);
}
