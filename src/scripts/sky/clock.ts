/**
 * The sky's clock: real time, optionally shifted. A page URL with
 * `?at=<ISO time>` (e.g. ?at=2026-10-23T22:20:00Z) moves the whole sky —
 * stars, Sun, shadows, readout — to that moment and lets it run on from
 * there, for previewing golden hour or noon without waiting for it. The
 * worker gets the offset from the page (see index.ts).
 */
export const clock = { offset: 0 };

export const skyNow = () => Date.now() + clock.offset;

/** Read ?at= from the current page URL (main thread only). */
export function syncClockFromUrl() {
	const at = new URLSearchParams(location.search).get('at');
	const target = at ? Date.parse(at) : NaN;
	clock.offset = Number.isFinite(target) ? target - Date.now() : 0;
	return clock.offset;
}
