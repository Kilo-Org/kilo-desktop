import path from "node:path";

import { test } from "../fixtures.js";

test.use({ appIsolationKey: "git-worktrees" });

test.describe("Git worktrees @packaged", () => {
	test("runs a worktree session after explicit worktree selection and removes it on session delete @smoke", async ({
		gitWorktreesPage,
		gitRepoFolder,
	}) => {
		await gitWorktreesPage.createWorkspace(gitRepoFolder.path, gitRepoFolder.name);
		await gitWorktreesPage.openNewDraftForWorkspace(gitRepoFolder.name);

		// Select local first so this test does not depend on a persisted/default mode.
		await gitWorktreesPage.switchToLocalMode();
		await gitWorktreesPage.switchToWorktreeMode();

		const session = await gitWorktreesPage.sendFirstMessage("Git worktree smoke test");

		const { directory, branch } = await gitWorktreesPage.assertWorktreeSession(
			gitRepoFolder.path,
			session,
		);
		const worktreeName = path.basename(directory);

		await gitWorktreesPage.deleteSessionViaRowMenu(gitRepoFolder.name, worktreeName);
		await gitWorktreesPage.assertWorktreeRemoved(gitRepoFolder.path, directory, branch);
	});

	test("local mode keeps the checkout branch selector", async ({
		gitWorktreesPage,
		gitRepoFolder,
	}) => {
		await gitWorktreesPage.createWorkspace(gitRepoFolder.path, gitRepoFolder.name);
		await gitWorktreesPage.openNewDraftForWorkspace(gitRepoFolder.name);

		await gitWorktreesPage.switchToLocalMode();
		await gitWorktreesPage.assertLocalModeShowsBranchSelector("main");
	});

	test("picking an existing worktree from a new draft reuses it for the next session", async ({
		gitWorktreesPage,
		gitRepoFolder,
	}) => {
		await gitWorktreesPage.createWorkspace(gitRepoFolder.path, gitRepoFolder.name);
		await gitWorktreesPage.openNewDraftForWorkspace(gitRepoFolder.name);
		await gitWorktreesPage.switchToLocalMode();
		await gitWorktreesPage.switchToWorktreeMode();
		const firstSession = await gitWorktreesPage.sendFirstMessage("First worktree session");
		const { directory } = await gitWorktreesPage.assertWorktreeSession(
			gitRepoFolder.path,
			firstSession,
		);
		const worktreeName = path.basename(directory);

		await gitWorktreesPage.openNewDraftForWorkspace(gitRepoFolder.name);
		await gitWorktreesPage.selectExistingWorktree(worktreeName);
		const secondSession = await gitWorktreesPage.sendFirstMessage("Second session, same worktree");

		if (secondSession.directory !== directory) {
			throw new Error(
				`Expected the second session to reuse "${directory}", got "${secondSession.directory}".`,
			);
		}
		await gitWorktreesPage.assertComposerShowsWorktreeName(worktreeName);
	});
});
