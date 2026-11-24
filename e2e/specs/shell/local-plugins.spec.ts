import { EXAMPLE_PLUGIN_FOLDER, test } from "../../fixtures/shell/local-plugins.js";

test.describe("Local plugins @smoke @packaged", () => {
	test("loads an approved plugin from the plugins folder into the packaged app", async ({
		appShellPage,
		localPluginsPage,
		localPluginsProfile,
	}) => {
		const firstLaunch = await localPluginsProfile.launch();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localPluginsPage.open();
		await localPluginsPage.enable();
		await localPluginsProfile.allowApprovals(firstLaunch);
		await localPluginsPage.approve(EXAMPLE_PLUGIN_FOLDER);

		await localPluginsProfile.launch();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await localPluginsPage.open();
		await localPluginsPage.verifyActive(EXAMPLE_PLUGIN_FOLDER);
		await localPluginsPage.openExamplePage();
		await localPluginsPage.countOnce();
	});
});
