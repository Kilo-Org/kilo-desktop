import { useCallback, useMemo, useState } from "react";

import type { KiloModelRef } from "./model-catalog.js";

import {
	favoriteKeySet,
	readModelFavorites,
	toggleModelFavorite,
	writeModelFavorites,
} from "./model-favorites.js";

export function useModelFavorites() {
	const [favorites, setFavorites] = useState<KiloModelRef[]>(() => readModelFavorites());

	const favoriteIds = useMemo(() => favoriteKeySet(favorites), [favorites]);

	const toggleFavorite = useCallback((target: KiloModelRef) => {
		setFavorites((current) => {
			const next = toggleModelFavorite(current, target);
			writeModelFavorites(next);
			return next;
		});
	}, []);

	return {
		favoriteIds,
		toggleFavorite,
		hasFavorites: favorites.length > 0,
	};
}
