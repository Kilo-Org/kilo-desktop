import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BranchSelectorPage } from "../../pages/features/git/branch-selector-page.js";
import { ChangesPage } from "../../pages/features/git/changes-page.js";
import { test as shellTest } from "../shell.js";

type GitFixtures = {
	changesPage: ChangesPage;
	branchSelectorPage: BranchSelectorPage;
	gitWorkspace: { path: string; name: string };
	/** A clone with `origin` (main HEAD + feature) and a checkout history, so the popover has all three groups. */
	gitBranchWorkspace: { path: string; name: string };
};

export const test = shellTest.extend<GitFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	changesPage: async ({}, use) => {
		await use(new ChangesPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	branchSelectorPage: async ({}, use) => {
		await use(new BranchSelectorPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitWorkspace: async ({}, use) => {
		// A real repository with one uncommitted modification, so the
		// Changes tab has content to stream (proving the kilo-git://
		// protocol round-trip in the packaged binary).
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "aad-git-workspace-"));
		const git = (args: string[]) => execFileSync("git", ["-C", workspacePath, ...args]);
		git(["init", "-b", "main"]);
		git(["config", "user.email", "git-plugin-e2e@example.com"]);
		git(["config", "user.name", "Git Plugin E2E"]);
		await writeFile(path.join(workspacePath, "README.md"), "committed\n");
		git(["add", "README.md"]);
		git(["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
		await writeFile(path.join(workspacePath, "README.md"), "modified\n");
		await use({ path: workspacePath, name: path.basename(workspacePath) });
		await rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitBranchWorkspace: async ({}, use) => {
		// Source repo: main (HEAD) + feature. A clone gets origin/HEAD →
		// main; the checkout sequence gives the reflog recency, and the
		// untracked feature populates "Other Branches".
		const basePath = await mkdtemp(path.join(os.tmpdir(), "aad-git-branch-"));
		const git = (dir: string, args: string[]) => execFileSync("git", ["-C", dir, ...args]);
		const source = path.join(basePath, "source");
		const remote = path.join(basePath, "remote.git");
		const clone = path.join(basePath, "clone");
		await mkdir(source);
		git(source, ["init", "-b", "main"]);
		git(source, ["config", "user.email", "git-plugin-e2e@example.com"]);
		git(source, ["config", "user.name", "Git Plugin E2E"]);
		await writeFile(path.join(source, "README.md"), "committed\n");
		git(source, ["add", "README.md"]);
		git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
		await mkdir(remote);
		git(remote, ["init", "--bare", "-b", "main"]);
		git(source, ["remote", "add", "origin", remote]);
		git(source, ["push", "-u", "origin", "main"]);
		git(source, ["push", "origin", "HEAD:feature"]);
		await mkdir(clone);
		git(clone, ["clone", remote, "."]);
		git(clone, ["checkout", "-b", "topic-a"]);
		git(clone, ["checkout", "main"]);
		await use({ path: clone, name: path.basename(clone) });
		await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	},
});

export const { expect } = test;
