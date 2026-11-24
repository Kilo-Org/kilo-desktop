import { modelRefToId, type KiloModelRef } from "./model-catalog";

export function favoriteKeySet(favorites: readonly KiloModelRef[]): Set<string> {
	return new Set(favorites.map(modelRefToId));
}

/** Favorites first (stable), then the rest in original order. */
export function sortModelsWithFavoritesFirst<T extends { id: string }>(
	models: readonly T[],
	favoriteIds: ReadonlySet<string>,
): T[] {
	if (favoriteIds.size === 0) {
		return [...models];
	}
	const favorites: T[] = [];
	const rest: T[] = [];
	for (const model of models) {
		if (favoriteIds.has(model.id)) {
			favorites.push(model);
		} else {
			rest.push(model);
		}
	}
	return [...favorites, ...rest];
}
