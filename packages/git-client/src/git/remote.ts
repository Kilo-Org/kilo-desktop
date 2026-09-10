import type { SymbolicRefExec } from "./refs.js";
import { getSymbolicRef } from "./refs.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type RemoteHeadExec = SymbolicRefExec;

export interface RemoteHeadOptions {
	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/**
 * The default branch of a remote, from the remote's `HEAD` symbolic ref —
 * e.g. `getRemoteHEAD(exec, "origin")` resolves `"main"` when
 * `refs/remotes/origin/HEAD` points at `refs/remotes/origin/main`.
 *
 * Resolves `null` when the symref is absent or points outside the remote's
 * namespace.
 */
export async function getRemoteHEAD(
	exec: RemoteHeadExec,
	remote: string,
	options?: RemoteHeadOptions,
): Promise<string | null> {
	const remoteNamespace = `refs/remotes/${remote}/`;
	const match = await getSymbolicRef(exec, `${remoteNamespace}HEAD`, options);
	if (
		match !== null &&
		match.length > remoteNamespace.length &&
		match.startsWith(remoteNamespace)
	) {
		// strip out everything related to the remote because this
		// is likely to be a tracked branch locally
		// e.g. `main`, `develop`, etc
		return match.substring(remoteNamespace.length);
	}

	return null;
}
