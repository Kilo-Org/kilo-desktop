import { test } from "../fixtures.js";

test.describe("Anaconda account", () => {
	test("contributes a signed-out Anaconda row to Account settings @smoke", async ({
		appShellPage,
		anacondaAccountPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAccountSettings();
		await anacondaAccountPage.verifySignedOutRow();
	});
});
