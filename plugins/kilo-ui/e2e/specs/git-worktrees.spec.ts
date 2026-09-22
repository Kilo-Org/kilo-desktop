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

		await gitWorktreesPage.deleteSessionViaRowMenu(gitRepoFolder.name);
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
});
