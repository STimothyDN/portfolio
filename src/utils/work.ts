/**
 * The work catalogue: each project's Markdown frontmatter joined with what
 * `npm run sync-work` measured about it (src/data/work-signals.json — the
 * screenshot's spectrum, and for GitHub repos the commit history and
 * language breakdown), plus the derived pieces the work pages chart: the
 * stack by layer, related projects, the activity light curve and the stack
 * map's layout.
 */
import { type CollectionEntry, getCollection } from 'astro:content';
import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3';

import signals from '../data/work-signals.json';

export interface Spectrum {
	/** Chroma per 5° of OKLCH hue, 0–1 (the strongest bin is 1). */
	bins: number[];
	/** Mean chroma over every pixel: how colourful the whole frame is. */
	chroma: number;
	/** Share of near-neutral (grey) pixels. */
	neutral: number;
	/** Mean OKLab lightness. */
	lightness: number;
	palette: { hex: string; share: number }[];
}

export interface GitHubSignals {
	repo: string;
	createdAt: string;
	pushedAt: string;
	stars: number;
	forks: number;
	homepage?: string;
	/** Bytes per language (GitHub linguist). */
	languages: Record<string, number>;
	/** Author dates (ISO), oldest first. */
	commits: string[];
}

const projectSignals = signals.projects as Record<string, { spectrum: Spectrum; github?: GitHubSignals }>;
export const signalsSyncedAt = new Date(signals.syncedAt);

/* ── Stack ───────────────────────────────────────────────────────────── */

export const LAYERS = ['Frontend', 'Backend', 'Data & viz', 'Platform', 'Core'] as const;
export type Layer = (typeof LAYERS)[number] | 'Other';

/** Where each tag sits in the stack. A tag missing here lands in "Other". */
const LAYER_OF: Record<string, Layer> = {
	'Vue.js': 'Frontend',
	React: 'Frontend',
	Pinia: 'Frontend',
	'Tailwind CSS': 'Frontend',
	JavaFX: 'Frontend',
	'Oracle JET': 'Frontend',
	Django: 'Backend',
	'Wagtail CMS': 'Backend',
	PostgreSQL: 'Backend',
	'Harness.js': 'Backend',
	'D3.js': 'Data & viz',
	Highcharts: 'Data & viz',
	ECharts: 'Data & viz',
	Algorithms: 'Data & viz',
	Docker: 'Platform',
	Vite: 'Platform',
	'Browser Extension': 'Platform',
	'Chrome Extension': 'Platform',
	'Firefox Add-on': 'Platform',
	Java: 'Core',
	JavaScript: 'Core',
};

export const tagSlug = (tag: string) =>
	tag
		.toLowerCase()
		.replace(/\.js$/, 'js')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

export interface Tool {
	name: string;
	slug: string;
	layer: Layer;
}

const tool = (name: string): Tool => ({ name, slug: tagSlug(name), layer: LAYER_OF[name] ?? 'Other' });

/** A project's tags grouped by layer, in stack order. */
export function byLayer(tools: Tool[]) {
	return [...LAYERS, 'Other' as const]
		.map((layer) => ({ layer, tools: tools.filter((t) => t.layer === layer) }))
		.filter((g) => g.tools.length);
}

/* ── Projects ────────────────────────────────────────────────────────── */

export interface Project {
	entry: CollectionEntry<'work'>;
	slug: string;
	title: string;
	/** Name for tight spots (the stack map). */
	short: string;
	/** Catalogue number: 1 for the oldest. */
	no: number;
	date: Date;
	year: number;
	/** The description's first sentence. */
	summary: string;
	tools: Tool[];
	/** Where `link` goes: `github.com/owner/repo` or the site's host. */
	host: string;
	isRepo: boolean;
	spectrum?: Spectrum;
	github?: GitHubSignals;
}

const hostOf = (link: string) => {
	try {
		const url = new URL(link);
		const host = url.host.replace(/^www\./, '');
		return host === 'github.com' ? `${host}${url.pathname.replace(/\/$/, '')}` : host;
	} catch {
		return link;
	}
};

