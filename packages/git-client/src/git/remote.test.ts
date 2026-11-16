import { afterEach, describe, expect, it } from "vitest";

import { createGitClient } from "../client.js";
import {
	cleanupTestDirs,
	gitExec,
	initialize,
	initializeWithRemote,
	makeCommit,
	noopLogger,
} from "../test/util.js";
import { getRemoteHEAD, listRemotes } from "./remote.js";
import type { ListRemotesExec, RemoteHeadExec } from "./remote.js";

afterEach(cleanupTestDirs);

/**
 * The real executor seam: a git-client bound to the probed path — the git
 * binary is the system boundary and is deliberately not mocked.
 */
function execFor(path: string): RemoteHeadExec & ListRemotesExec {
	const client = createGitClient({ path, logger: noopLogger });
	return (args, name, options) => client.exec(args, name, options);
}

/** A repository with `origin/main` fetched and `origin/HEAD` set to it. */
async function repoWithRemoteHead(): Promise<string> {
	const { path: repoPath } = await initializeWithRemote("remote-head-set", undefined);
	await makeCommit(repoPath, {
		entries: [{ path: "README.md", contents: "# repo\n" }],
	});
	await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
	await gitExec(["fetch", "origin"], repoPath);
	await gitExec(["remote", "set-head", "origin", "main"], repoPath);
	return repoPath;
}

describe("git/remote", () => {
	describe("getRemoteHEAD", () => {
		it("returns the remote's HEAD branch without the remote namespace", async () => {
			const repoPath = await repoWithRemoteHead();

			await expect(getRemoteHEAD(execFor(repoPath), "origin")).resolves.toBe("main");
		});

		it("returns null when the remote HEAD symref is not set", async () => {
			const { path: repoPath } = await initializeWithRemote("remote-head-unset", undefined);
			await makeCommit(repoPath, {
				entries: [{ path: "README.md", contents: "# repo\n" }],
			});
			await gitExec(["push", "-u", "origin", "HEAD:main"], repoPath);
			await gitExec(["fetch", "origin"], repoPath);
			await gitExec(["remote", "set-head", "origin", "--delete"], repoPath);

			await expect(getRemoteHEAD(execFor(repoPath), "origin")).resolves.toBe(null);
		});

		it("returns null for a repository without remotes", async () => {
			const repoPath = await initialize("remote-head-no-remote", "main");

			await expect(getRemoteHEAD(execFor(repoPath), "origin")).resolves.toBe(null);
		});
	});

	describe("listRemotes", () => {
		it("returns an empty array for a repository with no remotes", async () => {
			const repoPath = await initialize("list-remotes-none", "main");

			await expect(listRemotes(execFor(repoPath))).resolves.toEqual([]);
		});

		it("returns [origin] for a repository cloned from a remote", async () => {
			const { path: repoPath } = await initializeWithRemote("list-remotes-origin", undefined);

			const remotes = await listRemotes(execFor(repoPath));
			expect(remotes).toEqual(["origin"]);
		});

		it("returns multiple remotes when more than one is configured", async () => {
			const { path: repoPath, remote: remotePath } = await initializeWithRemote(
				"list-remotes-multi",
				undefined,
			);
			await gitExec(["remote", "add", "upstream", remotePath], repoPath);

			const remotes = await listRemotes(execFor(repoPath));
			expect(remotes).toContain("origin");
			expect(remotes).toContain("upstream");
			expect(remotes).toHaveLength(2);
		});
	});
});
