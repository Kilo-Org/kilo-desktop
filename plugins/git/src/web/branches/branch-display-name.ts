import type { GitBranch } from "../../contracts";

const REMOTE_REF_PREFIX = "refs/remotes/";

/** A remote branch's remote and branch path (`refs/remotes/origin/feat/x` → `origin`, `feat/x`). */
export function splitRemoteBranch(branch: Pick<GitBranch, "name" | "ref">): {
	readonly remote: string;
	readonly path: string;
} {
	const full = branch.ref.startsWith(REMOTE_REF_PREFIX)
		? branch.ref.slice(REMOTE_REF_PREFIX.length)
		: branch.name;
	const slash = full.indexOf("/");
	return slash === -1
		? { remote: full, path: full }
		: { remote: full.slice(0, slash), path: full.slice(slash + 1) };
}

/**
 * Branch label without its remote (`origin/feature` → `feature`); the
 * picker shows the remote as a muted prefix next to it.
 */
export function branchDisplayName(branch: Pick<GitBranch, "name" | "kind" | "ref">): string {
	return branch.kind === "remote" ? splitRemoteBranch(branch).path : branch.name;
}

/**
 * The value a picker item carries and is searched by: the full `origin/...`
 * name for a remote branch, so typing the remote matches it, else its label.
 */
export function branchSearchValue(branch: Pick<GitBranch, "name" | "kind" | "ref">): string {
	return branch.kind === "remote" ? branch.name : branchDisplayName(branch);
}
