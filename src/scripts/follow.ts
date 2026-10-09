/**
 * Retargetable tweens for pointer-driven UI — the gsap.quickTo pattern: every
 * `to()` restarts a tween from wherever the value is right now toward the new
 * target, so a stream of pointer events reads as one smooth chase.
 *
 * Values that style the same element share a group whose `render` callback
 * runs once per frame after they advance. One rAF loop serves every group and
 * stops itself the moment nothing is moving (no idle ticking).
 */
import { ease, type EaseName } from './ease';

interface Tween {
	from: number;
	to: number;
	duration: number;
	curve: (t: number) => number;
	/** Same clock as rAF timestamps, so the next frame already shows progress. */
	start: number;
}

const awake = new Set<FollowGroup>();
let frame = 0;

function tick(now: number) {
	frame = 0;
	for (const group of awake) if (!group.advance(now)) awake.delete(group);
	if (awake.size) frame = requestAnimationFrame(tick);
}

export class FollowValue {
	constructor(
		private readonly group: FollowGroup,
		public current: number,
		private readonly duration: number,
		private readonly curve: (t: number) => number
	) {}

	/** Tween from the current value to `target` (seconds; defaults to the value's own duration and curve). */
	to(target: number, duration = this.duration, easeName?: EaseName) {
		if (duration <= 0) return this.set(target);
		this.group.run(this, {
			from: this.current,
			to: target,
			duration: duration * 1000,
			curve: easeName ? ease(easeName) : this.curve,
			start: performance.now(),
		});
	}

	/** Jump straight to `value`, cancelling any tween in flight. */
	set(value: number) {
		this.current = value;
		this.group.stop(this);
	}
}

export class FollowGroup {
	private readonly running = new Map<FollowValue, Tween>();

	constructor(private readonly render: () => void) {}

	value(initial: number, duration: number, easeName: EaseName) {
		return new FollowValue(this, initial, duration, ease(easeName));
	}

	run(value: FollowValue, tween: Tween) {
		this.running.set(value, tween);
		awake.add(this);
		frame ||= requestAnimationFrame(tick);
	}

	stop(value: FollowValue) {
		this.running.delete(value);
		this.render();
	}

	/** Stop every tween in place (e.g. before the page is swapped out). */
	halt() {
		this.running.clear();
		awake.delete(this);
	}

	advance(now: number) {
		for (const [value, t] of this.running) {
			const p = Math.min(1, Math.max(0, (now - t.start) / t.duration));
			value.current = t.from + (t.to - t.from) * t.curve(p);
			if (p >= 1) this.running.delete(value);
		}
		this.render();
		return this.running.size > 0;
	}
}
