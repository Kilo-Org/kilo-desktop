import { test } from "../../../fixtures/features/sessions.js";

test.describe("Session list @packaged", () => {
	test("starts, renames, pins, archives and deletes a session @smoke", async ({
		appShellPage,
		sessionListPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await sessionListPage.startSessionFromLauncher();
		await sessionListPage.verifyListed("New session");
		// Titled as Kilo titles a new chat, though no agent was started.
		await sessionListPage.verifyOpen(/^New session - \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

		await sessionListPage.rename("New session", "Smoke session");
		await sessionListPage.verifyOpen("Smoke session");
		await sessionListPage.pin("Smoke session");
		await sessionListPage.archive("Smoke session");
		await sessionListPage.delete("Smoke session");
	});
});
