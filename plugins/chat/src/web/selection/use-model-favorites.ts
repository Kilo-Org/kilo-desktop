import { useCallback, useMemo } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";

import { ModelPreferences, type ModelPreferencesState, type ModelRef } from "../../contracts";
import type { KiloModelRef } from "./model-catalog";
import { favoriteKeySet } from "./model-favorites";

const NO_FAVORITES: readonly ModelRef[] = [];
const selectFavorites = (state: ModelPreferencesState) => state.favorites;

/** Favourite models, kept in `kilo.chat/model-preferences` so every window shares them. */
export function useModelFavorites() {
	const preferences = useDomain(ModelPreferences);
	const favorites = useDomainState(ModelPreferences, selectFavorites) ?? NO_FAVORITES;
	const favoriteIds = useMemo(() => favoriteKeySet(favorites), [favorites]);
	const toggleFavorite = useCallback(
		(target: KiloModelRef) => {
			void preferences?.methods
				.setFavorite({
					...target,
					favorite: !favoriteIds.has(`${target.providerID}/${target.modelID}`),
				})
				.catch(() => undefined);
		},
		[favoriteIds, preferences],
	);
	return { favoriteIds, toggleFavorite, hasFavorites: favorites.length > 0 };
}
