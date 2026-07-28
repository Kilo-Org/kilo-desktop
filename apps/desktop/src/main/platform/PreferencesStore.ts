import Store from "electron-store";

import type { ThemeSource } from "@anaconda-agentic-desktop/contracts";

export interface AppPreferences {
	themeSource?: ThemeSource;
}

export class PreferencesStore {
	readonly #store: Store<AppPreferences>;

	constructor(store: Store<AppPreferences> = new Store<AppPreferences>({ name: "preferences" })) {
		this.#store = store;
	}

	get themeSource(): ThemeSource | undefined {
		return this.#store.get("themeSource");
	}

	setThemeSource(source: ThemeSource): void {
		this.#store.set("themeSource", source);
	}

	clearThemeSource(): void {
		this.#store.delete("themeSource");
	}
}
