import { useCallback, useMemo } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Models, type ModelRef, type ModelsState } from "@kilo-desktop/plugin-core/contracts";

import { toKiloModelRef, type KiloModelRef } from "./model-catalog";
import { favoriteKeySet } from "./model-favorites";

const NO_FAVORITES: readonly ModelRef[] = [];
const selectFavorites = (state: ModelsState) => state.preferences.favorites;

/** Favourite models, kept in kilo.core's model preferences so every window shares them. */
export function useModelFavorites() {
	const models = useDomainObject(Models);
	const favorites = useDomainObjectState(Models, selectFavorites) ?? NO_FAVORITES;
	const favoriteIds = useMemo(() => favoriteKeySet(favorites.map(toKiloModelRef)), [favorites]);
	const toggleFavorite = useCallback(
		(target: KiloModelRef) => {
			void models?.methods
				.setFavorite({
					aiProviderId: target.providerID,
					modelId: target.modelID,
					favorite: !favoriteIds.has(`${target.providerID}/${target.modelID}`),
				})
				.catch(() => undefined);
		},
		[favoriteIds, models],
	);
	return { favoriteIds, toggleFavorite, hasFavorites: favorites.length > 0 };
}
