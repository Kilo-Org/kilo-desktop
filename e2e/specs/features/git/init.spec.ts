import { execFileSync } from "node:child_process";

import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-init-smoke" });

test.describe("Git init @smoke", () => {
	test("initializes a plain folder from the composer draft footer button", async ({
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
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-label"),
			"The branch label should replace the init button once the repository exists",
		);
	});

	test("swaps the draft footer button for the branch selector when git init runs externally", async ({
		appShellPage,
		initButtonPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.createWorkspaceChat(plainWorkspace.path, plainWorkspace.name);
		const button = getLocatorByTestId("git-init-draft-button");
		await expectElementToBeVisible(
			button,
			"Initialize Git button should render in the draft footer for a plain workspace folder",
		);

		execFileSync("git", ["-C", plainWorkspace.path, "init"]);

		// The workspace watcher's invalidation refetches repositoryType →
		// the selector replaces the button without any click.
		await button.waitFor({ state: "detached" });
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-selector-trigger"),
			"The branch selector should replace the init button after an external git init",
		);
	});

	test("initializes a plain folder from the Changes tab's error state", async ({
		appShellPage,
		changesPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await changesPage.createAndSelectWorkspace(plainWorkspace.path, plainWorkspace.name);
		await changesPage.openChangesTab();

		const initButton = getLocatorByTestId("git-diff-init");
		await expectElementToBeVisible(
			initButton,
			"Initialize Git button should replace Retry in the 404 error state",
		);
		await click(initButton);
		// A successful init retries the patch load explicitly.
		await changesPage.verifyTabMounted();
	});
});
