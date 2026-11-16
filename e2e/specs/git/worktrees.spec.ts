import path from "node:path";

import { test } from "../../fixtures/git.js";

test.use({ appIsolationKey: "git-worktrees" });

test.describe("Git worktrees @packaged", () => {
	test("starts a session in a new worktree and removes the worktree when the session is deleted @smoke", async ({
		appShellPage,
		worktreesPage,
		gitWorktreeRepo,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await worktreesPage.openNewSession(gitWorktreeRepo.path, gitWorktreeRepo.name);
		// Local first, so the test does not depend on a remembered isolation choice.
		await worktreesPage.chooseLocal();
		await worktreesPage.chooseNewWorktree();

		const session = await worktreesPage.startSession("Git worktree smoke");
		const worktree = await worktreesPage.verifyWorksInNewWorktree(gitWorktreeRepo.path, session);

		await worktreesPage.deleteSessionAndWorktree(session.title);
		await worktreesPage.verifyWorktreeRemoved(gitWorktreeRepo.path, worktree);
	});

	test("local sessions keep the checkout's branch picker", async ({
		appShellPage,
		worktreesPage,
		gitWorktreeRepo,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await worktreesPage.openNewSession(gitWorktreeRepo.path, gitWorktreeRepo.name);
		await worktreesPage.chooseLocal();
		await worktreesPage.verifyLocalShowsBranchPicker("main");
	});

	test("a new session can reuse an existing worktree", async ({
		appShellPage,
		worktreesPage,
		gitWorktreeRepo,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await worktreesPage.openNewSession(gitWorktreeRepo.path, gitWorktreeRepo.name);
		await worktreesPage.chooseLocal();
		await worktreesPage.chooseNewWorktree();
		const first = await worktreesPage.startSession("First worktree session");
		const worktree = await worktreesPage.verifyWorksInNewWorktree(gitWorktreeRepo.path, first);

		await worktreesPage.openAnotherNewSession(gitWorktreeRepo.name);
		await worktreesPage.chooseExistingWorktree(path.basename(worktree.directory));
		const second = await worktreesPage.startSession("Second session, same worktree");

		await worktreesPage.verifyWorksIn(second, worktree.directory);
		await worktreesPage.verifyWorktreeCount(gitWorktreeRepo.path, 1);
	});
});
