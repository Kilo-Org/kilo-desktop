import Store from "electron-store";

import {
	normalizeAppThemePreferences,
	themeSourceSchema,
	type ThemeSource,
} from "@kilo-desktop/contracts";

export interface AppPreferences {
	/** Last renderer-synced theme source — used to resolve cold-start native chrome. */
	themeSource?: ThemeSource;
	themeId?: string;
	/** Telemetry opt-out gate. Defaults to `true` (opt-out model). */
	allowDataCollection?: boolean;
	/** Stable per-install id, generated once and persisted across sessions. */
	installationId?: string;
}

/** Owns persisted shell preferences; invalid theme values fall back to application defaults. */
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

	get themeId(): string {
		return normalizeAppThemePreferences({ themeId: this.#store.get("themeId") }).themeId;
	}

	setThemeId(themeId: string): void {
		this.#store.set("themeId", normalizeAppThemePreferences({ themeId }).themeId);
	}

	/**
	 * Whether telemetry may collect data. Opt-out model: defaults to `true` when
	 * unset. A settings-page toggle to flip this is a follow-up.
	 */
	get allowDataCollection(): boolean {
		const value = this.#store.get("allowDataCollection");
		return typeof value === "boolean" ? value : true;
	}

	setAllowDataCollection(allow: boolean): void {
		this.#store.set("allowDataCollection", allow);
	}

	/**
	 * Stable installation id, lazily generated on first read and persisted so it
	 * survives restarts. Used as an OTEL resource attribute and as the Sentry
	 * user id to correlate a single install (e.g. affected-user counts on
	 * issues) without identifying the actual user.
	 */
	getInstallationId(): string {
		let id = this.#store.get("installationId");
		if (typeof id !== "string" || id.length === 0) {
			id = crypto.randomUUID();
			this.#store.set("installationId", id);
		}
		return id;
	}
}
