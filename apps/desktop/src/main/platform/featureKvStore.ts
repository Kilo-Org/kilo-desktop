import Store from "electron-store";

import type { KvStore, KvStoreFactory, KvStoreOptions } from "@kilo-desktop/feature-sdk";

/**
 * Namespace pattern accepted by `mainSdk.storage.kv({ namespace })`. The
 * namespace becomes the file name inside the feature's storage directory
 * (`<storageDir>/<namespace>.json`), so path separators and `..` segments
 * would let a caller escape the per-feature sandbox and even collide with
 * another feature's KV file (`electron-store` passes `name` to
 * `path.resolve(cwd, name + '.json')`, which normalises `..`). Restricting
 * to identifier-safe characters removes that class of misuse at the SDK
 * boundary rather than trusting every plugin.
 */
const KV_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a KV namespace. Exported so the FeatureRouter can reject an
 * invalid namespace with the same rule before it hits its per-namespace
 * cache — otherwise a malformed namespace would poison the router cache
 * under a spoofed key even when the factory below rejected the actual open.
 */
export function assertValidKvNamespace(namespace: string): void {
	if (!KV_NAMESPACE_PATTERN.test(namespace)) {
		throw new Error(
			`[featureKvStore] Invalid KV namespace "${namespace}": must match ${KV_NAMESPACE_PATTERN.source}. ` +
				`Path separators, "..", and empty names would escape the feature's storage sandbox.`,
		);
	}
}

/**
 * `electron-store`-backed implementation of the `mainSdk.storage.kv` factory.
 *
 * The shell binds this factory to a feature's Decision #20 storage directory
 * so each opened store persists to `<storageDir>/<namespace>.json` — atomic
 * writes, corrupt-file recovery (`clearInvalidConfig: true`), and default
 * backfill for missing keys are all `electron-store`'s job here, which the
 * previous `SettingsStore` / `PreferencesStore` classes duplicated by hand.
 *
 * Semantically the KV is intentionally shape-agnostic: it does not enforce
 * that persisted values match the type of the injected `defaults`. A feature
 * that needs stronger guarantees (e.g. Zod-parse a persisted enum) does that
 * in its own adapter — the KV stays a simple, low-magic persistence
 * primitive so it can serve any feature.
 */
export function createFeatureKvStoreFactory(storageDir: string): KvStoreFactory {
	return <T extends Record<string, unknown>>(options: KvStoreOptions<T>): KvStore<T> => {
		const namespace = options.namespace ?? "kv";
		assertValidKvNamespace(namespace);
		const store = new Store<T>({
			cwd: storageDir,
			name: namespace,
			defaults: options.defaults,
			clearInvalidConfig: true,
		});

		return {
			snapshot: () => ({ ...store.store }),
			get: (key) => store.get(key as string) as T[typeof key],
			set: (patch) => {
				// `electron-store` writes synchronously and throws on failure;
				// propagate so callers can surface persistence failures to the
				// UI instead of silently reverting on the next restart. We
				// spread `store.store` first so the returned snapshot reflects
				// defaults for keys the patch didn't touch.
				const next = { ...store.store, ...stripUndefined(patch) } as T;
				// `store.store = next` uses the whole-object setter, avoiding
				// conf's overloaded `set()` signature whose `PartialObjectDeep`
				// constraint TS cannot prove for a generic `T extends
				// Record<string, unknown>`. Same on-disk atomic write.
				store.store = next;
				return { ...next };
			},
			clear: () => {
				store.clear();
			},
		};
	};
}

/**
 * Drop keys whose value is `undefined` so a `patch` argument that names a key
 * explicitly-with-`undefined` (a common `exactOptionalPropertyTypes` idiom in
 * this repo) is treated the same as "not provided", preserving the current
 * persisted value rather than persisting `undefined` on top of it.
 */
function stripUndefined<T extends Record<string, unknown>>(patch: Partial<T>): Partial<T> {
	const result: Partial<T> = {};
	for (const key of Object.keys(patch) as Array<keyof T>) {
		const value = patch[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}
