import type { MarketplaceInstalled, MarketplaceItem } from "../contracts/index";

export type MarketplaceStatusFilter = "all" | "installed";

function matchesSelection(value: string, selected: readonly string[]): boolean {
	return selected.length === 0 || selected.includes(value);
}

export function matchesSearch(search: string, values: ReadonlyArray<string | undefined>): boolean {
	const term = search.trim().toLocaleLowerCase();
	if (!term) return true;
	return values.some((value) => value?.toLocaleLowerCase().includes(term) === true);
}

export function installedScopes(
	item: Pick<MarketplaceItem, "id" | "type">,
	installed: readonly MarketplaceInstalled[],
): MarketplaceInstalled[] {
	return installed.filter((entry) => entry.id === item.id && entry.type === item.type);
}

export function filterMarketplaceItems(
	items: readonly MarketplaceItem[],
	installed: readonly MarketplaceInstalled[],
	input: {
		search: string;
		category: readonly string[];
		status: MarketplaceStatusFilter;
	},
): MarketplaceItem[] {
	return items.filter((item) => {
		if (!matchesSelection(item.category, input.category)) return false;
		if (input.status === "installed" && installedScopes(item, installed).length === 0) {
			return false;
		}
		return matchesSearch(input.search, [item.name, item.description, item.category, item.author]);
	});
}
