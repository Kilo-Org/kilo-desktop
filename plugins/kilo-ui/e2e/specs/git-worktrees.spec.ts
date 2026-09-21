import { test } from "../fixtures.js";

test.describe("Git worktrees @smoke", () => {
	test("runs a worktree session after explicit worktree selection and removes it on session delete", async ({
		gitWorktreesPage,
		gitRepoFolder,
	}) => {
		await gitWorktreesPage.createWorkspace(gitRepoFolder.path, gitRepoFolder.name);
		await gitWorktreesPage.openNewDraftForWorkspace(gitRepoFolder.name);

		// The draft footer defaults to local; user must explicitly choose worktree.
		await gitWorktreesPage.assertDraftDefaultsToLocal();
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

		// Shared worker app: the sibling spec persists worktree draft mode.
		await gitWorktreesPage.switchToLocalMode();
		await gitWorktreesPage.assertLocalModeShowsBranchSelector("main");
	});
});