/** Every project, newest first. */
export async function getProjects(): Promise<Project[]> {
	const entries = (await getCollection('work')).sort(
		(a, b) => a.data.publishDate.valueOf() - b.data.publishDate.valueOf()
	);
	return entries
		.map((entry, i) => {
			const { data, id } = entry;
			const sig = projectSignals[id];
			return {
				entry,
				slug: id,
				title: data.title,
				short: data.short ?? data.title,
				no: i + 1,
				date: data.publishDate,
				year: data.publishDate.getFullYear(),
				summary: data.description.trim().match(/^.+?[.!?](?=\s|$)/s)?.[0] ?? data.description.trim(),
				tools: data.tags.map(tool),
				host: hostOf(data.link),
				isRepo: /^https:\/\/github\.com\//.test(data.link),
				spectrum: sig?.spectrum,
				github: sig?.github,
			};
		})
		.reverse();
}

export const catalogueNo = (no: number) => String(no).padStart(2, '0');

/** Every tag across the catalogue, most used first, with who uses it. */
export function allTools(projects: Project[]) {
	const map = new Map<string, Tool & { projects: string[] }>();
	for (const p of projects) {
		for (const t of p.tools) {
			const known = map.get(t.slug) ?? { ...t, projects: [] };
			known.projects.push(p.slug);
			map.set(t.slug, known);
		}
	}
	return [...map.values()].sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
}

/**
 * Nearest neighbours by shared tags (Jaccard), topped up with the nearest in
 * time so there are always `count`.
 */
export function related(project: Project, projects: Project[], count = 3) {
	const mine = new Set(project.tools.map((t) => t.slug));
	return projects
		.filter((p) => p.slug !== project.slug)
		.map((p) => {
			const shared = p.tools.filter((t) => mine.has(t.slug));
			const union = new Set([...mine, ...p.tools.map((t) => t.slug)]).size;
			return { project: p, shared, score: shared.length / union, gap: Math.abs(p.date.valueOf() - project.date.valueOf()) };
		})
		.sort((a, b) => b.score - a.score || a.gap - b.gap)
		.slice(0, count);
}

/* ── Activity ────────────────────────────────────────────────────────── */

const DAY = 86400000;

/**
 * Commits binned across the repo's active span (first to last commit), for
 * the light curve. Short sprints get fine bins, long projects coarse ones.
 */
export function lightCurve(commits: string[], bins = 48) {
	const times = commits.map((c) => Date.parse(c)).sort((a, b) => a - b);
	const first = times[0];
	const last = times.at(-1)!;
	const span = Math.max(last - first, DAY);
	const counts = new Array(bins).fill(0);
	for (const t of times) counts[Math.min(bins - 1, Math.floor(((t - first) / span) * bins))]++;
	const activeDays = new Set(times.map((t) => Math.floor(t / DAY))).size;
	return { counts, first: new Date(first), last: new Date(last), spanDays: Math.round(span / DAY) + 1, activeDays };
}

/* ── Stack map ───────────────────────────────────────────────────────── */

export const MAP_W = 1000;
export const MAP_H = 370;

/** A simulation node (d3-force fills in x/y and the velocities). */
interface MapNode {
	id: string;
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	kind: 'project' | 'tool';
	/** Half extents of the label box, for collisions, and its centre's offset below the star. */
	hw: number;
	hh: number;
	oy: number;
}

export interface StackMap {
	projects: { slug: string; x: number; y: number }[];
	tools: { slug: string; x: number; y: number; side: 'left' | 'right' }[];
	links: { project: string; tool: string }[];
}

/**
 * Lays out the stack map at build time with a seeded force simulation:
 * projects are the bright stars, drawn left to right in the order they were
 * made, each tag a fainter star tied to every project that used it — so the
 * shared ones settle between their projects and the catalogue's
 * constellations form on their own. Label boxes collide as rectangles.
 */
