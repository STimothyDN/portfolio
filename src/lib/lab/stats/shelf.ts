/**
 * Shelf life: each roll in the fridge, the month it expires, and roughly when
 * you'd reach it at the rate you load that film (oldest-dated first). The
 * ones you'd reach after their date are the ones to shoot next, or give away.
 */
import { addDays, type StockForecast } from '../pace';
import type { RollView } from '../inventory';

export interface ShelfRow {
	id: string;
	code: string;
	stock: string;
	stockId: string;
	/** Last day of the expiry month. */
	expires: string;
	/** When you'd load it at the current pace (null if that film isn't being loaded). */
	reach: string | null;
	late: boolean;
	expired: boolean;
}

const endOfMonth = (ym: string) => {
	const [y, m] = ym.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function shelf(rolls: RollView[], forecast: Record<string, StockForecast>, today: string): ShelfRow[] {
	const out: ShelfRow[] = [];
	const byStock = new Map<string, RollView[]>();
	for (const r of rolls) {
		if (r.status !== 'storage' || !r.expires) continue;
		const g = byStock.get(r.stock.id);
		if (g) g.push(r);
		else byStock.set(r.stock.id, [r]);
	}
	for (const [stockId, list] of byStock) {
		list.sort((a, b) => a.expires!.localeCompare(b.expires!));
		const perMonth = forecast[stockId]?.perMonth ?? 0;
		list.forEach((r, i) => {
			const expires = endOfMonth(r.expires!);
			const reach = perMonth ? addDays(today, ((i + 0.5) / perMonth) * 30.44) : null;
			out.push({ id: r.id, code: r.code, stock: r.stock.name, stockId, expires, reach, late: !!reach && reach > expires, expired: expires < today });
		});
	}
	return out.sort((a, b) => a.expires.localeCompare(b.expires));
}
