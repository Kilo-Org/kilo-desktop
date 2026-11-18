import { test } from "../../fixtures/work-sessions.js";

test.describe("Session list @packaged", () => {
	test("starts, renames, pins, archives and deletes a session @smoke", async ({
		appShellPage,
		sessionListPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();

		await sessionListPage.startSessionFromNewSessionPage();
		// Titled as Kilo titles a new chat, though no chat was started. Earlier
		// tests in this worker's app can leave other "New session - …" rows, so
		// the session is found by its full, timestamped title.
		const title = await sessionListPage.openTitle(/^New session - \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
		await sessionListPage.verifyListed(title);

		await sessionListPage.rename(title, "Smoke session");
		await sessionListPage.verifyOpen("Smoke session");
		await sessionListPage.pin("Smoke session");
		await sessionListPage.archive("Smoke session");
		await sessionListPage.delete("Smoke session");
	});
});