export function stackMap(projects: Project[]): StackMap {
	const chrono = [...projects].sort((a, b) => a.no - b.no);
	const tools = allTools(projects);
	// Label widths in map units: the labels scale with the map (cqi), so one
	// estimate holds at every width — mono caps for tools, the brand face for
	// projects (plus their number and year).
	const CHAR = 7.4;
	const BRAND_CHAR = 8;
	const pad = 90;
	const step = (MAP_W - pad * 2) / Math.max(1, chrono.length - 1);

	const nodes: MapNode[] = [
		...chrono.map((p, i) => ({
			id: `p:${p.slug}`,
			kind: 'project' as const,
			hw: (p.short.length * BRAND_CHAR + 65) / 2,
			// The star sits on (x, y) with its label underneath.
			hh: 26,
			oy: 8,
			x: pad + i * step,
			y: MAP_H / 2 + (i % 2 ? 55 : -55),
		})),
		...tools.map((t, i) => ({
			id: `t:${t.slug}`,
			kind: 'tool' as const,
			hw: (t.name.length * CHAR + 18) / 2,
			hh: 10,
			oy: 0,
			x: MAP_W / 2 + Math.cos(i * 2.4) * 200,
			y: MAP_H / 2 + Math.sin(i * 2.4) * 120,
		})),
	];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const links = tools.flatMap((t) => t.projects.map((p) => ({ source: `p:${p}`, target: `t:${t.slug}` })));
	const target = new Map(chrono.map((p, i) => [`p:${p.slug}`, pad + i * step]));

	let seed = 428;
	const sim = forceSimulation(nodes)
		.randomSource(() => (seed = (seed * 16807) % 2147483647) / 2147483647)
		.force('link', forceLink(links).id((n: MapNode) => n.id).distance(62).strength(0.7))
		.force('charge', forceManyBody().strength((n: MapNode) => (n.kind === 'project' ? -420 : -90)))
		.force('x', forceX((n: MapNode) => target.get(n.id) ?? MAP_W / 2).strength((n: MapNode) => (n.kind === 'project' ? 0.9 : 0.01)))
		.force('y', forceY(MAP_H / 2).strength((n: MapNode) => (n.kind === 'project' ? 0.06 : 0.04)))
		.force('boxes', collideBoxes(nodes, 6))
		.stop();
	for (let i = 0; i < 500; i++) {
		sim.tick();
		for (const n of nodes) {
			n.x = Math.min(MAP_W - n.hw, Math.max(n.hw, n.x!));
			n.y = Math.min(MAP_H - n.hh - n.oy - 4, Math.max(n.hh - n.oy + 4, n.y!));
		}
	}

	const round = (v: number) => Math.round(v * 10) / 10;
	return {
		projects: chrono.map((p) => {
			const n = byId.get(`p:${p.slug}`)!;
			return { slug: p.slug, x: round(n.x!), y: round(n.y!) };
		}),
		tools: tools.map((t) => {
			const n = byId.get(`t:${t.slug}`)!;
			// The label trails away from the projects it hangs off.
			const meanX = t.projects.reduce((sum, p) => sum + byId.get(`p:${p}`)!.x!, 0) / t.projects.length;
			// Box centre → star position: the star sits at the box's near edge.
			const side = n.x! >= meanX ? 'right' : 'left';
			const starX = side === 'right' ? n.x! - n.hw + 6 : n.x! + n.hw - 6;
			return { slug: t.slug, x: round(starX), y: round(n.y!), side };
		}),
		links: tools.flatMap((t) => t.projects.map((p) => ({ project: p, tool: t.slug }))),
	};
}

/** Rectangle collision: overlapping label boxes push apart along their shallower axis. */
function collideBoxes(nodes: MapNode[], gap: number) {
	return (alpha: number) => {
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x! - a.x!;
				const dy = b.y! + b.oy - (a.y! + a.oy);
				const ox = a.hw + b.hw + gap - Math.abs(dx);
				const oy = a.hh + b.hh + gap - Math.abs(dy);
				if (ox <= 0 || oy <= 0) continue;
				const k = 0.5 * Math.min(1, alpha * 4 + 0.3);
				// Projects are heavier: tags move out of their way.
				const wa = a.kind === 'project' && b.kind === 'tool' ? 0.15 : b.kind === 'project' && a.kind === 'tool' ? 0.85 : 0.5;
				if (ox < oy) {
					const push = ox * k * Math.sign(dx || 1);
					a.x! -= push * wa;
					b.x! += push * (1 - wa);
				} else {
					const push = oy * k * Math.sign(dy || 1);
					a.y! -= push * wa;
					b.y! += push * (1 - wa);
				}
			}
		}
	};
}
