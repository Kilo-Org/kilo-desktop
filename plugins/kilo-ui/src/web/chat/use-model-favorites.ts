import { useCallback, useState } from "react";

import {
	favoriteKeySet,
	readModelFavorites,
	toggleModelFavorite,
	writeModelFavorites,
	type ModelFavorite,
} from "./model-favorites.js";

export function useModelFavorites() {
	const [favorites, setFavorites] = useState<ModelFavorite[]>(() => readModelFavorites());

	const favoriteIds = favoriteKeySet(favorites);

	const toggleFavorite = useCallback((target: ModelFavorite) => {
		setFavorites((current) => {
			const next = toggleModelFavorite(current, target);
			writeModelFavorites(next);
			return next;
		});
	}, []);

	return {
		favorites,
		favoriteIds,
		toggleFavorite,
		hasFavorites: favorites.length > 0,
	};
}
