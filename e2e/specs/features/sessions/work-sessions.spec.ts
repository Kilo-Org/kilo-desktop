import { test } from "../../../fixtures/features/sessions.js";

test.describe("Work sessions @packaged", () => {
	test("creates two sessions, switches between them and keeps both across a reload @smoke", async ({
		appShellPage,
		sessionListPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await sessionListPage.startSessionFromLauncher();
		await sessionListPage.rename("New session", "Work session A");
		await sessionListPage.startSessionFromLauncher();
		await sessionListPage.rename("New session", "Work session B");
		await sessionListPage.verifyOpen("Work session B");

		await sessionListPage.switchTo("Work session A");
		await sessionListPage.reloadWindow();
		await sessionListPage.verifyListed("Work session A");
		await sessionListPage.verifyListed("Work session B");
		await sessionListPage.switchTo("Work session B");

		// Both archived before either is deleted: deleting expands the Archived shelf.
		await sessionListPage.archive("Work session A");
		await sessionListPage.archive("Work session B");
		await sessionListPage.delete("Work session A");
		await sessionListPage.delete("Work session B");
	});
});
