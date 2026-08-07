import { modelRefToId, type KiloModelRef } from "./model-catalog.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const MODEL_FAVORITES_STORAGE_KEY = "kilo-ui.model-favorites:v1";

export type ModelFavorite = KiloModelRef;

export function favoriteKey(favorite: ModelFavorite): string {
	return modelRefToId(favorite);
}

export function readModelFavorites(
	storage: Storage | undefined = globalThis.localStorage,
): ModelFavorite[] {
	if (!storage) {
		return [];
	}
	try {
		const raw = storage.getItem(MODEL_FAVORITES_STORAGE_KEY);
		if (!raw) {
			return [];
		}
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		const favorites: ModelFavorite[] = [];
		for (const entry of parsed) {
			if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as ModelFavorite).providerID === "string" &&
				typeof (entry as ModelFavorite).modelID === "string" &&
				(entry as ModelFavorite).providerID.length > 0 &&
				(entry as ModelFavorite).modelID.length > 0
			) {
				favorites.push({
					providerID: (entry as ModelFavorite).providerID,
					modelID: (entry as ModelFavorite).modelID,
				});
			}
		}
		return favorites;
	} catch {
		return [];
	}
}

export function writeModelFavorites(
	favorites: readonly ModelFavorite[],
	storage: Storage | undefined = globalThis.localStorage,
): void {
	if (!storage) {
		return;
	}
	try {
		storage.setItem(MODEL_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
	} catch {
		// Quota / private mode — ignore; in-memory state still works for the session.
	}
}

export function toggleModelFavorite(
	favorites: readonly ModelFavorite[],
	target: ModelFavorite,
): ModelFavorite[] {
	const key = favoriteKey(target);
	const index = favorites.findIndex((favorite) => favoriteKey(favorite) === key);
	if (index >= 0) {
		return favorites.filter((_, i) => i !== index);
	}
	return [...favorites, target];
}

export function favoriteKeySet(favorites: readonly ModelFavorite[]): Set<string> {
	return new Set(favorites.map(favoriteKey));
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
