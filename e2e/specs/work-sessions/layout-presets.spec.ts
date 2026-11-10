import { test } from "../../fixtures/work-sessions.js";

// A saved default shapes every later empty session, so it gets its own app.
test.use({ appIsolationKey: "layout-presets" });

test.describe("Session layout presets @smoke", () => {
	test("saves the current panes as the default layout and applies it to new sessions after a reload", async ({
		appShellPage,
		layoutPresetsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await layoutPresetsPage.openSessionWithAgentPane();
		await layoutPresetsPage.saveCurrentAsDefault("Layout persistence smoke");
		await layoutPresetsPage.reloadWindow();
		await layoutPresetsPage.verifyNewSessionUsesDefault("Layout persistence smoke");
	});
});
