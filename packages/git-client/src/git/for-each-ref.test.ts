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
			const { path: repoPath, remote } = await initializeWithRemote(
				"remote-refs",
				undefined,
				"main",
			);
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
			expect(remote).toBeTruthy();
		});

		it("returns null for a directory that is not a git repository", async () => {
			const plainDir = await createTestDir("plain-dir");
			const client = createGitClient({ logger: noopLogger });

			await expect(client.branches({ cwd: plainDir })).resolves.toBe(null);
		});
	});
});
