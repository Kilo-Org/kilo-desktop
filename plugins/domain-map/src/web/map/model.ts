/** Where something runs: the main process, or the window showing the map. */
export type MapProcess = "main" | "window";

/** The kernel's own owner id: it runs in every process and holds the window's mirrors. */
export const KERNEL = "kernel";

export interface PluginSummary {
	readonly id: string;
	readonly name: string;
	/** Whether it has a main-process entry, and a window entry. */
	readonly main: boolean;
	readonly web: boolean;
	/** The qualified ids in its manifest `requires`: domain objects and extension points it uses. */
	readonly requires: readonly string[];
}

export interface DomainSummary {
	readonly id: string;
	readonly owner: string;
	readonly home: "main" | "renderer";
	readonly events: readonly string[];
	readonly description?: string;
}

export interface PointSummary {
	readonly id: string;
	readonly owner: string;
	/** Where its contributions are implemented (`any` or `data` when not tied to one). */
	readonly process: string;
}

export interface ContributionSummary {
	readonly pointId: string;
	readonly pluginId: string;
}

export interface DomainMapInput {
	readonly plugins: readonly PluginSummary[];
	readonly domains: readonly DomainSummary[];
	readonly points: readonly PointSummary[];
	readonly contributions: readonly ContributionSummary[];
	readonly isProvided: (domainId: string) => boolean;
	readonly includeUnprovided: boolean;
	readonly includePoints: boolean;
}

export interface MapDomain extends DomainSummary {
	readonly process: MapProcess;
	readonly provided: boolean;
}

/** A plugin as it runs in one process: where its domain objects and points sit. */
export interface MapPlugin {
	readonly key: string;
	readonly pluginId: string;
	readonly process: MapProcess;
	readonly name: string;
}

/**
 * A main domain object's copy in this window: the window's kernel keeps it in
 * step with main and forwards method calls to it, so what uses a main domain
 * object from the window uses this.
 */
export interface MapMirror {
	readonly key: string;
	readonly domainId: string;
}

/** A plugin declaring (in `requires`) that it uses a domain object. */
export interface MapUse {
	readonly key: string;
	readonly domainId: string;
	/** The domain object, or its mirror when the plugin uses it from the window. */
	readonly source: string;
	readonly user: string;
	readonly process: MapProcess;
}

/** An extension point, on its owner's platform in the process its contributions run in. */
export interface MapPoint {
	readonly key: string;
	readonly pointId: string;
	readonly owner: string;
	readonly process: MapProcess;
}

/** A plugin contributing to a point. */
export interface MapFeed {
	readonly key: string;
	/** The contributing plugin's platform key. */
	readonly from: string;
	readonly point: string;
}

export interface DomainMap {
	readonly domains: readonly MapDomain[];
	readonly plugins: readonly MapPlugin[];
	readonly mirrors: readonly MapMirror[];
	readonly uses: readonly MapUse[];
	readonly points: readonly MapPoint[];
	readonly feeds: readonly MapFeed[];
}

export const pluginKey = (process: MapProcess, pluginId: string) => `${process}:${pluginId}`;
export const mirrorKey = (domainId: string) => `mirror:${domainId}`;
const pointKey = (process: MapProcess, pointId: string) => `${process}:point:${pointId}`;

const processOf = (home: "main" | "renderer"): MapProcess => (home === "main" ? "main" : "window");
const byKey = <T extends { readonly key: string }>(a: T, b: T) => a.key.localeCompare(b.key);

/**
 * The map's model, from what plugins declare: domain objects in their home
 * process on their owner's platform; a "uses" line from a domain object to
 * each plugin that requires it, where that plugin runs (through its mirror
 * when the plugin uses a main domain object from the window); and extension
 * points with a line from each plugin contributing to them. Lines are
 * declared dependencies, not observed listeners: the kernel doesn't tell
 * plugins who listens to what.
 */
