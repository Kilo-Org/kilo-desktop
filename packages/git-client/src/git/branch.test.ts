import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import {
	cleanupTestDirs,
	createTestDir,
	gitExec,
	initialize,
	makeCommit,
	noopLogger,
} from "../test/util.js";

afterEach(cleanupTestDirs);

describe("git/branch", () => {
	describe("createBranch", () => {
		it("creates a branch at the current HEAD", async () => {
			const repoPath = await initialize("branch-head", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "# Test" }] });

			await createGitClient({ path: repoPath, logger: noopLogger }).createBranch("feature");

			const branches = await createGitClient({ path: repoPath, logger: noopLogger }).branches();
			const feature = branches?.find((branch) => branch.name === "feature");
			const head = await gitExec(["rev-parse", "HEAD"], repoPath);
			expect(feature).toMatchObject({
				ref: "refs/heads/feature",
				tip: { sha: head.stdout.trim() },
			});
		});

		it("creates a branch at an explicit start point", async () => {
			const repoPath = await initialize("branch-start-point", "main");
			await makeCommit(repoPath, { entries: [{ path: "first.md", contents: "first" }] });
			await makeCommit(repoPath, { entries: [{ path: "second.md", contents: "second" }] });

			await createGitClient({ path: repoPath, logger: noopLogger }).createBranch(
				"feature",
				"HEAD~1",
			);

			const branches = await createGitClient({ path: repoPath, logger: noopLogger }).branches();
			const feature = branches?.find((branch) => branch.name === "feature");
			const startPoint = await gitExec(["rev-parse", "HEAD~1"], repoPath);
			expect(feature).toMatchObject({ tip: { sha: startPoint.stdout.trim() } });
			const main = branches?.find((branch) => branch.name === "main");
			const head = await gitExec(["rev-parse", "HEAD"], repoPath);
			expect(main).toMatchObject({ tip: { sha: head.stdout.trim() } });
		});

		it("honors a cwd override distinct from the client path", async () => {
			const repoPath = await initialize("branch-cwd", "main");
			await makeCommit(repoPath, { entries: [{ path: "README.md", contents: "hello" }] });
			const clientFromElsewhere = createGitClient({
				path: await createTestDir("branch-cwd-outside"),
				logger: noopLogger,
			});

			await clientFromElsewhere.createBranch("feature", undefined, { cwd: repoPath });

			const branches = await createGitClient({ path: repoPath, logger: noopLogger }).branches();
			expect(branches?.find((branch) => branch.name === "feature")).toBeDefined();
		});
	});
});
