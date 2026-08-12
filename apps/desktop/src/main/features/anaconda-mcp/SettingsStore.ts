import Store from "electron-store";

import type { AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";

const SETTINGS_FILENAME = "settings";

interface PersistedSettings {
	enabled: boolean;
	urlOverride: string | null;
}

const DEFAULTS: PersistedSettings = { enabled: true, urlOverride: null };

/**
 * File-backed store for anaconda-mcp settings, persisted to
 * `<storageDir>/settings.json` via `electron-store` (atomic writes, retries).
 *
 * `set()` is synchronous and throws when the on-disk write fails, so contract
 * handlers surface persistence failures to the UI instead of reporting a
 * save that silently reverts on the next restart. A malformed settings file
 * is cleared back to defaults (`clearInvalidConfig`), matching the previous
 * "unreadable file falls back to defaults" behavior.
 */
export class SettingsStore {
	readonly #store: Store<PersistedSettings>;
	readonly #defaults: PersistedSettings;

	constructor(storageDir: string, defaults: PersistedSettings = DEFAULTS) {
		this.#defaults = defaults;
		this.#store = new Store<PersistedSettings>({
			cwd: storageDir,
			name: SETTINGS_FILENAME,
			defaults,
			clearInvalidConfig: true,
		});
	}

	get(): AnacondaMcpServiceOptions {
		const enabled = this.#store.get("enabled");
		const urlOverride = this.#store.get("urlOverride");
		return {
			enabled: typeof enabled === "boolean" ? enabled : this.#defaults.enabled,
			// `null` is a legitimate persisted value ("no override") — only
			// wrong-typed values fall back to the injected default.
			urlOverride:
				urlOverride === null || typeof urlOverride === "string"
					? urlOverride
					: this.#defaults.urlOverride,
		};
	}

	/**
	 * Merge a partial update into settings and persist synchronously.
	 * Returns the new settings snapshot. Throws when the write fails.
	 */
	set(patch: {
		enabled?: boolean | undefined;
		urlOverride?: string | null | undefined;
	}): AnacondaMcpServiceOptions {
		const current = this.get();
		const next: PersistedSettings = {
			enabled: patch.enabled ?? current.enabled,
			// `??` would fall through to current — honor an explicit null.
			urlOverride: patch.urlOverride === null ? null : (patch.urlOverride ?? current.urlOverride),
		};
		this.#store.set(next);
		return { ...next };
	}
}
