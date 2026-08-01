import path from "node:path";

/**
 * Single source of truth for where a feature's per-feature data lives, so the
 * `mainSdk.storageDir` resolver (feature-registry) and the `sdk.fs` sandbox
 * (ScopedFsService) can never drift onto different directories.
 *
 * - {@link featureStorageDir} — `${userData}/plugins/<id>/` (Decision #20).
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

export function featureFsSandboxDir(storageRoot: string, featureId: string): string {
	return path.join(featureStorageDir(storageRoot, featureId), "fs");
}
