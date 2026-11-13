import {
	KERNEL,
	pluginKey,
	usersOf,
	type DomainMap,
	type MapDomain,
	type MapFeed,
	type MapMirror,
	type MapPlugin,
	type MapPoint,
	type MapUse,
} from "./model";

/** Something on the map a person can point at. */
export type Pickable =
	| { readonly kind: "domain"; readonly domain: MapDomain }
	| { readonly kind: "mirror"; readonly mirror: MapMirror }
	| { readonly kind: "plugin"; readonly plugin: MapPlugin }
	| { readonly kind: "use"; readonly use: MapUse }
	| { readonly kind: "point"; readonly point: MapPoint }
	| { readonly kind: "feed"; readonly feed: MapFeed };

/** What hovering something on the map tells a person about it. */
/** A tooltip's title and labelled rows. */
export interface Description {
	readonly title: string;
	readonly rows: Readonly<Record<string, string | number>>;
}

export function describePicked(map: DomainMap, picked: Pickable): Description | null {
	const where = (process: string) => (process === "main" ? "main process" : "this window");
	if (picked.kind === "domain") {
		const { domain } = picked;
		return {
			title: domain.id,
			rows: {
				"Owned by": domain.owner,
				"Lives in": where(domain.process),
				Events: domain.events.length ? domain.events.join(", ") : "none",
				"Used by (declared)": usersOf(map, domain.id).join(", ") || "nobody",
				...(domain.provided ? {} : { Status: "not provided" }),
			},
		};
	}
	if (picked.kind === "mirror") {
		const { mirror } = picked;
		return {
			title: `Mirror of ${mirror.domainId}`,
			rows: {
				"Held by": "this window's kernel",
				"Kept in step": "state and events, from main",
				"Method calls": "forwarded to main",
			},
		};
	}
	if (picked.kind === "point" || picked.kind === "feed") {
		const point =
			picked.kind === "point"
				? picked.point
				: map.points.find((candidate) => candidate.key === picked.feed.point);
		if (!point) return null;
		const from = map.feeds
			.filter((feed) => feed.point === point.key)
			.map((feed) => feed.from.slice(feed.from.indexOf(":") + 1));
		return {
			title: `${point.pointId} (extension point)`,
			rows: {
				"Offered by": point.owner,
				"Contributed to by": from.join(", ") || "nobody",
				In: where(point.process),
			},
		};
	}
	if (picked.kind === "plugin") {
		const { plugin } = picked;
		const key = pluginKey(plugin.process, plugin.pluginId);
		return {
			title: plugin.name,
			rows: {
				Plugin: plugin.pluginId,
				"Runs in": where(plugin.process),
				"Domain objects": map.domains.filter((d) => pluginKey(d.process, d.owner) === key).length,
				"Uses (declared)": map.uses.filter((u) => pluginKey(u.process, u.user) === key).length,
				...(key === pluginKey("window", KERNEL) && map.mirrors.length > 0
					? { "Mirrors held": map.mirrors.length }
					: {}),
			},
		};
	}
	const { use } = picked;
	return {
		title: `${use.user} uses ${use.domainId}${use.source === use.domainId ? "" : " (its mirror)"}`,
		rows: { Declared: "in its manifest's requires", In: where(use.process) },
	};
}
