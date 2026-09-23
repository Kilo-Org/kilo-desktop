import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GitService } from "./git-service.js";

const directories: string[] = [];
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

function tempDir(): string {
	const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "git-actions-")));
	directories.push(directory);
	return directory;
}

function initRepo(): string {
	const repo = tempDir();
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.email", "git-plugin@example.com"]);
	git(repo, ["config", "user.name", "Git Plugin Test"]);
	git(repo, ["config", "commit.gpgsign", "false"]);
	return repo;
}

function commitFile(repo: string, file: string, contents: string, message: string): void {
	fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
	fs.writeFileSync(path.join(repo, file), contents);
	git(repo, ["add", file]);
	git(repo, ["commit", "-m", message]);
}

function service(...folders: string[]): GitService {
	return new GitService({
		logger,
		getWorkspaceFolderPaths: () => Promise.resolve(folders),
	});
}

describe("GitService repository actions (real git)", () => {
	it("commits exactly the index staged for message generation", async () => {
		const repo = initRepo();
		commitFile(repo, "a.txt", "one\n", "initial");
		fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
		fs.writeFileSync(path.join(repo, "new.txt"), "new\n");
		const gitService = service(repo);

		const context = await gitService.stageChanges(repo);
		fs.writeFileSync(path.join(repo, "late.txt"), "written while generating\n");
		await gitService.commit(repo, "Add two");

		expect(context.diffPatch).toContain("+two");
		expect(context.diffPatch).toContain("new.txt");
		expect(context.recentCommitSubjects).toEqual(["initial"]);
		expect(git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort()).toEqual([
			"a.txt",
			"new.txt",
		]);
		expect(git(repo, ["status", "--porcelain"])).toBe("?? late.txt");
	});

	it("counts tracked and untracked changed lines, skipping binary files", async () => {
		const repo = initRepo();
		commitFile(repo, "a.txt", "one\ntwo\nthree\n", "initial");
		fs.writeFileSync(path.join(repo, "a.txt"), "one\n++ plus-prefixed\nthree\n");
		fs.writeFileSync(path.join(repo, "untracked.txt"), "x\ny");
		fs.writeFileSync(path.join(repo, "blob.bin"), Buffer.from([0, 1, 2, 3]));

		await expect(service(repo).workingTreeStats(repo)).resolves.toEqual({
			additions: 3,
			deletions: 1,
		});
	});

	it("counts changes in an unborn repository against the empty tree", async () => {
		const repo = initRepo();
		fs.writeFileSync(path.join(repo, "staged.txt"), "a\nb\n");
		git(repo, ["add", "staged.txt"]);

		await expect(service(repo).workingTreeStats(repo)).resolves.toEqual({
			additions: 2,
			deletions: 0,
		});
	});

	it("builds pull request context from origin's base branch, not a stale local one", async () => {
		const upstream = initRepo();
		commitFile(upstream, "base.txt", "base\n", "initial");
		const remote = tempDir();
		git(remote, ["init", "--bare", "-b", "main"]);
		git(upstream, ["remote", "add", "origin", remote]);
		git(upstream, ["push", "origin", "main"]);

		const clone = tempDir();
		git(clone, ["clone", remote, "."]);
		git(clone, ["config", "user.email", "git-plugin@example.com"]);
		git(clone, ["config", "user.name", "Git Plugin Test"]);
		git(clone, ["config", "commit.gpgsign", "false"]);

		commitFile(upstream, ".github/pull_request_template.md", "## Problem\n", "Merged elsewhere");
		git(upstream, ["push", "origin", "main"]);
		git(clone, ["fetch", "origin"]);
		git(clone, ["checkout", "-b", "feature", "origin/main"]);
		commitFile(clone, "feature.txt", "feature\n", "Add feature");

		const context = await service(clone).pullRequestContext(clone, "main");

		expect(context.commitSummary).toContain("Add feature");
		expect(context.commitSummary).not.toContain("Merged elsewhere");
		expect(context.pullRequestTemplate).toBe("## Problem");
	});

	it("truncates an oversized pull request diff instead of failing", async () => {
		const repo = initRepo();
		commitFile(repo, "base.txt", "base\n", "initial");
		git(repo, ["checkout", "-b", "feature"]);
		commitFile(repo, "large.txt", `${"x".repeat(100)}\n`.repeat(5_000), "Add large file");

		const context = await service(repo).pullRequestContext(repo, "main");

		expect(context.diffPatch.length).toBeLessThan(61_000);
		expect(context.diffPatch.endsWith("[truncated]")).toBe(true);
	});
});
