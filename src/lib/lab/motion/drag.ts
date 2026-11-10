/**
 * Picking things up on the bench. Anything with `data-drag-kind` and
 * `data-drag-id` can be lifted: with a mouse, by moving it a few pixels; on a
 * touch screen, by pressing and holding (so a quick swipe still scrolls). A
 * ghost of it follows the pointer, swinging a little with the motion like
 * something held by a corner, and every place that would take it
 * (`data-drop-kind` / `data-drop-id`, as `accepts` decides) lights up. Let go
 * over one and `onDrop` gets the ghost to carry the rest of the way (carry.ts);
 * anywhere else it flies back.
 *
 * Every drag has a button twin in the markup: this is the fast path, not the
 * only one.
 */
import { ghostOf, reducedMotion, returnHome } from './carry';

export interface DragItem {
	kind: string;
	id: string;
	el: HTMLElement;
}

export interface DropTarget {
	kind: string;
	id: string;
	el: HTMLElement;
}

export interface Dropped {
	item: DragItem;
	target: DropTarget;
	/** The ghost, still on screen where it was let go: pass it to `land`, or remove it. */
	clone: HTMLElement;
	rect: DOMRect;
}

export interface DragOptions {
	root: HTMLElement;
	accepts: (item: DragItem, target: DropTarget) => boolean;
	onDrop: (drop: Dropped) => void;
	onLift?: (item: DragItem) => void;
	onEnd?: () => void;
}

const HOLD_MS = 320;
const SLOP = 6;

