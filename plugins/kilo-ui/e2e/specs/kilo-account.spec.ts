import { test } from "../fixtures.js";

test.describe("Kilo account settings @smoke", () => {
	test("opens the Kilo settings section and shows account controls", async ({
		appShellPage,
		kiloAccountPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await kiloAccountPage.openFromSettings();
		await kiloAccountPage.verifyLoginOrSignedIn();
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
	});
});
