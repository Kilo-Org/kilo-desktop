import { test } from "../../fixtures/git.js";

test.use({ appIsolationKey: "git-branch-selector" });

test.describe("Git branch selector", () => {
	test("opens the grouped branch popover in the launcher", async ({
		appShellPage,
		branchSelectorPage,
		gitBranchWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await branchSelectorPage.openInLauncher(gitBranchWorkspace.path, gitBranchWorkspace.name);
		await branchSelectorPage.verifyGroupedPopover();
	});
});
