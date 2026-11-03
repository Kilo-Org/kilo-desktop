import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-changes" });

test.describe("Git changes pane @smoke @packaged", () => {
	test("opens the Changes pane in a workspace session", async ({
		appShellPage,
		changesPage,
		gitWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.startSessionInWorkspace(gitWorkspace.path, gitWorkspace.name);
		await changesPage.openChangesPane();
		await changesPage.verifyPaneMounted();
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
		await changesPage.startSessionInWorkspace(gitWorkspace.path, gitWorkspace.name);
		await changesPage.openChangesPane();
		await changesPage.verifyPaneMounted();
		await changesPage.expectTreePaths(["README.md"]);

		await changesPage.writeWorkingTreeFile(gitWorkspace.path, "newfile.txt", "hey there\n");
		await changesPage.expectTreePaths(["README.md", "newfile.txt"]);

		await changesPage.stageAndCommitAll(gitWorkspace.path, "second");
		await changesPage.expectNoChanges();
	});
});

test.describe("Git changes pane init", () => {
	test("initializes a plain folder from the Changes pane's error state", async ({
		appShellPage,
		changesPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.startSessionInWorkspace(plainWorkspace.path, plainWorkspace.name);
		await changesPage.openChangesPane();

		await changesPage.initializeFromErrorState();
	});
});
