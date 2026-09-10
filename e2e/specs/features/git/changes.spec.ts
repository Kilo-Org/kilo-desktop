import { test } from "../../../fixtures/features/git.js";

test.describe("Git changes tab @smoke", () => {
	test("mounts the Changes tab in a workspace chat's right panel", async ({
		appShellPage,
		changesPage,
		gitWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.createAndSelectWorkspace(gitWorkspace.path, gitWorkspace.name);
		await changesPage.openChangesTab();
		await changesPage.verifyTabMounted();
	});
});
