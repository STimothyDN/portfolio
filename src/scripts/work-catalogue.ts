/**
 * The work index's live parts: the stack map's highlighting and the
 * catalogue filter.
 *
 * - Hover or focus a project star (or its catalogue row) and its lines and
 *   tools light up; hover a tool and the projects that used it do. With
 *   nothing hovered, the active filter's tool stays lit.
 * - Following a project's star morphs its name into the project page's
 *   title (the catalogue row stands down from the view transition).
 * - Pick a tool (a star on desktop, a chip on phones) to filter the
 *   catalogue to the projects that used it; pick it again, or the readout's
 *   clear button, to show everything. Leaving rows fade, the rest glide into
 *   place (FLIP on the Web Animations API), and the matching tag is marked
 *   in each row. The filter lives in the URL (?stack=<tool>) so it can be
 *   shared, and the stack figure on each project page links into it.
 */
import { easing } from './ease';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let controller: AbortController | null = null;

type Focus = { kind: 'project' | 'tool'; slug: string } | null;

function setup() {
	controller?.abort();
	const root = document.querySelector<HTMLElement>('[data-catalogue]');
	const chart = root?.querySelector<HTMLElement>('[data-stack-map] .chart');
	const index = root?.querySelector<HTMLElement>('.work-index');
	if (!root || !chart || !index) return;
	controller = new AbortController();
	const { signal } = controller;

	const toolButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tool].tool-btn')];
	const projectLinks = [...chart.querySelectorAll<HTMLElement>('[data-project]')];
	const lines = [...chart.querySelectorAll<SVGLineElement>('.links line')];
	const items = [...index.children] as HTMLLIElement[];
	const rowOf = (li: HTMLLIElement) => li.querySelector<HTMLElement>('.row')!;
	const showing = root.querySelector<HTMLOutputElement>('[data-showing]');
	const clear = root.querySelector<HTMLButtonElement>('[data-clear]');
	const clearLabel = root.querySelector<HTMLElement>('[data-clear-label]');
	const nameOf = new Map(toolButtons.map((b) => [b.dataset.tool!, b.querySelector('.tool-name')?.textContent ?? '']));

	let active: string | null = null;

	/* ── Highlighting ─────────────────────────────────────────────── */

	const light = (focus: Focus) => {
		chart.querySelectorAll('.is-lit').forEach((el) => el.classList.remove('is-lit'));
		items.forEach((li) => rowOf(li).classList.remove('is-lit'));
		const current = focus ?? (active ? { kind: 'tool' as const, slug: active } : null);
		if (!current) {
			delete chart.dataset.focus;
			return;
		}
		chart.dataset.focus = '';
		const lit = (el: Element) => el.classList.add('is-lit');
		if (current.kind === 'project') {
			projectLinks.filter((a) => a.dataset.project === current.slug).forEach(lit);
			lines.filter((l) => l.dataset.p === current.slug).forEach(lit);
			toolButtons.filter((b) => b.dataset.projects!.split(' ').includes(current.slug)).forEach(lit);
			items.filter((li) => li.dataset.slug === current.slug).forEach((li) => lit(rowOf(li)));
		} else {
			const button = toolButtons.find((b) => b.dataset.tool === current.slug);
			if (!button) return;
			const projects = button.dataset.projects!.split(' ');
			lit(button);
			lines.filter((l) => l.dataset.t === current.slug).forEach(lit);
			projectLinks.filter((a) => projects.includes(a.dataset.project!)).forEach(lit);
		}
	};

	const hover = (el: HTMLElement, focus: Focus) => {
		el.addEventListener('pointerenter', () => light(focus), { signal });
		el.addEventListener('pointerleave', () => light(null), { signal });
		el.addEventListener('focus', () => light(focus), { signal });
		el.addEventListener('blur', () => light(null), { signal });
	};
	projectLinks.forEach((a) => hover(a, { kind: 'project', slug: a.dataset.project! }));
	toolButtons.forEach((b) => hover(b, { kind: 'tool', slug: b.dataset.tool! }));
	items.forEach((li) => {
		const row = rowOf(li);
		row.addEventListener('pointerenter', () => light({ kind: 'project', slug: li.dataset.slug! }), { signal });
		row.addEventListener('pointerleave', () => light(null), { signal });
	});

	/* ── Into a project from the map ──────────────────────────────── */

	// The project page's title morphs in from whatever carries
	// `work-title-<slug>`: normally the catalogue row's title, which may be
	// far off screen. Following a star hands the name to the star's label
	// instead (and drops the row's screenshot from the morph), so the title
	// grows out of the map.
	projectLinks.forEach((a) =>
		a.addEventListener(
			'click',
			() => {
				const slug = a.dataset.project!;
				const row = items.find((li) => li.dataset.slug === slug);
				row?.querySelectorAll<HTMLElement>('.title a, .thumb img').forEach((el) => (el.style.viewTransitionName = 'none'));
				const name = a.querySelector<HTMLElement>('.project-name');
				if (name) name.style.viewTransitionName = `work-title-${slug}`;
			},
			{ signal }
		)
	);

	/* ── Filter ───────────────────────────────────────────────────── */

	const matches = (li: HTMLLIElement, slug: string | null) =>
		!slug || rowOf(li).dataset.tools!.split(' ').includes(slug);

	// One filter change at a time: a click mid-animation queues behind it.
	let queue = Promise.resolve();

	const relayout = async (slug: string | null, animate: boolean) => {
		const leaving = items.filter((li) => !li.hidden && !matches(li, slug));
		const entering = items.filter((li) => li.hidden && matches(li, slug));
		const staying = items.filter((li) => !li.hidden && matches(li, slug));
		const apply = () => items.forEach((li) => (li.hidden = !matches(li, slug)));
		if (!animate) return apply();

		await Promise.all(
			leaving.map(
				(li) =>
					li.animate([{ opacity: 1 }, { opacity: 0, translate: '0 -8px' }], {
						duration: 180,
						easing: easing('power2.in'),
						fill: 'forwards',
					}).finished
			)
		);
		const before = new Map(staying.map((li) => [li, li.getBoundingClientRect().top]));
		apply();
		leaving.forEach((li) => li.getAnimations().forEach((a) => a.cancel()));
		for (const li of staying) {
			const dy = before.get(li)! - li.getBoundingClientRect().top;
			if (Math.abs(dy) > 0.5) {
				li.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], {
					duration: 600,
					easing: easing('power3.out'),
				});
			}
		}
		entering.forEach((li, i) =>
			li.animate([{ opacity: 0, translate: '0 18px' }, { opacity: 1, translate: '0 0' }], {
				duration: 600,
				delay: 120 + i * 60,
				easing: easing('power3.out'),
				fill: 'backwards',
			})
		);
	};

	const filter = (slug: string | null, animate = !reducedMotion.matches) => {
		active = slug && nameOf.has(slug) ? slug : null;
		toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === active)));
		index.querySelectorAll('.tags li').forEach((li) => {
			li.classList.toggle('is-match', !!active && (li as HTMLElement).dataset.tool === active);
		});
		const count = items.filter((li) => matches(li, active)).length;
		if (showing) showing.textContent = `${count} of ${items.length}`;
		if (clear && clearLabel) {
			clear.hidden = !active;
			clearLabel.textContent = active ? nameOf.get(active)! : '';
		}
		light(null);
		queue = queue.then(() => relayout(active, animate)).catch(() => {});

		const url = new URL(location.href);
		if (active) url.searchParams.set('stack', active);
		else url.searchParams.delete('stack');
		if (url.href !== location.href) history.replaceState(history.state, '', url);
	};

	toolButtons.forEach((b) =>
		b.addEventListener('click', () => filter(b.dataset.tool === active ? null : b.dataset.tool!), { signal })
	);
	clear?.addEventListener(
		'click',
		() => {
			// The clear button disappears: keep focus on the map's tool.
			const from = toolButtons.find((b) => b.dataset.tool === active && (b.checkVisibility?.() ?? true));
			filter(null);
			from?.focus({ preventScroll: true });
		},
		{ signal }
	);

	const initial = new URL(location.href).searchParams.get('stack');
	if (initial) filter(initial, false);
}

// Start at once (and on every swap) rather than after window.load, so a
// shared ?stack= filter applies before the rows are seen.
let initializedForSwap = false;

function begin() {
	initializedForSwap = true;
	setup();
}

begin();
document.addEventListener('astro:after-swap', begin);
document.addEventListener('astro:page-load', () => {
	if (!initializedForSwap) begin();
});
document.addEventListener('astro:before-swap', () => {
	initializedForSwap = false;
	controller?.abort();
	controller = null;
});
