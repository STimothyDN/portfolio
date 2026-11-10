/**
 * Kit: whether each camera and lens earns its place. Per camera: rolls shot,
 * frames back, frames lost per roll (exposures the lab didn't scan), days
 * sitting empty now, what a roll through it cost, and its scans' density on
 * the same film against your other cameras. Per lens: the apertures you use.
 */
import type { Milestones } from '../almanac';
import { median } from '../almanac';
import { daysBetween, type RollView } from '../inventory';

export interface CameraKit {
	id: string;
	name: string;
	rolls: number;
	frames: number;
	/** Median exposures per roll that didn't come back as scans (linked rolls only). */
	lost: number | null;
	idle: number | null;
	loaded: boolean;
	costPerRoll: number | null;
	/** Same-film black-point lift against other cameras (×100), from the desk's tone. */
	lift: number | null;
	liftN: number;
}

export function cameraKit(
	cameras: { id: string; name: string; token: string | null; status: string }[],
	rolls: RollView[],
	ms: Milestones,
	today: string,
	scans: Record<string, number>,
	lift: Record<string, { lift: number | null; compared: number }> = {}
): CameraKit[] {
	return cameras
		.filter((c) => c.status !== 'wishlist')
		.map((c) => {
			const own = rolls.filter((r) => r.camera?.id === c.id && r.status !== 'storage');
			const linked = own.filter((r) => scans[r.id] != null);
			const lastOut = own.map((r) => ms[r.id]?.shot).filter((d): d is string => !!d).sort().at(-1) ?? null;
			const loaded = own.some((r) => r.status === 'camera');
			const costs = own.map((r) => (r.priceCents != null && r.devCostCents != null ? r.priceCents + r.devCostCents : null)).filter((v): v is number => v != null);
			const l = c.token ? lift[c.token] : undefined;
			return {
				id: c.id,
				name: c.name,
				rolls: own.length,
				frames: own.reduce((t, r) => t + (scans[r.id] ?? r.frameCount), 0),
				lost: linked.length ? median(linked.map((r) => Math.max(0, r.exposures - scans[r.id]))) : null,
				idle: loaded || !lastOut ? null : daysBetween(lastOut, today),
				loaded,
				costPerRoll: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) / costs.length) : null,
				lift: l?.lift != null ? Math.round(l.lift * 100) : null,
				liftN: l?.compared ?? 0,
			};
		})
		.filter((c) => c.rolls > 0)
		.sort((a, b) => b.rolls - a.rolls);
}

/** How often each aperture was set, per lens (frames with a lens and an aperture). */
export function lensApertures(frames: { lensId: string | null; aperture: number | null }[], lenses: { id: string; name: string }[]): { id: string; name: string; n: number; stops: { f: number; n: number }[] }[] {
	return lenses
		.map((l) => {
			const own = frames.filter((f) => f.lensId === l.id && f.aperture != null);
			const counts = new Map<number, number>();
			for (const f of own) counts.set(f.aperture!, (counts.get(f.aperture!) ?? 0) + 1);
			return { id: l.id, name: l.name, n: own.length, stops: [...counts].sort((a, b) => a[0] - b[0]).map(([f, n]) => ({ f, n })) };
		})
		.filter((l) => l.n > 0);
}