export function createDrag(opts: DragOptions): () => void {
	const { root } = opts;
	let press: { item: DragItem; pointerId: number; x: number; y: number; type: string; timer?: ReturnType<typeof setTimeout> } | null = null;
	let drag: {
		item: DragItem;
		pointerId: number;
		clone: HTMLElement;
		home: DOMRect;
		offX: number;
		offY: number;
		x: number;
		y: number;
		vx: number;
		t: number;
		over: DropTarget | null;
	} | null = null;
	let suppressClick = false;
	let raf = 0;

	const targetsFor = (item: DragItem) =>
		[...document.querySelectorAll<HTMLElement>('[data-drop-kind]')]
			.map((el) => ({ kind: el.dataset.dropKind!, id: el.dataset.dropId ?? '', el }))
			.filter((t) => opts.accepts(item, t));

	function lift(item: DragItem, pointerId: number, x: number, y: number) {
		const rect = item.el.getBoundingClientRect();
		const clone = ghostOf(item.el, rect);
		clone.classList.add('lab-ghost--held');
		document.body.append(clone);
		item.el.classList.add('is-lifted');
		document.documentElement.classList.add('lab-dragging');
		for (const t of targetsFor(item)) t.el.setAttribute('data-drop-ready', '');
		drag = { item, pointerId, clone, home: rect, offX: x - rect.left, offY: y - rect.top, x, y, vx: 0, t: performance.now(), over: null };
		suppressClick = true;
		if (press?.type !== 'mouse') navigator.vibrate?.(8);
		opts.onLift?.(item);
		if (!reducedMotion()) clone.animate([{ scale: '1' }, { scale: '1.06' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
		raf ||= requestAnimationFrame(edgeScroll);
	}

	function findTarget(x: number, y: number): DropTarget | null {
		if (!drag) return null;
		for (const el of document.elementsFromPoint(x, y)) {
			const host = (el as HTMLElement).closest?.<HTMLElement>('[data-drop-kind]');
			if (!host) continue;
			const t = { kind: host.dataset.dropKind!, id: host.dataset.dropId ?? '', el: host };
			if (opts.accepts(drag.item, t)) return t;
		}
		return null;
	}

	function move(x: number, y: number) {
		if (!drag) return;
		const now = performance.now();
		const dt = Math.max(8, now - drag.t) / 1000;
		drag.vx = drag.vx * 0.6 + ((x - drag.x) / dt) * 0.4;
		drag.x = x;
		drag.y = y;
		drag.t = now;
		drag.clone.style.left = `${x - drag.offX}px`;
		drag.clone.style.top = `${y - drag.offY}px`;
		if (!reducedMotion()) drag.clone.style.rotate = `${Math.max(-9, Math.min(9, drag.vx / 140))}deg`;
		const over = findTarget(x, y);
		if (over?.el !== drag.over?.el) {
			drag.over?.el.removeAttribute('data-drop-over');
			over?.el.setAttribute('data-drop-over', '');
			drag.over = over;
		}
	}

	/** Carried near the top or bottom of a scrolling page, the page follows (the body scrolls here). */
	function edgeScroll() {
		raf = 0;
		if (!drag) return;
		const E = 64;
		const h = innerHeight;
		const push = drag.y < E ? -(E - drag.y) / E : drag.y > h - E ? (drag.y - (h - E)) / E : 0;
		if (push) {
			document.body.scrollTop += push * 14;
			move(drag.x, drag.y);
		}
		raf = requestAnimationFrame(edgeScroll);
	}

	function finish(cancelled: boolean) {
		const d = drag;
		drag = null;
		cancelAnimationFrame(raf);
		raf = 0;
		document.documentElement.classList.remove('lab-dragging');
		document.querySelectorAll('[data-drop-ready],[data-drop-over]').forEach((el) => {
			el.removeAttribute('data-drop-ready');
			el.removeAttribute('data-drop-over');
		});
		if (!d) return;
		d.item.el.classList.remove('is-lifted');
		const target = cancelled ? null : d.over;
		if (target) {
			d.clone.classList.remove('lab-ghost--held');
			opts.onDrop({ item: d.item, target, clone: d.clone, rect: d.clone.getBoundingClientRect() });
		} else {
			void returnHome(d.clone, d.home);
		}
		opts.onEnd?.();
	}

	const itemFrom = (t: EventTarget | null): DragItem | null => {
		const el = (t as Element | null)?.closest?.<HTMLElement>('[data-drag-kind]');
		if (!el || !root.contains(el) || el.closest('[data-drag-off]')) return null;
		// Real controls inside an object (its own buttons, links, fields) keep their clicks.
		const control = (t as Element).closest('button, a, input, select, textarea, label');
		if (control && control !== el && el.contains(control)) return null;
		return { kind: el.dataset.dragKind!, id: el.dataset.dragId!, el };
	};

	function onDown(e: PointerEvent) {
		if (e.button !== 0 || drag) return;
		const item = itemFrom(e.target);
		if (!item) return;
		press = { item, pointerId: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
		if (e.pointerType !== 'mouse') {
			press.timer = setTimeout(() => {
				if (press) lift(press.item, press.pointerId, press.x, press.y);
			}, HOLD_MS);
		}
	}

	function onMove(e: PointerEvent) {
		if (drag && e.pointerId === drag.pointerId) {
			e.preventDefault();
			move(e.clientX, e.clientY);
			return;
		}
		if (!press || e.pointerId !== press.pointerId) return;
		const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP;
		if (!far) return;
		if (press.type === 'mouse') {
			lift(press.item, press.pointerId, press.x, press.y);
			move(e.clientX, e.clientY);
		}
		// A finger that moves before the hold is up is scrolling.
		clearTimeout(press.timer);
		press = null;
	}

	function onUp(e: PointerEvent) {
		if (press && e.pointerId === press.pointerId) {
			clearTimeout(press.timer);
			press = null;
		}
		if (drag && e.pointerId === drag.pointerId) finish(e.type === 'pointercancel');
	}

	// While something is held, the page mustn't scroll under the finger.
	const onTouchMove = (e: TouchEvent) => {
		if (drag) e.preventDefault();
	};
	const onClick = (e: MouseEvent) => {
		if (!suppressClick) return;
		suppressClick = false;
		e.preventDefault();
		e.stopPropagation();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && drag) finish(true);
	};
	const onContext = (e: Event) => {
		if (drag || press?.type === 'touch') e.preventDefault();
	};

	root.addEventListener('pointerdown', onDown);
	addEventListener('pointermove', onMove, { passive: false });
	addEventListener('pointerup', onUp);
	addEventListener('pointercancel', onUp);
	document.addEventListener('touchmove', onTouchMove, { passive: false });
	root.addEventListener('click', onClick, true);
	root.addEventListener('contextmenu', onContext);
	addEventListener('keydown', onKey);
	return () => {
		finish(true);
		root.removeEventListener('pointerdown', onDown);
		removeEventListener('pointermove', onMove);
		removeEventListener('pointerup', onUp);
		removeEventListener('pointercancel', onUp);
		document.removeEventListener('touchmove', onTouchMove);
		root.removeEventListener('click', onClick, true);
		root.removeEventListener('contextmenu', onContext);
		removeEventListener('keydown', onKey);
	};
}
