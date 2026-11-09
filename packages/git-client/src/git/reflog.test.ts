import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import { cleanupTestDirs, gitExec, initialize, makeCommit, noopLogger } from "../test/util.js";
import { getRecentBranches } from "./reflog.js";
import type { RecentBranchesExec } from "./reflog.js";

afterEach(cleanupTestDirs);

/**
 * The real executor seam: a git-client bound to the probed path — the git
 * binary is the system boundary and is deliberately not mocked.
 */
function execFor(path: string): RecentBranchesExec {
	const client = createGitClient({ path, logger: noopLogger });
	return (args, name, options) => client.exec(args, name, options);
}

/**
 * A repository on `main` whose checkout history is
 * feature-a → main → feature-b → main, so the reflog (newest first) is:
 * moving from feature-b to main / main to feature-b /
 * feature-a to main / main to feature-a.
 */
async function repoWithCheckoutHistory(): Promise<string> {
	const repoPath = await initialize("recent-branches", "main");
	await makeCommit(repoPath, {
		entries: [{ path: "README.md", contents: "# repo\n" }],
	});
	await gitExec(["checkout", "-b", "feature-a"], repoPath);
	await gitExec(["checkout", "main"], repoPath);
	await gitExec(["checkout", "-b", "feature-b"], repoPath);
	await gitExec(["checkout", "main"], repoPath);
	return repoPath;
}

describe("git/reflog", () => {
	describe("getRecentBranches", () => {
		it("returns checked out branches in reflog order", async () => {
			const repoPath = await repoWithCheckoutHistory();

			await expect(getRecentBranches(execFor(repoPath), 5)).resolves.toEqual([
				"main",
				"feature-b",
				"feature-a",
			]);
		});

		it("stops at the limit", async () => {
			const repoPath = await repoWithCheckoutHistory();

			await expect(getRecentBranches(execFor(repoPath), 2)).resolves.toEqual(["main", "feature-b"]);
		});

		it("resolves an empty list for an unborn branch", async () => {
			const repoPath = await initialize("recent-branches-unborn", "main");

			await expect(getRecentBranches(execFor(repoPath), 5)).resolves.toEqual([]);
		});

		it("excludes the rename-source name of a renamed branch", async () => {
			const repoPath = await initialize("recent-branches-rename", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["checkout", "-b", "feature"], repoPath);
			await gitExec(["branch", "-m", "feature", "feature-renamed"], repoPath);
			await gitExec(["checkout", "main"], repoPath);

			// The rename-source `feature` was also a checkout target, but it
			// must not surface — only `main` and the rename target remain.
			await expect(getRecentBranches(execFor(repoPath), 5)).resolves.toEqual([
				"main",
				"feature-renamed",
			]);
		});
	});
});
