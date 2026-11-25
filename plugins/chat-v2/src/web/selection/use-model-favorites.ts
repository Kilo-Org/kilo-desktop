import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Models, type ModelRef, type ModelsState } from "@kilo-desktop/plugin-core/contracts";

import { modelRefToId, toKiloModelRef, toModelRef, type KiloModelRef } from "./model-catalog";
import { favoriteKeySet } from "./model-favorites";

const NO_FAVORITES: readonly ModelRef[] = [];
const selectFavorites = (state: ModelsState) => state.preferences.favorites;

/** Favourite models, kept in kilo.core's model preferences so every window shares them. */
export function useModelFavorites() {
	const models = useDomainObject(Models);
	const favorites = useDomainObjectState(Models, selectFavorites) ?? NO_FAVORITES;
	const favoriteIds = favoriteKeySet(favorites.map(toKiloModelRef));
	const toggleFavorite = (target: KiloModelRef) => {
		void models?.methods
			.setFavorite({ ...toModelRef(target), favorite: !favoriteIds.has(modelRefToId(target)) })
			.catch(() => undefined);
	};
	return { favoriteIds, toggleFavorite, hasFavorites: favorites.length > 0 };
}
