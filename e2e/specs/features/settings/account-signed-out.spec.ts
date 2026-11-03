import { test } from "../../../fixtures/features/account.js";
import { SIGNED_OUT_LAUNCH_ENV } from "../../../testdata/account.js";

// Its own worker app, launched signed out. A worker option can't be set inside
// a describe group, so the signed-out specs live in their own file.
test.use({ appLaunchEnv: SIGNED_OUT_LAUNCH_ENV });

test.beforeEach(async ({ appShellPage, accountPage }) => {
	await appShellPage.verifyShellIsLoaded();
	await appShellPage.openSettings();
	await appShellPage.openAccountSettings();
	await accountPage.waitForAccountSettled();
});

test.describe("Account settings signed out @smoke", () => {
	test("verifies kilo row when not signed in", async ({ accountPage }) => {
		await accountPage.verifyKiloRowTitle();
		await accountPage.verifyKiloSignedOutStatus();
		await accountPage.verifySignInButtonEnabled();
		await accountPage.verifySignOutButtonHidden();
		await accountPage.verifyKiloRowCollapsed();
	});

	test("verifies account state after reopening settings", async ({ appShellPage, accountPage }) => {
		await appShellPage.leaveSettings();
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAccountSettings();
		await accountPage.waitForAccountSettled();
		await accountPage.verifyKiloSignedOutStatus();
		await accountPage.verifySignInButtonEnabled();
		await accountPage.verifyKiloRowCollapsed();
	});
});
