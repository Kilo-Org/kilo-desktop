import { test } from "../../../fixtures/features/account.js";

test.describe("Account settings @smoke", () => {
	test.beforeEach(async ({ appShellPage, accountPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await appShellPage.openAccountSettings();
		await accountPage.waitForAccountSettled();
	});

	test("verifies account page layout", async ({ accountPage }) => {
		await accountPage.verifyPageHeading();
		await accountPage.verifyPageDescription();
		await accountPage.verifyAccountsRegion();
	});

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
