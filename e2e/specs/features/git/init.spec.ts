import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-init" });

test.describe("Git init", () => {
	test("initializes a plain folder from the composer draft footer button @smoke @packaged", async ({
		appShellPage,
		initButtonPage,
		changesPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.createWorkspaceChat(plainWorkspace.path, plainWorkspace.name);
		await initButtonPage.initializeFromDraftFooter();
		// The kilo-git:// protocol round-trips on the now-unborn repository:
		// the patch diffs against the empty tree, so every file is added.
		await changesPage.openChangesTab();
		await changesPage.verifyTabMounted();
	});

	test("initializes a plain folder from the composer thread footer button", async ({
		appShellPage,
		initButtonPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.createWorkspaceChat(plainWorkspace.path, plainWorkspace.name);
		await initButtonPage.startThread();
		await initButtonPage.initializeFromThreadFooter();
	});

	test("swaps the draft footer button for the branch selector when git init runs externally", async ({
		appShellPage,
		initButtonPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.createWorkspaceChat(plainWorkspace.path, plainWorkspace.name);
		await initButtonPage.initializeExternally(plainWorkspace.path);
	});

	test("initializes a plain folder from the Changes tab's error state", async ({
		appShellPage,
		changesPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.createAndSelectWorkspace(plainWorkspace.path, plainWorkspace.name);
		await changesPage.openChangesTab();

		await changesPage.initializeFromErrorState();
	});
});
