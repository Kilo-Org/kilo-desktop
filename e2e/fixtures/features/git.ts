import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BranchSelectorPage } from "../../pages/features/git/branch-selector-page.js";
import { ChangesPage } from "../../pages/features/git/changes-page.js";
import { InitButtonPage } from "../../pages/features/git/init-button-page.js";
import { removePathAfterAppStops, test as shellTest } from "../shell.js";

type GitFixtures = {
	changesPage: ChangesPage;
	branchSelectorPage: BranchSelectorPage;
	initButtonPage: InitButtonPage;
	gitWorkspace: { path: string; name: string };
	/** A clone with `origin` (main HEAD + feature) and a checkout history, so the popover has all three groups. */
	gitBranchWorkspace: { path: string; name: string };
	/** A plain folder with files but NO `git init`, so the init entry points have a target. */
	plainWorkspace: { path: string; name: string };
};

/**
 * Minimal git identity env — mirrors GitHub Desktop's `unit-test-env.ts` and
 * VS Code's `smoke.test.ts` suiteSetup pattern. Passed to every `execFileSync`
 * git call so fixture repos never depend on the developer's or runner's global
 * gitconfig for author identity or commit signing.
 *
 * `GIT_CONFIG_NOSYSTEM` prevents system-level gitconfig reads (e.g. Homebrew's
 * `/etc/gitconfig`), and the explicit `GIT_CONFIG_COUNT=0` clears any ambient
 * `GIT_CONFIG_KEY_*` chain the CI runner may have injected (GitHub Actions
 * `checkout` action sets these for the checkout step but leaves them in the
 * environment for subsequent steps). Together they make fixture git calls fully
 * hermetic without needing to manipulate `process.env` globally.
 */
const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_AUTHOR_NAME: "Git Plugin E2E",
	GIT_AUTHOR_EMAIL: "git-plugin-e2e@example.com",
	GIT_COMMITTER_NAME: "Git Plugin E2E",
	GIT_COMMITTER_EMAIL: "git-plugin-e2e@example.com",
	GIT_CONFIG_NOSYSTEM: "1",
	// Clear any GIT_CONFIG_COUNT chain the runner injected (e.g. GitHub
	// Actions checkout sets commit.gpgsign=false via GIT_CONFIG_KEY_*).
	// We set commit.gpgsign=false durably in each repo's local config
	// instead, matching VS Code's smoke-test pattern.
	GIT_CONFIG_COUNT: "0",
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
	initButtonPage: async ({}, use) => {
		await use(new InitButtonPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitWorkspace: async ({}, use) => {
		// A real repository with one uncommitted modification, so the
		// Changes tab has content to stream (proving the kilo-git://
		// protocol round-trip in the packaged binary).
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-git-workspace-"));
		removePathAfterAppStops(workspacePath);
		const git = (args: string[]) =>
			execFileSync("git", ["-C", workspacePath, ...args], { env: HERMETIC_GIT_ENV });
		git(["init", "-b", "main"]);
		// Mirror VS Code smoke.test.ts: set identity and gpgsign durably in
		// local config rather than relying on global gitconfig or per-commit -c flags.
		git(["config", "user.email", "git-plugin-e2e@example.com"]);
		git(["config", "user.name", "Git Plugin E2E"]);
		git(["config", "commit.gpgsign", "false"]);
		await writeFile(path.join(workspacePath, "README.md"), "committed\n");
		git(["add", "README.md"]);
		git(["commit", "-m", "initial"]);
		await writeFile(path.join(workspacePath, "README.md"), "modified\n");
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitBranchWorkspace: async ({}, use) => {
		// Source repo: main (HEAD) + feature. A clone gets origin/HEAD →
		// main; the checkout sequence gives the reflog recency, and the
		// untracked feature populates "Other Branches".
		const basePath = await mkdtemp(path.join(os.tmpdir(), "kilo-git-branch-"));
		removePathAfterAppStops(basePath);
		const git = (dir: string, args: string[]) =>
			execFileSync("git", ["-C", dir, ...args], { env: HERMETIC_GIT_ENV });
		const source = path.join(basePath, "source");
		const remote = path.join(basePath, "remote.git");
		const clone = path.join(basePath, "clone");
		await mkdir(source);
		git(source, ["init", "-b", "main"]);
		git(source, ["config", "user.email", "git-plugin-e2e@example.com"]);
		git(source, ["config", "user.name", "Git Plugin E2E"]);
		git(source, ["config", "commit.gpgsign", "false"]);
		await writeFile(path.join(source, "README.md"), "committed\n");
		git(source, ["add", "README.md"]);
		git(source, ["commit", "-m", "initial"]);
		await mkdir(remote);
		git(remote, ["init", "--bare", "-b", "main"]);
		git(source, ["remote", "add", "origin", remote]);
		git(source, ["push", "-u", "origin", "main"]);
		git(source, ["push", "origin", "HEAD:feature"]);
		await mkdir(clone);
		git(clone, ["clone", remote, "."]);
		// Mirror VS Code smoke.test.ts: set identity and gpgsign on the clone
		// so the packaged app never sees a repo with ambiguous signing config.
		git(clone, ["config", "user.email", "git-plugin-e2e@example.com"]);
		git(clone, ["config", "user.name", "Git Plugin E2E"]);
		git(clone, ["config", "commit.gpgsign", "false"]);
		git(clone, ["checkout", "-b", "topic-a"]);
		git(clone, ["checkout", "main"]);
		await use({ path: clone, name: path.basename(clone) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	plainWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-plain-workspace-"));
		removePathAfterAppStops(workspacePath);
		await writeFile(path.join(workspacePath, "README.md"), "plain folder\n");
		await writeFile(path.join(workspacePath, "notes.txt"), "untracked from the start\n");
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

test.use({ appIsolationKey: "git" });

export const { expect } = test;
