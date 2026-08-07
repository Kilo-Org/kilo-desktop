import { isKiloModelRef, modelRefToId, type KiloModelRef } from "./model-catalog.js";

/** Versioned key — bump the suffix if the stored shape changes. */
export const MODEL_FAVORITES_STORAGE_KEY = "kilo-ui.model-favorites:v1";

export function readModelFavorites(
	storage: Storage | undefined = globalThis.localStorage,
): KiloModelRef[] {
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
		const favorites: KiloModelRef[] = [];
		for (const entry of parsed) {
			if (isKiloModelRef(entry)) {
				favorites.push({
					providerID: entry.providerID,
					modelID: entry.modelID,
				});
			}
		}
		return favorites;
	} catch {
		return [];
	}
}

export function writeModelFavorites(
	favorites: readonly KiloModelRef[],
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
	favorites: readonly KiloModelRef[],
	target: KiloModelRef,
): KiloModelRef[] {
	const key = modelRefToId(target);
	const index = favorites.findIndex((favorite) => modelRefToId(favorite) === key);
	if (index >= 0) {
		return favorites.filter((_, i) => i !== index);
	}
	return [...favorites, target];
}

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
