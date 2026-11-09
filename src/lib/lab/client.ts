/** Browser helpers for the lab's islands. */
import { isInputError } from 'astro:actions';

type Result<T> = { data?: T; error?: unknown };

/** Await an action and return its data, or throw an Error with a sentence for the page. */
export async function run<T>(call: Promise<Result<T>>): Promise<T> {
	const { data, error } = await call;
	if (error) {
		if (isInputError(error)) {
			const first = Object.values(error.fields).flat()[0];
			throw new Error(first ? String(first) : 'Some of those fields aren’t right.');
		}
		const e = error as { code?: string; message?: string };
		if (e.code === 'UNAUTHORIZED') throw new Error('Your session ended. Reload the page and sign in again.');
		throw new Error(e.message || 'Something went wrong. Try again.');
	}
	return data as T;
}

/** '' → null, else a number. For optional numeric inputs bound as strings. */
export const num = (v: string | number | null | undefined): number | null => {
	if (v === '' || v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Dollars as typed (string or number), for money inputs. */
export const dollars = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(cents % 100 ? 2 : 0));

/** Replace (or add) an item in a list by id, keeping order. */
export function upsert<T extends { id: string }>(list: T[], item: T, atStart = false): T[] {
	const i = list.findIndex((x) => x.id === item.id);
	if (i === -1) return atStart ? [item, ...list] : [...list, item];
	const copy = list.slice();
	copy[i] = item;
	return copy;
}
