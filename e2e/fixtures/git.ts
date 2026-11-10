import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BranchSelectorPage } from "../pages/git/branch-selector-page.js";
import { ChangesPage } from "../pages/git/changes-page.js";
import { InitButtonPage } from "../pages/git/init-button-page.js";
import { WorktreesPage } from "../pages/git/worktrees-page.js";
import { configureHermeticIdentity, git } from "../utils/hermetic-git.js";
import { removePathAfterAppStops } from "./shell.js";
import { test as workSessionsTest } from "./work-sessions.js";

interface Folder {
	readonly path: string;
	readonly name: string;
}

type GitFixtures = {
	changesPage: ChangesPage;
	branchSelectorPage: BranchSelectorPage;
	initButtonPage: InitButtonPage;
	worktreesPage: WorktreesPage;
	/** A repository on `main` with one commit and an uncommitted change to README.md. */
	gitWorkspace: Folder;
	/** A clone with `origin` (main HEAD + feature) and a checkout history, so the popover has all three groups. */
	gitBranchWorkspace: Folder;
	/** A plain folder with files but NO `git init`, so the init entry points have a target. */
	plainWorkspace: Folder;
	/** A clean repository on `main` with one commit: what `git worktree add` needs. */
	gitWorktreeRepo: Folder;
};

/**
 * A new temporary folder, by its realpath: kilo.work-sessions stores folders
 * by their realpath (macOS temp dirs are /var → /private/var symlinks), and
 * watches and diffs those. Removed once the app stops (Windows holds handles).
 */
async function temporaryFolder(prefix: string): Promise<string> {
	const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
	removePathAfterAppStops(folder);
	return folder;
}

/** A repository on `main` whose README.md is committed with `contents`. */
async function initRepository(directory: string, contents: string): Promise<void> {
	git(directory, ["init", "-b", "main"]);
	configureHermeticIdentity(directory);
	await writeFile(path.join(directory, "README.md"), contents);
	git(directory, ["add", "README.md"]);
	git(directory, ["commit", "-m", "initial"]);
}

/**
 * kilo.git's Changes pane, branch picker, Initialize Git button and worktree
 * isolation, over real repositories made per test. Specs start work sessions
 * from kilo.work-sessions' New Session page (with kilo.chat's starter).
 */
export const test = workSessionsTest.extend<GitFixtures>({
	appIsolationKey: "git",
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
	worktreesPage: async ({}, use) => {
		await use(new WorktreesPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitWorktreeRepo: async ({}, use) => {
		const repoPath = await temporaryFolder("kilo-git-worktrees-");
		await initRepository(repoPath, "# worktree repository\n");
		await use({ path: repoPath, name: path.basename(repoPath) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitWorkspace: async ({}, use) => {
		// One uncommitted modification, so the Changes pane has content to
		// stream (proving the kilo-git:// protocol round-trip in the packaged
		// binary).
		const workspacePath = await temporaryFolder("kilo-git-workspace-");
		await initRepository(workspacePath, "committed\n");
		await writeFile(path.join(workspacePath, "README.md"), "modified\n");
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitBranchWorkspace: async ({}, use) => {
		// Source repo: main (HEAD) + feature. A clone gets origin/HEAD →
		// main; the checkout sequence gives the reflog recency, and the
		// untracked feature populates "Other Branches".
		const basePath = await temporaryFolder("kilo-git-branch-");
		const source = path.join(basePath, "source");
		const remote = path.join(basePath, "remote.git");
		const clone = path.join(basePath, "clone");
		await mkdir(source);
		await initRepository(source, "committed\n");
		await mkdir(remote);
		git(remote, ["init", "--bare", "-b", "main"]);
		git(source, ["remote", "add", "origin", remote]);
		git(source, ["push", "-u", "origin", "main"]);
		git(source, ["push", "origin", "HEAD:feature"]);
		await mkdir(clone);
		git(clone, ["clone", remote, "."]);
		// The packaged app never sees a repo with ambiguous signing config.
		configureHermeticIdentity(clone);
		git(clone, ["checkout", "-b", "topic-a"]);
		git(clone, ["checkout", "main"]);
		await use({ path: clone, name: path.basename(clone) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	plainWorkspace: async ({}, use) => {
		const workspacePath = await temporaryFolder("kilo-plain-workspace-");
		await writeFile(path.join(workspacePath, "README.md"), "plain folder\n");
		await writeFile(path.join(workspacePath, "notes.txt"), "untracked from the start\n");
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

export const { expect } = test;
