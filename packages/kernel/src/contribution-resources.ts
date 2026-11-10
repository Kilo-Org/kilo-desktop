import type { DiscoveredContribution } from "./discovery";
import type { PluginAssets } from "./host-services";

export const RESOURCES_TOKEN = "${resources}";

/** Every `${resources}` in `value`'s strings, at any depth, replaced with `folder`. */
function expand(value: unknown, folder: string): unknown {
	if (typeof value === "string") return value.replaceAll(RESOURCES_TOKEN, folder);
	if (Array.isArray(value)) return value.map((item) => expand(item, folder));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, expand(item, folder)]),
		);
	}
	return value;
}

/**
 * The contribution with `${resources}` in its metadata resolved against its
 * own plugin's assets. Without assets (a host that ships none) it is returned
 * unchanged and `onUnresolved` says why.
 */
export function resolveContributionResources(
	contribution: DiscoveredContribution,
	assets: PluginAssets | undefined,
	onUnresolved: (reason: string) => void,
): DiscoveredContribution {
	let folder: string;
	try {
		if (!assets) throw new Error("the host has no assets for its plugin");
		folder = assets.resolve("resources/").replace(/[\\/]+$/, "");
	} catch (error) {
		onUnresolved(error instanceof Error ? error.message : String(error));
		return contribution;
	}
	return {
		...contribution,
		entry: { ...contribution.entry, metadata: expand(contribution.entry.metadata, folder) },
	};
}
