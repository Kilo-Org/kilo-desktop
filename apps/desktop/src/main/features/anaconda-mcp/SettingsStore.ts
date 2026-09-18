import type { KvStore, MainSdk } from "@kilo-desktop/feature-sdk";

import type { AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";

interface PersistedSettings extends Record<string, unknown> {
	enabled: boolean;
	urlOverride: string | null;
}

const DEFAULTS: PersistedSettings = { enabled: true, urlOverride: null };

const SETTINGS_NAMESPACE = "settings";

/**
 * Thin domain adapter around `mainSdk.storage.kv` for anaconda-mcp settings.
 *
 * File-backed persistence (atomic writes, corrupt-file recovery, defaults for
 * missing keys) is delegated to the shell's KV capability so the feature
 * doesn't re-implement electron-store plumbing. This class only owns two
 * things the KV can't:
 *
 * - **Wrong-typed value normalisation.** A file with `{ enabled: "yes",
 *   urlOverride: 42 }` reads back as defaults rather than propagating the
 *   type-lie up the stack. Corrupt JSON already resets to defaults inside
 *   the KV; this handles the finer-grained "individual key has a bogus
 *   value" case that predates the KV migration.
 * - **Nullable `urlOverride` semantics.** `set({ urlOverride: null })` must
 *   persist `null` explicitly (the "no override" idiom), so the adapter
 *   forwards `null` untouched rather than letting a `??` coalesce it away.
 */
export class SettingsStore {
	readonly #store: KvStore<PersistedSettings>;
	readonly #defaults: PersistedSettings;

	constructor(sdk: MainSdk, defaults: PersistedSettings = DEFAULTS) {
		this.#defaults = defaults;
		this.#store = sdk.storage.kv<PersistedSettings>({
			namespace: SETTINGS_NAMESPACE,
			defaults,
		});
	}

	get(): AnacondaMcpServiceOptions {
		const snapshot = this.#store.snapshot();
		return {
			enabled: typeof snapshot.enabled === "boolean" ? snapshot.enabled : this.#defaults.enabled,
			// `null` is a legitimate persisted value ("no override") — only
			// wrong-typed values fall back to the injected default.
			urlOverride:
				snapshot.urlOverride === null || typeof snapshot.urlOverride === "string"
					? snapshot.urlOverride
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
