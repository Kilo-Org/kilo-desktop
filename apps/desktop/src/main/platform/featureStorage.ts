import path from "node:path";

/**
 * Single source of truth for where a feature's per-feature data lives, so the
 * `mainSdk.storageDir` resolver (feature-registry) and the `sdk.fs` sandbox
 * (ScopedFsService) can never drift onto different directories.
 *
 * - {@link featureStorageDir} — `${userData}/plugins/<id>/` (each feature owns its storage).
 *   Holds shell-owned per-feature state, notably the feature's SQLite
 *   `data.db` (+ WAL/SHM). This is `mainSdk.storageDir`.
 * - {@link featureFsSandboxDir} — `${userData}/plugins/<id>/fs/`, a dedicated
 *   subdirectory backing `sdk.fs`. It is a SIBLING of `data.db`, never its
 *   parent, so no `sdk.fs` call (including a recursive remove of the sandbox
 *   root) can reach the feature's database.
 */
export function featureStorageDir(storageRoot: string, featureId: string): string {
	return path.join(storageRoot, "plugins", featureId);
}

/**
 * Where the user's local plugins (their code) live: `${userData}/local-plugins/`.
 * Deliberately not under `plugins/`, which holds every plugin's data by id — a
 * local plugin's folder there would also be its storage directory, so its own
 * writes would change the files its approval is pinned to.
 */
export function localPluginsDir(storageRoot: string): string {
	return path.join(storageRoot, "local-plugins");
}

export function featureFsSandboxDir(storageRoot: string, featureId: string): string {
	return path.join(featureStorageDir(storageRoot, featureId), "fs");
}
