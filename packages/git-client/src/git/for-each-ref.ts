import { GitErrorCode } from "../exec/errors.js";
import type { IBranch } from "../models/branch.js";
import type { IGitStringExecutionOptions, IGitStringResult } from "./core.js";
import { createForEachRefParser } from "../lib/git-delimiter-parser.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (string overload). */
export type ForEachRefExec = (
	args: string[],
	name: string,
	options: IGitStringExecutionOptions,
) => Promise<IGitStringResult>;

export interface ForEachRefOptions {
	/** Ref prefixes to list. Defaults to `["refs/heads"]` (local branches). */
	readonly prefixes?: readonly string[];

	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/**
 * Get the branches matching the given ref prefixes (local branches by
 * default) via `git for-each-ref`. Symbolic refs are excluded.
 *
 * Resolves `null` when the working directory is not inside a git repository
 * — the same "null = not a repo" semantics as `status()`.
 */
export async function getBranches(
	exec: ForEachRefExec,
	options?: ForEachRefOptions,
): Promise<IBranch[] | null> {
	// `lstrip=2`, not `:short` (a deliberate divergence from GitHub Desktop):
	// `:short` checks every other ref namespace per ref to keep names
	// unambiguous (a filesystem probe each — seconds to minutes for thousands
	// of refs on Windows) and renames a branch that shares its name with a tag
	// to `heads/<name>`. `git branch` prints `lstrip=2` names too.
	const { formatArgs, parse } = createForEachRefParser({
		fullName: "%(refname)",
		shortName: "%(refname:lstrip=2)",
		upstreamShortName: "%(upstream:lstrip=2)",
		sha: "%(objectname)",
		symRef: "%(symref)",
	});

	const prefixes = options?.prefixes ?? ["refs/heads"];
	const result = await exec(["for-each-ref", ...formatArgs, ...prefixes], "getBranches", {
		...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
		expectedErrors: new Set([GitErrorCode.NotAGitRepository]),
	});

	if (result.gitError === GitErrorCode.NotAGitRepository) {
		return null;
	}

	const branches: IBranch[] = [];
	for (const ref of parse(result.stdout)) {
		// exclude symbolic refs from the branch list
		if (ref.symRef.length > 0) {
			continue;
		}

		branches.push({
			name: ref.shortName,
			upstream: ref.upstreamShortName.length > 0 ? ref.upstreamShortName : null,
			tip: { sha: ref.sha },
			ref: ref.fullName,
		});
	}

	return branches;
}
