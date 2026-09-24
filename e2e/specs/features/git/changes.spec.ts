import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-changes" });

test.describe("Git changes tab @smoke @packaged", () => {
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

// Ports VS Code's git extension smoke tests "reflects working tree changes"
// and "stages, commits changes and verifies outgoing change" — both wait on
// the watcher-driven refresh instead of calling repository.status().
test.describe("Git changes live reload @packaged", () => {
	test("reflects working tree edits and terminal commits", async ({
		appShellPage,
		changesPage,
		gitWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.createAndSelectWorkspace(gitWorkspace.path, gitWorkspace.name);
		await changesPage.openChangesTab();
		await changesPage.verifyTabMounted();
		await changesPage.expectTreePaths(["README.md"]);

		await changesPage.writeWorkingTreeFile(gitWorkspace.path, "newfile.txt", "hey there\n");
		await changesPage.expectTreePaths(["README.md", "newfile.txt"]);

		await changesPage.stageAndCommitAll(gitWorkspace.path, "second");
		await changesPage.expectNoChanges();
	});
});
