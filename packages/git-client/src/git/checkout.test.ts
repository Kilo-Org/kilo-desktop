import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createGitClient } from "../client.js";
import { GitErrorCode } from "../exec/errors.js";
import { isGitError } from "./core.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	initializeWithRemote,
	makeCommit,
	noopLogger,
} from "../test/util.js";

afterEach(cleanupTestDirs);

describe("git/checkout", () => {
	describe("checkoutBranch", () => {
		it("switches to the given branch", async () => {
			const repoPath = await initialize("checkout-switch", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# main\n" }],
			});
			await gitExec(["branch", "feature"], repoPath);
			const git = createGitClient({ path: repoPath, logger: noopLogger });

			await git.checkoutBranch("feature");

			const status = await git.status();
			expect(status?.currentBranch).toBe("feature");
		});

		it("creates a local tracking branch from a remote-tracking ref", async () => {
			const { path: repoPath } = await initializeWithRemote("checkout-track");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# main\n" }],
			});
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
			await gitExec(["push", "origin", "HEAD:feature"], repoPath);
			await gitExec(["fetch", "origin"], repoPath);
			const git = createGitClient({ path: repoPath, logger: noopLogger });

			await git.checkoutBranch("origin/feature", { track: true });

			const status = await git.status();
			expect(status?.currentBranch).toBe("feature");
			expect(status?.currentUpstreamBranch).toBe("origin/feature");
		});

		it("honors a cwd override distinct from the client path", async () => {
			const repoPath = await initialize("checkout-cwd", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# main\n" }],
			});
			await gitExec(["branch", "feature"], repoPath);
			const clientFromElsewhere = createGitClient({
				path: await createTestDir("checkout-cwd-outside"),
				logger: noopLogger,
			});

			await clientFromElsewhere.checkoutBranch("feature", { cwd: repoPath });

			const status = await createGitClient({ path: repoPath, logger: noopLogger }).status();
			expect(status?.currentBranch).toBe("feature");
		});

		it("rejects an invalid branch name", async () => {
			const repoPath = await initialize("checkout-invalid-ref", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# main\n" }],
			});
			const git = createGitClient({ path: repoPath, logger: noopLogger });

			await expect(git.checkoutBranch("..")).rejects.toThrow(/fatal: invalid reference/);
		});

		it("rejects with LocalChangesOverwritten when a dirty tree conflicts", async () => {
			const repoPath = await initialize("checkout-dirty-tree", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# main\n" }],
			});
			await gitExec(["branch", "feature"], repoPath);
			await gitExec(["checkout", "feature"], repoPath);
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# feature\n" }],
				commitMessage: "feature change",
			});
			await gitExec(["checkout", "main"], repoPath);
			// A conflicting local modification: main's checkout would overwrite it.
			await writeFile(join(repoPath, "README.md"), "# dirty\n");
			const git = createGitClient({ path: repoPath, logger: noopLogger });

			const error = await git.checkoutBranch("feature").then(
				() => {
					throw new Error("expected checkout to reject");
				},
				(error: unknown) => error,
			);

			expect(isGitError(error, GitErrorCode.LocalChangesOverwritten)).toBe(true);
		});
	});
});
