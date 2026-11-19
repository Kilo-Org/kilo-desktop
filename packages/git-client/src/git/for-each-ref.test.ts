import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
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

function clientFor(path: string) {
	return createGitClient({ path, logger: noopLogger });
}

describe("git/for-each-ref", () => {
	describe("branches", () => {
		it("lists the local branches", async () => {
			const repoPath = await initialize("many-refs", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["branch", "develop"], repoPath);
			await gitExec(["branch", "feature"], repoPath);

			const branches = await clientFor(repoPath).branches();

			expect(branches).toEqual([
				{
					name: "develop",
					upstream: null,
					tip: { sha: expect.any(String) },
					ref: "refs/heads/develop",
				},
				{
					name: "feature",
					upstream: null,
					tip: { sha: expect.any(String) },
					ref: "refs/heads/feature",
				},
				{
					name: "main",
					upstream: null,
					tip: { sha: expect.any(String) },
					ref: "refs/heads/main",
				},
			]);
		});

		it("returns an empty list for a repository without commits", async () => {
			const repoPath = await initialize("empty-repo");

			await expect(clientFor(repoPath).branches()).resolves.toEqual([]);
		});

		it("lists remote-tracking branches when remotes are requested", async () => {
			const { path: repoPath } = await initializeWithRemote("remote-refs", undefined, "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
			await gitExec(["push", "origin", "HEAD:feature"], repoPath);
			await gitExec(["fetch", "origin"], repoPath);

			const branches = await clientFor(repoPath).branches({
				prefixes: ["refs/heads", "refs/remotes"],
			});

			expect(branches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "main", ref: "refs/heads/main" }),
					expect.objectContaining({
						name: "origin/feature",
						ref: "refs/remotes/origin/feature",
					}),
				]),
			);
		});

		it("returns null for a directory that is not a git repository", async () => {
			const plainDir = await createTestDir("plain-dir");
			const client = createGitClient({ logger: noopLogger });

			await expect(client.branches({ cwd: plainDir })).resolves.toBe(null);
		});

		it("keeps nested names and reports the remote-tracking upstream", async () => {
			const { path: repoPath } = await initializeWithRemote("nested-refs", undefined, "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
			await gitExec(["branch", "kilo/nested"], repoPath);
			await gitExec(["push", "origin", "kilo/nested"], repoPath);
			await gitExec(["fetch", "origin"], repoPath);

			const branches = await clientFor(repoPath).branches({
				prefixes: ["refs/heads", "refs/remotes"],
			});

			expect(branches).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "main", upstream: "origin/main" }),
					expect.objectContaining({ name: "kilo/nested", ref: "refs/heads/kilo/nested" }),
					expect.objectContaining({
						name: "origin/kilo/nested",
						ref: "refs/remotes/origin/kilo/nested",
					}),
				]),
			);
		});

		it("names a branch that shares its name with a tag so checking it out keeps HEAD attached", async () => {
			const repoPath = await initialize("branch-tag-collision", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["tag", "release"], repoPath);
			await gitExec(["branch", "release"], repoPath);
			const client = clientFor(repoPath);

			const branches = await client.branches();
			const release = branches?.find((branch) => branch.ref === "refs/heads/release");
			if (release === undefined) throw new Error("refs/heads/release is not listed");
			await client.checkoutBranch(release.name);

			await expect(client.status()).resolves.toMatchObject({ currentBranch: "release" });
		});

		it("names an upstream that shares its name with a tag by the branch name", async () => {
			const repoPath = await initialize("upstream-tag-collision", "main");
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["branch", "release"], repoPath);
			await gitExec(["branch", "--track", "feature", "release"], repoPath);
			// Tagged after tracking is set up: an ambiguous start point would make `--track` fail.
			await gitExec(["tag", "release"], repoPath);

			const branches = await clientFor(repoPath).branches();

			expect(branches).toContainEqual(
				expect.objectContaining({ name: "feature", upstream: "release" }),
			);
		});
	});
});