export function buildDomainMap(input: DomainMapInput): DomainMap {
	const runsIn = new Map<string, { main: boolean; window: boolean }>([
		[KERNEL, { main: true, window: true }],
	]);
	const names = new Map<string, string>([[KERNEL, "Kernel"]]);
	for (const plugin of input.plugins) {
		runsIn.set(plugin.id, { main: plugin.main, window: plugin.web });
		names.set(plugin.id, plugin.name);
	}
	const runs = (pluginId: string, process: MapProcess) =>
		process === "main" ? runsIn.get(pluginId)?.main : runsIn.get(pluginId)?.window;

	const domains: MapDomain[] = input.domains
		.map((domain) => ({
			...domain,
			process: processOf(domain.home),
			provided: input.isProvided(domain.id),
		}))
		.filter((domain) => domain.provided || input.includeUnprovided)
		.sort((a, b) => a.process.localeCompare(b.process) || a.id.localeCompare(b.id));
	const byId = new Map(domains.map((domain) => [domain.id, domain]));

	const plugins = new Map<string, MapPlugin>();
	const place = (process: MapProcess, pluginId: string) => {
		const key = pluginKey(process, pluginId);
		if (!plugins.has(key)) {
			plugins.set(key, { key, pluginId, process, name: names.get(pluginId) ?? pluginId });
		}
		return key;
	};
	for (const domain of domains) place(domain.process, domain.owner);

	const uses: MapUse[] = [];
	const mirrored = new Set<string>();
	for (const plugin of input.plugins) {
		for (const id of plugin.requires) {
			const domain = byId.get(id);
			if (!domain || domain.owner === plugin.id) continue;
			// Where the plugin runs alongside the domain object, it uses it there; else from the other process.
			const process: MapProcess = runs(plugin.id, domain.process)
				? domain.process
				: domain.process === "main"
					? "window"
					: "main";
			// A window domain object can't be reached from main.
			if (domain.process === "window" && process === "main") continue;
			const viaMirror = domain.process === "main" && process === "window";
			if (viaMirror) mirrored.add(domain.id);
			place(process, plugin.id);
			uses.push({
				key: `use:${process}:${plugin.id}<${domain.id}`,
				domainId: domain.id,
				source: viaMirror ? mirrorKey(domain.id) : domain.id,
				user: plugin.id,
				process,
			});
		}
	}
	if (mirrored.size > 0) place("window", KERNEL);

	const points: MapPoint[] = [];
	const feeds: MapFeed[] = [];
	if (input.includePoints) {
		for (const point of input.points) {
			if (point.owner === KERNEL) continue;
			const process: MapProcess =
				point.process === "renderer"
					? "window"
					: point.process === "main"
						? "main"
						: runs(point.owner, "main")
							? "main"
							: "window";
			const key = pointKey(process, point.id);
			place(process, point.owner);
			points.push({ key, pointId: point.id, owner: point.owner, process });
			for (const contribution of input.contributions) {
				if (contribution.pointId !== point.id) continue;
				const from = runs(contribution.pluginId, process)
					? process
					: process === "main"
						? "window"
						: "main";
				const fromKey = place(from, contribution.pluginId);
				feeds.push({ key: `feed:${fromKey}>${key}`, from: fromKey, point: key });
			}
		}
	}

	return {
		domains,
		plugins: [...plugins.values()].sort(
			(a, b) =>
				a.process.localeCompare(b.process) ||
				Number(b.pluginId === KERNEL) - Number(a.pluginId === KERNEL) ||
				a.pluginId.localeCompare(b.pluginId),
		),
		mirrors: [...mirrored].sort().map((domainId) => ({ key: mirrorKey(domainId), domainId })),
		uses: uses.sort(byKey),
		points: points.sort(byKey),
		feeds: [...new Map(feeds.map((feed) => [feed.key, feed])).values()].sort(byKey),
	};
}

/** How something a domain object did travels: to users beside it, and into this window's mirror and on. */
export interface Delivery {
	readonly direct: MapUse[];
	readonly mirror: MapMirror | null;
	readonly relayed: MapUse[];
}

export function deliveryOf(map: DomainMap, domainId: string): Delivery {
	const uses = map.uses.filter((use) => use.domainId === domainId);
	return {
		direct: uses.filter((use) => use.source === domainId),
		mirror: map.mirrors.find((mirror) => mirror.domainId === domainId) ?? null,
		relayed: uses.filter((use) => use.source !== domainId),
	};
}

/** The plugins that declare they use a domain object. */
export function usersOf(map: DomainMap, domainId: string): string[] {
	return [...new Set(map.uses.filter((use) => use.domainId === domainId).map((use) => use.user))];
}
