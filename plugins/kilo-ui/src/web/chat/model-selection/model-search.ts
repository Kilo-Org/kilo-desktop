import type { KiloCatalogModel } from "./model-catalog.js";

type SearchableModel = Pick<KiloCatalogModel, "id" | "name" | "description" | "keywords">;

/**
 * Client-side filter for the virtualized model list (cmdk filtering is disabled
 * so unmounted rows are not required for search).
 */
export function filterModelsBySearchQuery<T extends SearchableModel>(
	models: readonly T[],
	query: string,
): readonly T[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return models;
	}
	return models.filter((model) => {
		if (model.id.toLowerCase().includes(normalized)) {
			return true;
		}
		if (model.name.toLowerCase().includes(normalized)) {
			return true;
		}
		if (model.description?.toLowerCase().includes(normalized)) {
			return true;
		}
		return model.keywords?.some((keyword) => keyword.toLowerCase().includes(normalized)) ?? false;
	});
}
