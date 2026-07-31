import Store from "electron-store";

import { themeSourceSchema, type ThemeSource } from "@anaconda-agentic-desktop/contracts";

export interface AppPreferences {
	/** Last renderer-synced theme source — used to resolve cold-start native chrome. */
	themeSource?: ThemeSource;
}

export class PreferencesStore {
	readonly #store: Store<AppPreferences>;

	constructor(store: Store<AppPreferences> = new Store<AppPreferences>({ name: "preferences" })) {
		this.#store = store;
	}

	get themeSource(): ThemeSource | undefined {
		const parsed = themeSourceSchema.safeParse(this.#store.get("themeSource"));
		return parsed.success ? parsed.data : undefined;
	}

	setThemeSource(source: ThemeSource): void {
		this.#store.set("themeSource", source);
	}
}
