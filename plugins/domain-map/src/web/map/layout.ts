import { KERNEL, pluginKey, type DomainMap, type MapPlugin, type MapProcess } from "./model";

export type Vec3 = readonly [number, number, number];

export interface PlacedPlugin {
	readonly position: Vec3;
	readonly radius: number;
}

export interface Plane {
	readonly process: MapProcess;
	readonly y: number;
	readonly radius: number;
}

export interface MapLayout {
	readonly planes: readonly [Plane, Plane];
	readonly plugins: ReadonlyMap<string, PlacedPlugin>;
	/** Domain objects by id, and mirrors by mirror key. */
	readonly domains: ReadonlyMap<string, Vec3>;
	/** Extension points, by point key, on their owner's platform. */
	readonly points: ReadonlyMap<string, Vec3>;
	/**
	 * Three control points per line (start, raised middle, end), by key: each
	 * use (domain object or mirror to its user), each mirror (domain object
	 * down to it) and each feed (contributor to point).
	 */
	readonly links: ReadonlyMap<string, readonly [Vec3, Vec3, Vec3]>;
}

/** Arc length between neighbouring domain objects on a platform. */
const DOMAIN_SPACING = 0.75;
const PLATFORM_MARGIN = 0.45;
const MIN_PLATFORM_RADIUS = 0.55;
const PLATFORM_GAP = 0.9;
/** How high domain objects float above their platform. */
export const DOMAIN_LIFT = 0.4;
/** Points sit low, just above their platform, round its edge. */
const POINT_LIFT = 0.12;
const POINT_SPACING = 0.4;
const MIN_PLANE_GAP = 5;

const ringRadius = (count: number) =>
	count <= 1 ? 0 : Math.max(0.45, (count * DOMAIN_SPACING) / (2 * Math.PI));

const onCircle = (radius: number, angle: number, y: number): Vec3 => [
	radius * Math.cos(angle),
	y,
	radius * Math.sin(angle),
];

interface PlaneDraft {
	readonly radius: number;
	readonly offsets: Map<string, { x: number; z: number; radius: number }>;
}

/** Kernel in the middle, every other plugin round it, spaced by its size. */
function draftPlane(plugins: readonly MapPlugin[], radiusOf: (plugin: MapPlugin) => number) {
	const offsets: PlaneDraft["offsets"] = new Map();
	const centre =
		plugins.find((plugin) => plugin.pluginId === KERNEL) ??
		(plugins.length === 1 ? plugins[0] : undefined);
	const ring = plugins.filter((plugin) => plugin !== centre);
	const centreRadius = centre ? radiusOf(centre) : 0;
	if (centre) offsets.set(centre.key, { x: 0, z: 0, radius: centreRadius });
	if (ring.length === 0) return { radius: centreRadius, offsets };

	const slots = ring.map((plugin) => 2 * radiusOf(plugin) + PLATFORM_GAP);
	const circumference = slots.reduce((sum, slot) => sum + slot, 0);
	const largest = Math.max(...ring.map(radiusOf));
	// Some slack over the bare circumference, since neighbours sit a chord apart, not an arc.
	const radius = Math.max(
		centreRadius + largest + PLATFORM_GAP,
		(1.15 * circumference) / (2 * Math.PI),
	);
	let travelled = 0;
	for (const [index, plugin] of ring.entries()) {
		const slot = slots[index]!;
		const angle = Math.PI / 2 + (2 * Math.PI * (travelled + slot / 2)) / circumference;
		travelled += slot;
		offsets.set(plugin.key, {
			x: radius * Math.cos(angle),
			z: radius * Math.sin(angle),
			radius: radiusOf(plugin),
		});
	}
	return { radius: radius + largest, offsets };
}

/**
 * Positions for the map: one horizontal plane per process (main above the
 * window), each plugin a platform on it (the kernel in the middle), its
 * domain objects floating in a ring over it and its extension points ringed
 * lower round its edge. Mirrors float over the window's kernel, which holds
 * them.
 */
