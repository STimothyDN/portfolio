/**
 * Rain on the glass (Daylight observatory; light mode on body[data-daylight]).
 * While it's raining over RTP (sky/weather.ts), the glass surfaces bead with
 * water: the nav pill, the mobile dock, the telemetry panel.
 *
 * A small simulation per surface, on a canvas laid over it: fine beads land
 * and gather; drops grow as they swallow beads and each other; past a size
 * they slide — in fits and starts, leaning with the wind — leaving a trail of
 * beads and sweeping the glass clear where they pass. When the rain stops
 * the glass slowly dries. Each drop is drawn as a small lens: a dark rim
 * where it bends the light away, a bright caustic below, a glint above.
 *
 * Only surfaces that are already positioned get rain (the canvas sits in
 * them, absolutely); hidden ones are skipped. Reduced motion: a still,
 * beaded pane, no sliding.
 */
import { skyWeather, weatherNow } from './sky/weather';

type Bead = { x: number; y: number; r: number };
type Drop = Bead & { vx: number; vy: number; sliding: boolean; sinceTrail: number; wobble: number };
type Surface = {
	el: HTMLElement;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	w: number;
	h: number;
	beads: Bead[];
	drops: Drop[];
	/** Pixels of glass per bead at full intensity. */
	slide: number;
};

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FRAME_MS = 1000 / 30;
const GRAVITY = 420;
const MAX_SPEED = 170;
/** Drying rate when the rain has stopped, px of radius per second. */
const EVAPORATE = 0.05;
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

/** One lens-like drop, pre-rendered large and scaled down per drop. */
let sprite: HTMLCanvasElement | null = null;
const SPRITE = 64;

function dropSprite() {
	if (sprite) return sprite;
	sprite = document.createElement('canvas');
	sprite.width = sprite.height = SPRITE;
	const g = sprite.getContext('2d')!;
	const c = SPRITE / 2;
	const R = c - 1;
	const circle = (style: CanvasGradient) => {
		g.fillStyle = style;
		g.beginPath();
		g.arc(c, c, R, 0, Math.PI * 2);
		g.fill();
	};
	// Rim: the edge bends the light away, so it reads dark — heavier at the bottom.
	const rim = g.createRadialGradient(c, c - R * 0.14, R * 0.5, c, c, R);
	rim.addColorStop(0, 'rgba(40, 32, 92, 0)');
	rim.addColorStop(0.6, 'rgba(40, 32, 92, 0.1)');
	rim.addColorStop(0.88, 'rgba(40, 32, 92, 0.55)');
	rim.addColorStop(1, 'rgba(40, 32, 92, 0)');
	circle(rim);
	// Caustic: light gathered through the drop pools in its lower half.
	const caustic = g.createRadialGradient(c, c + R * 0.32, 0, c, c + R * 0.26, R * 0.78);
	caustic.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
	caustic.addColorStop(1, 'rgba(255, 255, 255, 0)');
	circle(caustic);
	// Glint: the Sun on the top of the drop.
	const glint = g.createRadialGradient(c - R * 0.34, c - R * 0.4, 0, c - R * 0.34, c - R * 0.4, R * 0.26);
	glint.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
	glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
	circle(glint);
	return sprite;
}

let surfaces: Surface[] = [];
let raf = 0;
let last = 0;
let intensity = 0;
let slant = 0;
let resize: ResizeObserver | null = null;

const enabled = () =>
	'daylight' in document.body.dataset && !document.documentElement.classList.contains('theme-dark');

function readWeather() {
	const weather = enabled() ? weatherNow() : null;
	const sky = weather ? skyWeather(weather) : null;
	intensity = sky?.rain ?? 0;
	// Facing south, an east wind (toward −x on screen) pushes drops left.
	slant = sky ? Math.max(-0.5, Math.min(0.5, -sky.wind[0] / 30)) : 0;
}

