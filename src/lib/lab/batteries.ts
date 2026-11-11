/**
 * The battery box: spare cells on hand by type, the cameras that eat them,
 * and when each camera's set is getting old. Pure, so the Kit page, the
 * bench's Today card and the trip planner agree (and it's testable).
 */
import { batteryLabel, batteryOf, daysBetween } from './inventory';

export interface BatteryStockRow {
	/** Box key, as batteryKey() makes it ("LR44"). */
	type: string;
	onHand: number;
}

export interface BatteryCamera {
	id: string;
	name: string;
	battery: string | null;
	batteryChangedOn: string | null;
	status: string;
}

/** Most meters and motors run a year or two on a set; past this it's worth a fresh one before anything important. */
export const OLD_MONTHS = 18;

export interface CameraBattery {
	cameraId: string;
	name: string;
	/** Box key and cells per set; null when the camera's battery isn't written down. */
	key: string | null;
	cells: number;
	/** Months since the set went in; null when not known. */
	months: number | null;
	old: boolean;
}

export interface BoxRow {
	type: string;
	label: string;
	onHand: number;
	/** Cameras that take it (in use), cells each. */
	cameras: CameraBattery[];
	/** Full sets the box covers for the hungriest camera that takes it. */
	sets: number;
	/** A camera that takes it is due (old set) and the box can't cover it. */
	short: boolean;
}

const monthsSince = (day: string, today: string) => Math.max(0, Math.round(daysBetween(day, today) / 30.4));

/** Each camera's battery as the box sees it (cameras sold or wished for are left out). */
export function cameraBatteries(cameras: BatteryCamera[], today: string): CameraBattery[] {
	return cameras
		.filter((c) => c.status !== 'gone' && c.status !== 'wishlist')
		.map((c) => {
			const b = batteryOf(c.battery);
			const months = c.batteryChangedOn ? monthsSince(c.batteryChangedOn, today) : null;
			return { cameraId: c.id, name: c.name, key: b?.key ?? null, cells: b?.count ?? 0, months, old: months != null && months >= OLD_MONTHS };
		});
}

/** The box, one row per battery type someone has or needs, the ones in use first. */
export function batteryBox(cameras: BatteryCamera[], stock: BatteryStockRow[], today: string): BoxRow[] {
	const per = cameraBatteries(cameras, today);
	const types = new Set([...per.map((c) => c.key).filter((k): k is string => !!k), ...stock.map((s) => s.type)]);
	return [...types]
		.map((type) => {
			const onHand = stock.find((s) => s.type === type)?.onHand ?? 0;
			const takes = per.filter((c) => c.key === type);
			const most = Math.max(0, ...takes.map((c) => c.cells));
			return {
				type,
				label: batteryLabel(type),
				onHand,
				cameras: takes,
				sets: most ? Math.floor(onHand / most) : 0,
				short: takes.some((c) => c.old && onHand < c.cells),
			};
		})
		.sort((a, b) => b.cameras.length - a.cameras.length || a.type.localeCompare(b.type));
}

/** What to buy: per type, cells to cover one fresh set for every camera due within `months` (plus one spare set). */
export function shoppingList(box: BoxRow[]): { type: string; label: string; need: number }[] {
	return box
		.map((row) => {
			const due = row.cameras.filter((c) => c.old || c.months == null);
			const want = due.reduce((s, c) => s + c.cells, 0) + Math.max(0, ...row.cameras.map((c) => c.cells));
			return { type: row.type, label: row.label, need: Math.max(0, want - row.onHand) };
		})
		.filter((r) => r.need > 0 && r.need < 50);
}
