import { gsap, refreshMotion } from './motion';

declare global {
	interface Window {
		__photoShootExpandController?: AbortController;
		__photoShootExpandPageLoad?: boolean;
	}
}

const prefersReducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The photography index embeds every shoot as a hidden inline panel
// (ShootPanel.astro). This controller makes selecting a shoot feel like a
// section unfolding inside one page:
//   1. a click on a cover swaps the covers list for that shoot's panel in
//      place (no router navigation), scrolls to the stage top, and moves
//      focus to the shoot title,
//   2. the URL is pushed to the real /photography/[slug] page (which exists
//      statically for deep links, new tabs, and no-JS), with an Astro
//      ClientRouter-compatible history state so back/forward still work as
//      ordinary navigations,
//   3. the panel's header condenses and pins just below the pinned
//      photography masthead — the two-tier sticky is driven by a sentinel
//      IntersectionObserver offset by the masthead's condensed height.
function initPhotoShootExpand() {
	window.__photoShootExpandController?.abort();

	if (document.documentElement.dataset.section !== 'photography') return;

	const root = document.querySelector<HTMLElement>('[data-photo-snap-root]');
	const stage = document.querySelector<HTMLElement>('[data-photo-stage]');
	const masthead = document.querySelector<HTMLElement>('[data-photo-title]');
	const list = document.querySelector<HTMLElement>('[data-shoot-list]');
	const panels = [...document.querySelectorAll<HTMLElement>('[data-shoot-panel]')];
	if (!root || !stage || !masthead || !list || panels.length === 0) return;

	const controller = new AbortController();
	window.__photoShootExpandController = controller;
	const { signal } = controller;

	// See photo-section-snap.ts: <body> is the element that actually scrolls.
	const body = document.body;
	const scrollPos = () => window.scrollY + body.scrollTop;
	const scrollToY = (top: number, smooth: boolean) => {
		const behavior = smooth && !prefersReducedMotion() ? ('smooth' as const) : ('auto' as const);
		window.scrollTo({ top, behavior });
		body.scrollTo({ top, behavior });
	};

	let openId: string | null = null;
	let returnY = 0;
	let returnFocus: HTMLElement | null = null;
	let mastheadStuckH = 0;
	let observers: IntersectionObserver[] = [];

	// The panel header pins below the *condensed* masthead. Measure that height
	// by forcing the stuck state with transitions off ([data-measuring] — same
	// trick photo-section-snap.ts uses for the un-stuck height).
	const measure = () => {
		masthead.setAttribute('data-measuring', '');
		const wasStuck = masthead.classList.contains('is-stuck');
		masthead.classList.add('is-stuck');
		mastheadStuckH = Math.round(masthead.offsetHeight);
		masthead.classList.toggle('is-stuck', wasStuck);
		void masthead.offsetHeight; // commit restored state while transitions are off
		masthead.removeAttribute('data-measuring');
		root.style.setProperty('--photo-parent-stuck-h', `${mastheadStuckH}px`);
		setupObservers();
	};

	// A 1px sentinel placed just before each panel header crosses the line
	// `mastheadStuckH` below the viewport top exactly when the header pins
	// there — flow shifts from the morphing headers are tracked for free.
	const setupObservers = () => {
		observers.forEach((io) => io.disconnect());
		observers = [];
		for (const panel of panels) {
			const header = panel.querySelector<HTMLElement>('[data-panel-header]');
			if (!header) continue;
			let sentinel = panel.querySelector<HTMLElement>('[data-panel-sentinel]');
			if (!sentinel) {
				sentinel = document.createElement('div');
				sentinel.setAttribute('data-panel-sentinel', '');
				sentinel.setAttribute('aria-hidden', 'true');
				header.before(sentinel);
			}
			const io = new IntersectionObserver(
				([entry]) => {
					if (panel.hidden) return;
					const pinned =
						!entry.isIntersecting && entry.boundingClientRect.top <= mastheadStuckH + 1;
					header.classList.toggle('is-stuck', pinned);
				},
				{ rootMargin: `-${mastheadStuckH + 1}px 0px 0px 0px` }
			);
			io.observe(sentinel);
			observers.push(io);
		}
	};

	const stageTop = () => Math.round(stage.getBoundingClientRect().top + scrollPos());

	const expand = (id: string) => {
		const panel = panels.find((p) => p.dataset.shootPanel === id);
		if (!panel || openId === id) return;

		// Another panel open (e.g. history quirk) — just hide it, the new
		// pushState below supersedes its entry.
		if (openId) {
			const prev = panels.find((p) => p.dataset.shootPanel === openId);
			if (prev) {
				prev.hidden = true;
				prev.classList.remove('is-open');
			}
		} else {
			returnY = scrollPos();
			returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}

		list.hidden = true;
		panel.querySelector('[data-panel-header]')?.classList.remove('is-stuck');
		panel.hidden = false;
		openId = id;
		// Also disables the stage's snap-align (see index.astro) so proximity
		// snapping can't drag the view back up to the full-size masthead.
		root.dataset.shootOpen = id;
		// The open state reveals the masthead back link, changing the condensed
		// masthead height. Re-measure before positioning the nested panel header.
		measure();

		// Land in the fully nested state: masthead condensed, shoot header pinned
		// and condensed right beneath it, photos underneath — i.e. just past the
		// panel header's pin point (which also clears the masthead's own stick
		// threshold). Measure the sentinel's flow position with the masthead
		// forced into its condensed state, since that's the layout at the
		// destination.
		const sentinel = panel.querySelector<HTMLElement>('[data-panel-sentinel]');
		masthead.setAttribute('data-measuring', '');
		const wasStuck = masthead.classList.contains('is-stuck');
		masthead.classList.add('is-stuck');
		const pinPoint = sentinel
			? Math.round(sentinel.getBoundingClientRect().top + scrollPos()) - mastheadStuckH
			: stageTop();
		masthead.classList.toggle('is-stuck', wasStuck);
		void masthead.offsetHeight;
		masthead.removeAttribute('data-measuring');

		panel.classList.remove('is-open');
		void panel.offsetHeight; // restart the reveal animation
		panel.classList.add('is-open');

		// Real URL for the shoot (the static page exists) with a ClientRouter-
		// compatible state: back/forward degrade to ordinary page navigations.
		history.pushState(
			{ index: (history.state?.index ?? 0) + 1, scrollX: 0, scrollY: 0, photoPanel: id },
			'',
			`/photography/${id}`
		);

		panel.querySelector<HTMLElement>('[data-panel-title]')?.focus({ preventScroll: true });
		scrollToY(Math.max(stageTop(), pinPoint + 56), true);

		// The reveal changed the document height under every ScrollTrigger.
		refreshMotion();
		// One-time editorial stagger on the freshly revealed grid.
		if (!prefersReducedMotion()) {
			const tiles = panel.querySelectorAll('[data-photo-grid-item]');
			if (tiles.length) {
				gsap.fromTo(
					tiles,
					{ opacity: 0 },
					{ opacity: 1, duration: 0.6, ease: 'power2.out', stagger: { each: 0.045, from: 0 } }
				);
			}
		}
	};

	const collapse = () => {
		if (!openId) return;
		const panel = panels.find((p) => p.dataset.shootPanel === openId);
		if (panel) {
			panel.hidden = true;
			panel.classList.remove('is-open');
		}
		list.hidden = false;
		openId = null;
		delete root.dataset.shootOpen;
		measure();

		// Swap this history entry back to the index (keeping the ClientRouter
		// fields) rather than pushing — back still leaves the section cleanly.
		history.replaceState({ ...(history.state ?? {}), photoPanel: null }, '', '/photography/');

		scrollToY(returnY, false);
		returnFocus?.focus({ preventScroll: true });
		returnFocus = null;
		refreshMotion();
	};

	// Capture phase so this wins over Astro's ClientRouter link interception.
	document.addEventListener(
		'click',
		(event) => {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const target = event.target;
			if (!(target instanceof Element)) return;

			const opener = target.closest<HTMLElement>('a[data-shoot-open]');
			if (opener?.dataset.shootOpen) {
				event.preventDefault();
				event.stopPropagation();
				expand(opener.dataset.shootOpen);
				return;
			}

			const closer = target.closest('a[data-panel-close]');
			if (closer && openId) {
				event.preventDefault();
				event.stopPropagation();
				collapse();
			}
		},
		{ capture: true, signal }
	);

	document.addEventListener(
		'keydown',
		(event) => {
			if (event.key !== 'Escape' || !openId) return;
			// The lightbox locks body scroll while open and owns Escape there.
			if (document.body.style.overflow === 'hidden') return;
			collapse();
		},
		{ signal }
	);

	let measureRaf = 0;
	const queueMeasure = () => {
		cancelAnimationFrame(measureRaf);
		measureRaf = requestAnimationFrame(measure);
	};
	window.addEventListener('resize', queueMeasure, { signal });

	measure();
	document.fonts?.ready.then(() => {
		if (!signal.aborted) queueMeasure();
	});
}

const queueInitPhotoShootExpand = () => requestAnimationFrame(initPhotoShootExpand);

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', queueInitPhotoShootExpand, { once: true });
} else {
	queueInitPhotoShootExpand();
}

if (!window.__photoShootExpandPageLoad) {
	window.__photoShootExpandPageLoad = true;
	document.addEventListener('astro:page-load', queueInitPhotoShootExpand);
	document.addEventListener('astro:after-swap', queueInitPhotoShootExpand);
}

export {};