function fit(surface: Surface) {
	const dpr = Math.min(2, devicePixelRatio || 1);
	surface.w = surface.el.offsetWidth;
	surface.h = surface.el.offsetHeight;
	surface.canvas.width = Math.ceil(surface.w * dpr);
	surface.canvas.height = Math.ceil(surface.h * dpr);
	surface.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	surface.slide = Math.min(4.2, Math.max(3, surface.h * 0.075));
	surface.beads = surface.beads.filter((b) => b.x < surface.w && b.y < surface.h);
	surface.drops = surface.drops.filter((d) => d.x < surface.w && d.y < surface.h);
}

function makeDrop(x: number, y: number, r: number): Drop {
	return { x, y, r, vx: 0, vy: 0, sliding: false, sinceTrail: 0, wobble: Math.random() * 10 };
}

/** The glass is already wet when the page opens on a rainy day. */
function prefill(surface: Surface) {
	const { w, h } = surface;
	const beads = Math.round(((w * h) / 70) * (0.35 + 0.4 * intensity));
	for (let i = 0; i < beads; i++) surface.beads.push({ x: Math.random() * w, y: Math.random() * h, r: randomBetween(0.6, 1.5) });
	const drops = Math.round(((w * h) / 2600) * (0.5 + 0.5 * intensity));
	for (let i = 0; i < drops; i++) surface.drops.push(makeDrop(Math.random() * w, Math.random() * h, randomBetween(1.6, surface.slide * 0.95)));
}

/** Merge b into a, conserving water (area). */
const absorb = (a: Bead, b: Bead) => {
	a.r = Math.hypot(a.r, b.r);
};

function step(surface: Surface, dt: number) {
	const { w, h, beads, drops } = surface;
	const area = w * h;
	if (intensity > 0) {
		// Fine beads land everywhere; now and then a bigger drop.
		const maxBeads = (area / 70) * (0.4 + 0.6 * intensity);
		// Whatever lands on a drop feeds it.
		const land = (bead: Bead) => {
			const host = drops.find((d) => Math.hypot(d.x - bead.x, d.y - bead.y) < d.r + bead.r);
			if (host) absorb(host, bead);
			return !host;
		};
		let landing = (area / 300) * intensity * dt;
		while (landing > 0) {
			if (Math.random() < landing) {
				const bead = { x: Math.random() * w, y: Math.random() * h, r: randomBetween(0.6, 1.5) };
				if (land(bead) && beads.length < maxBeads) beads.push(bead);
			}
			landing -= 1;
		}
		if (Math.random() < (area / 3000) * intensity * dt) {
			const drop = makeDrop(Math.random() * w, Math.random() * h, randomBetween(1.6, 3));
			if (land(drop)) drops.push(drop);
		}
	} else {
		// Drying out.
		for (const b of beads) b.r -= EVAPORATE * dt;
		for (const d of drops) d.r -= EVAPORATE * 0.6 * dt;
		surface.beads = beads.filter((b) => b.r > 0.25);
		surface.drops = drops.filter((d) => d.r > 0.4);
	}

	for (let i = surface.drops.length - 1; i >= 0; i--) {
		const d = surface.drops[i];
		if (!d.sliding && d.r > surface.slide && !reducedMotion) d.sliding = true;
		if (d.sliding) {
			// Stick-slip: heavier drops run faster; now and then one catches.
			d.vy = Math.min(MAX_SPEED, d.vy + GRAVITY * (d.r / surface.slide - 0.55) * dt);
			if (Math.random() < 3.5 * dt) d.vy *= 0.3;
			d.wobble += dt * 6;
			d.vx = d.vy * slant + Math.sin(d.wobble) * 4;
			const dy = d.vy * dt;
			d.x += d.vx * dt;
			d.y += dy;
			// A trail of beads behind it; each one costs it a little water.
			d.sinceTrail += dy;
			if (d.sinceTrail > d.r * 1.6) {
				d.sinceTrail = 0;
				const r = d.r * randomBetween(0.22, 0.34);
				surface.beads.push({ x: d.x + randomBetween(-0.4, 0.4), y: d.y - d.r * 1.2, r });
				d.r = Math.sqrt(Math.max(0.1, d.r * d.r - r * r));
			}
			if (d.r < surface.slide * 0.6) {
				d.sliding = false;
				d.vy = 0;
			}
			// It sweeps up the beads it runs through.
			surface.beads = surface.beads.filter((b) => {
				if (b.y > d.y - d.r * 1.1 && Math.hypot(b.x - d.x, b.y - d.y) < d.r + b.r * 0.6) {
					absorb(d, b);
					return false;
				}
				return true;
			});
			if (d.y - d.r > h || d.x + d.r < 0 || d.x - d.r > w) {
				surface.drops.splice(i, 1);
				continue;
			}
		}
		// Touching drops merge into the bigger one.
		for (let j = i - 1; j >= 0; j--) {
			const o = surface.drops[j];
			if (Math.hypot(o.x - d.x, o.y - d.y) < (o.r + d.r) * 0.85) {
				const [big, small] = o.r >= d.r ? [o, d] : [d, o];
				absorb(big, small);
				big.vy = Math.max(big.vy, small.vy);
				big.sliding ||= small.sliding;
				surface.drops.splice(surface.drops.indexOf(small), 1);
				break;
			}
		}
	}
}

