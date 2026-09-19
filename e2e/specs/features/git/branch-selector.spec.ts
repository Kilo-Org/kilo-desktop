import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-branch-selector-smoke" });

test.describe("Git branch selector @smoke", () => {
	test("opens the grouped branch popover in a workspace chat's composer", async ({
		appShellPage,
		branchSelectorPage,
		gitBranchWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await branchSelectorPage.openInWorkspaceChat(gitBranchWorkspace.path, gitBranchWorkspace.name);
		await branchSelectorPage.verifyGroupedPopover();
	});
});
