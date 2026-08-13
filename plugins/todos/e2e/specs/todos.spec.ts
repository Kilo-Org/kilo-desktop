import { test } from "../fixtures.js";

test.describe("Todos @smoke", () => {
	// Todos is behind the `todo-feature` LaunchDarkly flag (default off), and
	// the manifest declares `featureFlag: "todo-feature"` on the nav entry.
	// Packaged e2e builds hit LaunchDarkly with an anonymous context that
	// resolves to the default, so the sidebar entry is hidden entirely —
	// there is no icon to click. This spec asserts that fail-closed default;
	// the happy path is covered by the plugin's browser tests, which mock
	// the flag to on.
	test("hides the Todos nav entry when the todo-feature flag is off", async ({
		appShellPage,
		todosPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await todosPage.verifyNavEntryIsHidden();
	});
});
