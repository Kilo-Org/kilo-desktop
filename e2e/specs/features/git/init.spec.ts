import { test } from "../../../fixtures/features/git.js";

test.use({ appIsolationKey: "git-init" });

test.describe("Git init", () => {
	test("initializes a plain folder from the chat's composer footer @smoke @packaged", async ({
		appShellPage,
		initButtonPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.openNewSession(plainWorkspace.path, plainWorkspace.name);
		await initButtonPage.startChat();
		await initButtonPage.initializeFromFooter();
	});

	test("swaps the footer button for the branch label when git init runs outside the app", async ({
		appShellPage,
		initButtonPage,
		plainWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await initButtonPage.openNewSession(plainWorkspace.path, plainWorkspace.name);
		await initButtonPage.startChat();
		await initButtonPage.initializeOutsideTheApp(plainWorkspace.path);
	});
});
