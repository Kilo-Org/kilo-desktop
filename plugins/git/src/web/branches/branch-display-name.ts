import type { GitBranch } from "../../contracts";

const REMOTE_REF_PREFIX = "refs/remotes/";

/**
 * Label shown in the branch switcher. Remote-tracking refs keep the
 * branch path and drop the remote (`origin/feature` → `feature`), the
 * same way Cursor's branch picker does.
 */
export function branchDisplayName(branch: Pick<GitBranch, "name" | "kind" | "ref">): string {
	if (branch.kind !== "remote" || !branch.ref.startsWith(REMOTE_REF_PREFIX)) {
		return branch.name;
	}
	const afterRemote = branch.ref.slice(REMOTE_REF_PREFIX.length);
	const slash = afterRemote.indexOf("/");
	return slash === -1 ? afterRemote : afterRemote.slice(slash + 1);
}
