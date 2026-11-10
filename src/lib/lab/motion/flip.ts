/**
 * Things on the bench shuffle the way paper does: measure every object
 * (`[data-roll]` by default), apply the change, then slide each one from where
 * it was to where it lands (FLIP). New ones fade up; ones that left are
 * someone else's business (carry.ts flies them).
 */
import { nextTick } from 'vue';

import { reducedMotion } from './carry';

export async function flip(root: HTMLElement | null, mutate: () => void, selector = '[data-roll]', skip?: Set<string>): Promise<void> {
	if (!root || reducedMotion()) {
		mutate();
		return;
	}
	const key = (el: HTMLElement) => el.dataset.roll ?? el.dataset.key ?? '';
	const before = new Map<string, DOMRect>();
	for (const el of root.querySelectorAll<HTMLElement>(selector)) before.set(key(el), el.getBoundingClientRect());
	mutate();
	await nextTick();
	for (const el of root.querySelectorAll<HTMLElement>(selector)) {
		const k = key(el);
		if (skip?.has(k)) continue;
		const was = before.get(k);
		if (!was) {
			el.animate([{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }], { duration: 320, easing: 'ease-out' });
			continue;
		}
		const now = el.getBoundingClientRect();
		const dx = was.left - now.left;
		const dy = was.top - now.top;
		if (Math.abs(dx) + Math.abs(dy) > 1) {
			el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
		}
	}
}
