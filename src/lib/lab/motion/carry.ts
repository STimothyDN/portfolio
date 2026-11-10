/**
 * Carrying an object from one place on the bench to another, across a change
 * of shape: a canister in the fridge becomes film in a camera, a canister in
 * the tray becomes an envelope. Before the state changes, `snapshot` copies
 * the object as it looks now; after the new one renders, `land` flies the copy
 * along an arc onto it and hands over (the copy fades as the new one appears),
 * so the roll keeps its identity through the move.
 *
 * Plain WAAPI on a fixed-position clone: nothing here waits on the server, and
 * under "reduce motion" it's a fade.
 */

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Snapshot {
	clone: HTMLElement;
	rect: DOMRect;
}

/** A detached, fixed-position copy of an element at its current place on screen. */
export function ghostOf(el: HTMLElement, rect = el.getBoundingClientRect()): HTMLElement {
	const clone = el.cloneNode(true) as HTMLElement;
	clone.removeAttribute('id');
	clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
	clone.setAttribute('aria-hidden', 'true');
	clone.classList.add('lab-ghost');
	Object.assign(clone.style, {
		position: 'fixed',
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
		margin: '0',
		zIndex: '90',
		pointerEvents: 'none',
		transformOrigin: '50% 50%',
		boxSizing: 'border-box',
	});
	// Keep the look that came from where it sat (custom properties set by ancestors).
	const cs = getComputedStyle(el);
	for (const prop of ['--can', '--can-ink', '--can-h', '--c', '--c-ink']) {
		const v = cs.getPropertyValue(prop);
		if (v) clone.style.setProperty(prop, v);
	}
	return clone;
}

/** Copy the object for roll `id` (an element with data-roll) as it looks now. */
export function snapshot(root: ParentNode | null, id: string): Snapshot | null {
	const el = root?.querySelector<HTMLElement>(`[data-roll="${CSS.escape(id)}"]`);
	if (!el) return null;
	const rect = el.getBoundingClientRect();
	if (!rect.width || !rect.height) return null;
	return { clone: ghostOf(el, rect), rect };
}

export interface LandOptions {
	/** Height of the arc's peak above the straight path, px. */
	arc?: number;
	duration?: number;
	/** Turn on the way (degrees), like a canister tossed. */
	spin?: number;
	/** Class added to the new element once the copy has handed over (runs its arrival flourish). */
	arrive?: string;
}

/**
 * Fly a snapshot (or a ghost already on screen, from a drag) onto `to`, the
 * object's new shape, then remove the copy. Resolves when it has landed.
 */
export async function land(from: Snapshot | { clone: HTMLElement; rect: DOMRect }, to: HTMLElement | null, opts: LandOptions = {}): Promise<void> {
	const { clone, rect: a } = from;
	if (!to) {
		clone.remove();
		return;
	}
	const arrive = () => {
		if (!opts.arrive) return;
		to.classList.remove(opts.arrive);
		void to.offsetWidth;
		to.classList.add(opts.arrive);
		setTimeout(() => to.classList.remove(opts.arrive!), 1600);
	};
	if (reducedMotion()) {
		clone.remove();
		to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
		arrive();
		return;
	}
	if (!clone.isConnected) document.body.append(clone);
	const b = to.getBoundingClientRect();
	const dx = b.left + b.width / 2 - (a.left + a.width / 2);
	const dy = b.top + b.height / 2 - (a.top + a.height / 2);
	const sx = b.width / Math.max(1, a.width);
	const sy = b.height / Math.max(1, a.height);
	// Same-size objects keep their proportions in flight; different shapes meet halfway.
	const s = Math.sqrt(sx * sy);
	const dist = Math.hypot(dx, dy);
	const arc = opts.arc ?? Math.min(140, 30 + dist * 0.18);
	const duration = opts.duration ?? Math.round(Math.min(820, 420 + dist * 0.35));
	const spin = opts.spin ?? 0;
	to.style.opacity = '0';
	const flight = clone.animate(
		[
			{ translate: '0 0', scale: '1', rotate: '0deg', opacity: 1, offset: 0 },
			{ translate: `${dx * 0.5}px ${dy * 0.5 - arc}px`, scale: `${(1 + s) / 2 + 0.06}`, rotate: `${spin * 0.6}deg`, opacity: 1, offset: 0.5 },
			{ translate: `${dx}px ${dy}px`, scale: `${s}`, rotate: `${spin}deg`, opacity: 1, offset: 0.82 },
			{ translate: `${dx}px ${dy}px`, scale: `${s}`, rotate: `${spin}deg`, opacity: 0, offset: 1 },
		],
		{ duration, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' }
	);
	// The new shape takes over in the last stretch.
	const handover = to.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration, easing: 'linear', fill: 'forwards' });
	try {
		await flight.finished;
	} catch {
		// Cancelled (the element went away): fine.
	}
	clone.remove();
	to.style.opacity = '';
	handover.cancel();
	arrive();
}

/** A ghost that didn't find a home flies back to where it was picked up. */
export async function returnHome(clone: HTMLElement, home: DOMRect): Promise<void> {
	if (reducedMotion()) {
		clone.remove();
		return;
	}
	const now = clone.getBoundingClientRect();
	const anim = clone.animate(
		[
			{ left: `${now.left}px`, top: `${now.top}px`, rotate: getComputedStyle(clone).rotate },
			{ left: `${home.left}px`, top: `${home.top}px`, rotate: '0deg' },
		],
		{ duration: 340, easing: 'cubic-bezier(0.3, 1.2, 0.5, 1)', fill: 'forwards' }
	);
	try {
		await anim.finished;
	} catch {
		// Fine.
	}
	clone.remove();
}
