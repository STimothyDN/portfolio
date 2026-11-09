/**
 * Tracking status for the numbers on a page, asked for after it loads (so a
 * page never waits on the tracking service). Cached on the server; with no
 * service set up, numbers still link to their carrier.
 */
import { actions } from 'astro:actions';
import { onMounted, ref } from 'vue';

import type { TrackView } from './tracking';

export function useTracks(numbers: () => (string | null | undefined)[]) {
	const tracks = ref<Record<string, TrackView>>({});
	const live = ref(false);
	async function refresh() {
		const list = [...new Set(numbers().filter((n): n is string => !!n))].slice(0, 20);
		if (!list.length) return;
		try {
			const { data } = await actions.lab.trackShipments({ numbers: list });
			if (data) {
				tracks.value = { ...tracks.value, ...data.tracks };
				live.value = data.live;
			}
		} catch {
			// Offline or refused: the carrier links still work.
		}
	}
	onMounted(refresh);
	return { tracks, live, refresh };
}
