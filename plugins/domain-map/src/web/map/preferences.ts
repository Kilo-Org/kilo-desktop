import { useSyncExternalStore } from "react";

export interface MapPreferencesState {
	readonly live: boolean;
	readonly showState: boolean;
	readonly includeUnprovided: boolean;
	readonly rotate: boolean;
	/** Plugin platforms; hide them to see just the domain objects. */
	readonly showPlugins: boolean;
	/** Extension points, and which plugins contribute to them. */
	readonly showPoints: boolean;
	/** Show the "uses" lines only while something travels them. */
	readonly onlyActive: boolean;
}

export const DEFAULT_MAP_PREFERENCES: MapPreferencesState = {
	live: true,
	showState: true,
	includeUnprovided: false,
	rotate: false,
	showPlugins: true,
	showPoints: true,
	onlyActive: false,
};

/** How this window shows the Domain Map; kept while its panel is closed. */
export class MapPreferences {
	#state = DEFAULT_MAP_PREFERENCES;
	readonly #listeners = new Set<() => void>();

	get current(): MapPreferencesState {
		return this.#state;
	}

	set(change: Partial<MapPreferencesState>): void {
		const next = { ...this.#state, ...change };
		const keys = Object.keys(next) as (keyof MapPreferencesState)[];
		if (keys.every((key) => next[key] === this.#state[key])) return;
		this.#state = next;
		for (const listener of [...this.#listeners]) listener();
	}

	reset(): void {
		this.set(DEFAULT_MAP_PREFERENCES);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

/** This window's Domain Map preferences; each window has its own. */
export const mapPreferences = new MapPreferences();

export function useMapPreferences(): MapPreferencesState {
	return useSyncExternalStore(
		(onChange) => mapPreferences.subscribe(onChange),
		() => mapPreferences.current,
		() => mapPreferences.current,
	);
}
