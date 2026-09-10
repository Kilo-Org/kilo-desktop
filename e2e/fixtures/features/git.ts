import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChangesPage } from "../../pages/features/git/changes-page.js";
import { test as shellTest } from "../shell.js";

type GitFixtures = {
	changesPage: ChangesPage;
	gitWorkspace: { path: string; name: string };
};

export const test = shellTest.extend<GitFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	changesPage: async ({}, use) => {
		await use(new ChangesPage());
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
});

export const { expect } = test;