export function layoutDomainMap(map: DomainMap): MapLayout {
	const owned = new Map<string, string[]>();
	for (const domain of map.domains) {
		const key = pluginKey(domain.process, domain.owner);
		owned.set(key, [...(owned.get(key) ?? []), domain.id]);
	}
	const holder = pluginKey("window", KERNEL);
	for (const mirror of map.mirrors) {
		owned.set(holder, [...(owned.get(holder) ?? []), mirror.key]);
	}
	const innerRadius = (key: string) => ringRadius(owned.get(key)?.length ?? 0);
	const offered = new Map<string, string[]>();
	for (const point of map.points) {
		const key = pluginKey(point.process, point.owner);
		offered.set(key, [...(offered.get(key) ?? []), point.key]);
	}
	const pointRadius = (key: string) => {
		const count = offered.get(key)?.length ?? 0;
		if (count === 0) return 0;
		return Math.max(innerRadius(key) + 0.35, (count * POINT_SPACING) / (2 * Math.PI));
	};
	const radiusOf = (plugin: MapPlugin) =>
		Math.max(
			MIN_PLATFORM_RADIUS,
			Math.max(innerRadius(plugin.key), pointRadius(plugin.key)) + PLATFORM_MARGIN,
		);

	const drafts = {
		main: draftPlane(
			map.plugins.filter((plugin) => plugin.process === "main"),
			radiusOf,
		),
		window: draftPlane(
			map.plugins.filter((plugin) => plugin.process === "window"),
			radiusOf,
		),
	};
	// Far enough apart that, seen from above at an angle, one plane doesn't sit inside the other.
	const gap = Math.max(MIN_PLANE_GAP, 0.7 * Math.max(drafts.main.radius, drafts.window.radius));
	const planes: [Plane, Plane] = [
		{ process: "main", y: gap / 2, radius: drafts.main.radius + 1 },
		{ process: "window", y: -gap / 2, radius: drafts.window.radius + 1 },
	];
	const yOf = (process: MapProcess) => (process === "main" ? planes[0].y : planes[1].y);

	const plugins = new Map<string, PlacedPlugin>();
	for (const process of ["main", "window"] as const) {
		for (const [key, { x, z, radius }] of drafts[process].offsets) {
			plugins.set(key, { position: [x, yOf(process), z], radius });
		}
	}

	const domains = new Map<string, Vec3>();
	for (const [key, ids] of owned) {
		const platform = plugins.get(key);
		if (!platform) continue;
		const [x, y, z] = platform.position;
		const radius = ringRadius(ids.length);
		for (const [index, id] of ids.entries()) {
			const [dx, , dz] = onCircle(radius, (2 * Math.PI * index) / ids.length, 0);
			domains.set(id, [x + dx, y + DOMAIN_LIFT, z + dz]);
		}
	}

	const points = new Map<string, Vec3>();
	for (const [key, ids] of offered) {
		const platform = plugins.get(key);
		if (!platform) continue;
		const [x, y, z] = platform.position;
		const radius = pointRadius(key);
		for (const [index, id] of ids.entries()) {
			// Half a step round, so a lone point doesn't sit under a lone domain object.
			const [dx, , dz] = onCircle(radius, (2 * Math.PI * (index + 0.5)) / ids.length, 0);
			points.set(id, [x + dx, y + POINT_LIFT, z + dz]);
		}
	}

	const links = new Map<string, readonly [Vec3, Vec3, Vec3]>();
	const line = (key: string, from: Vec3 | undefined, to: Vec3 | undefined) => {
		if (from && to) links.set(key, [from, raisedMiddle(from, to), to]);
	};
	for (const mirror of map.mirrors) {
		line(mirror.key, domains.get(mirror.domainId), domains.get(mirror.key));
	}
	for (const use of map.uses) {
		line(use.key, domains.get(use.source), plugins.get(pluginKey(use.process, use.user))?.position);
	}
	for (const feed of map.feeds) {
		line(feed.key, plugins.get(feed.from)?.position, points.get(feed.point));
	}

	return { planes, plugins, domains, points, links };
}

function raisedMiddle(from: Vec3, to: Vec3): Vec3 {
	const middle: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
	if (Math.abs(from[1] - to[1]) > DOMAIN_LIFT * 2) {
		// Between planes: bow outwards so lines between processes don't run through the kernel.
		return [middle[0] * 1.25, middle[1], middle[2] * 1.25];
	}
	const span = Math.hypot(from[0] - to[0], from[2] - to[2]);
	return [middle[0], Math.max(from[1], to[1]) + 0.5 + 0.12 * span, middle[2]];
}