function draw(surface: Surface) {
	const { ctx, w, h } = surface;
	const image = dropSprite();
	ctx.clearRect(0, 0, w, h);
	for (const b of surface.beads) ctx.drawImage(image, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
	for (const d of surface.drops) {
		// Running drops pull long.
		const stretch = d.sliding ? 1 + Math.min(0.35, d.vy / 400) : 1;
		ctx.drawImage(image, d.x - d.r, d.y - d.r * stretch, d.r * 2, d.r * 2 * stretch);
	}
}

function frame(now: number) {
	raf = requestAnimationFrame(frame);
	if (now - last < FRAME_MS || document.hidden) return;
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;
	let wet = false;
	for (const surface of surfaces) {
		if (!surface.w || !surface.h) continue;
		step(surface, dt);
		draw(surface);
		wet ||= surface.beads.length > 0 || surface.drops.length > 0;
	}
	// Dry and no rain: nothing left to do.
	if (!wet && intensity === 0) stop();
}

function stop() {
	cancelAnimationFrame(raf);
	raf = 0;
}

function start() {
	if (raf) return;
	last = performance.now();
	raf = requestAnimationFrame(frame);
}

/** Build the canvases (once per page) and start or stop with the weather and theme. */
function sync() {
	readWeather();
	if (!enabled()) {
		teardown();
		return;
	}
	if (!surfaces.length && intensity > 0) {
		resize = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const surface = surfaces.find((s) => s.el === entry.target);
				if (surface) fit(surface);
			}
		});
		for (const el of document.querySelectorAll<HTMLElement>('[data-glass]')) {
			if (getComputedStyle(el).position === 'static') continue;
			const canvas = document.createElement('canvas');
			canvas.className = 'rain-glass';
			canvas.setAttribute('aria-hidden', 'true');
			Object.assign(canvas.style, {
				position: 'absolute',
				inset: '0',
				width: '100%',
				height: '100%',
				borderRadius: 'inherit',
				pointerEvents: 'none',
			});
			el.append(canvas);
			const surface: Surface = { el, canvas, ctx: canvas.getContext('2d')!, w: 0, h: 0, beads: [], drops: [], slide: 3 };
			fit(surface);
			prefill(surface);
			surfaces.push(surface);
			resize.observe(el);
		}
	}
	if (!surfaces.length) return;
	if (reducedMotion) {
		// A still, beaded pane.
		surfaces.forEach(draw);
		return;
	}
	if (intensity > 0 || surfaces.some((s) => s.beads.length || s.drops.length)) start();
}

function teardown() {
	stop();
	resize?.disconnect();
	resize = null;
	surfaces.forEach((s) => s.canvas.remove());
	surfaces = [];
}

document.addEventListener('astro:page-load', sync);
document.addEventListener('astro:before-swap', teardown);
window.addEventListener('sky:weather', () => sync());
// The theme lives on <html>, which outlives every page.
new MutationObserver(() => sync()).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
