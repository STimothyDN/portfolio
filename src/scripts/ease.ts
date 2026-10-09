/**
 * The easing curves the site's motion was tuned with (GSAP's power/expo/sine
 * families), shared by the Web Animations motion system and the rAF-driven
 * pointer followers.
 *
 * `easing()` turns a curve into a CSS timing function: sampled into
 * `linear()` — an exact match for the GSAP curve — where supported, or the
 * nearest cubic-bezier on older engines.
 */
const CURVES = {
	'power1.out': [(t: number) => 1 - (1 - t) ** 2, 'cubic-bezier(0.5, 1, 0.89, 1)'],
	'power2.out': [(t: number) => 1 - (1 - t) ** 3, 'cubic-bezier(0.33, 1, 0.68, 1)'],
	'power3.out': [(t: number) => 1 - (1 - t) ** 4, 'cubic-bezier(0.25, 1, 0.5, 1)'],
	'power4.out': [(t: number) => 1 - (1 - t) ** 5, 'cubic-bezier(0.22, 1, 0.36, 1)'],
	'expo.out': [(t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)), 'cubic-bezier(0.16, 1, 0.3, 1)'],
	'power2.in': [(t: number) => t ** 3, 'cubic-bezier(0.32, 0, 0.67, 0)'],
	'sine.inOut': [(t: number) => (1 - Math.cos(Math.PI * t)) / 2, 'cubic-bezier(0.37, 0, 0.63, 1)'],
} as const;

export type EaseName = keyof typeof CURVES;

/** The curve itself, for JS-driven tweens. */
export const ease = (name: EaseName): ((t: number) => number) => CURVES[name][0];

const SAMPLES = 40;
const cssCache = new Map<EaseName, string>();
let linearSupported: boolean | undefined;

/** The curve as a CSS timing function (for WAAPI and CSS transitions). */
export function easing(name: EaseName): string {
	let css = cssCache.get(name);
	if (!css) {
		const [curve, fallback] = CURVES[name];
		linearSupported ??= CSS.supports('animation-timing-function', 'linear(0, 1)');
		css = linearSupported
			? `linear(${Array.from({ length: SAMPLES + 1 }, (_, i) => +curve(i / SAMPLES).toFixed(4)).join(', ')})`
			: fallback;
		cssCache.set(name, css);
	}
	return css;
}
