import { test } from "../../fixtures/shell/account.js";

test.beforeEach(async ({ appShellPage, accountPage }) => {
	await appShellPage.verifyShellIsLoaded();
	await appShellPage.openSettings();
	await appShellPage.openAccountSettings();
	await accountPage.waitForAccountSettled();
});

test.describe("Account settings @smoke", () => {
	test("verifies account page layout", async ({ accountPage }) => {
		await accountPage.verifyPageHeading();
		await accountPage.verifyPageDescription();
		await accountPage.verifyAccountsRegion();
	});

	test("verifies kilo row when signed in", async ({ accountPage }) => {
		await accountPage.verifyKiloRowTitle();
		await accountPage.verifyKiloSignedInEmail();
		await accountPage.verifySignOutButtonVisible();
	});

	test("shows the signed-in account at the foot of the sidebar", async ({ appShellPage }) => {
		await appShellPage.leaveSettings();
		await appShellPage.verifySidebarAccountSignedIn();
	});
});
