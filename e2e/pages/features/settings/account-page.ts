import {
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	getLocator,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { accountData } from "../../../testdata/account.js";

export class AccountPage {
	private readonly accountPage = () => getLocatorByTestId("account-page");
	private readonly pageHeading = () => getLocatorByTestId("settings-section-heading");
	private readonly pageDescription = () => getLocatorByTestId("settings-section-description");
	private readonly accountRows = () => getLocatorByTestId("account-rows");
	private readonly kiloRow = () => getLocatorByTestId("account-kilo-row");
	private readonly settledKiloRow = () =>
		getLocator('[data-qa-id="account-kilo-row"]:not([data-state="loading"])');
	// The status shares the title line ("Kilo · Not signed in."), so target the name itself.
	private readonly kiloRowTitle = () => getLocatorByTestId("account-kilo-title");
	private readonly kiloStatus = () => getLocatorByTestId("account-kilo-status");
	private readonly kiloEmail = () => getLocatorByTestId("account-kilo-email");
	private readonly signInButton = () => getLocatorByTestId("account-kilo-sign-in");
	private readonly signOutButton = () => getLocatorByTestId("account-kilo-sign-out");
	private readonly accountDetailsPanel = () => getLocatorByTestId("kilo-account-settings");

	async waitForAccountSettled(): Promise<void> {
		await expectElementToBeVisible(this.accountPage(), "Account page should open");
		await expectElementToBeVisible(this.settledKiloRow(), {
			message: "Kilo account row should replace its loading skeleton",
		});
	}

	async verifyPageHeading(): Promise<void> {
		await expectElementToHaveText(this.pageHeading(), accountData.pageTitle, {
			message: "Account page should open with its section heading",
		});
	}

	async verifyPageDescription(): Promise<void> {
		await expectElementToBeVisible(
			this.pageDescription(),
			"Account page header should show a description",
		);
		await expectElementToHaveText(this.pageDescription(), accountData.pageDescription, {
			message: "Account page header should describe what the page manages",
		});
	}

	async verifyAccountsRegion(): Promise<void> {
		await expectElementToBeVisible(this.accountRows(), "Account page should list account rows");
		await expectElementToHaveAttribute(
			this.accountRows(),
			"aria-label",
			accountData.accountsRegionLabel,
			{
				message: "Account rows should be labelled as the Accounts region",
			},
		);
	}

	async verifyKiloRowTitle(): Promise<void> {
		await expectElementToBeVisible(this.kiloRowTitle(), "Kilo account row should show its title");
		await expectElementToHaveText(this.kiloRowTitle(), accountData.kiloTitle, {
			message: "Kilo account row should be titled Kilo",
		});
	}

	async verifyKiloSignedOutStatus(): Promise<void> {
		await expectElementToBeVisible(this.kiloStatus(), "Kilo account row should show its status");
		await expectElementToHaveText(this.kiloStatus(), accountData.signedOutStatus, {
			message: "Kilo account row should report that the user is not signed in",
		});
	}

	async verifyKiloSignedInEmail(): Promise<void> {
		await expectElementToHaveText(this.kiloEmail(), accountData.signedInStatus, {
			message: "Kilo account row should show the signed-in account's email",
		});
	}

	async verifySignOutButtonVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.signOutButton(),
			"Sign out should be offered while signed in",
		);
	}

	async verifySignInButtonEnabled(): Promise<void> {
		await expectElementToHaveText(this.signInButton(), accountData.signInLabel, {
			message: "Kilo account row should offer a Sign in button",
		});
		await expectElementToBeEnabled(
			this.signInButton(),
			"Sign in should be enabled while the Kilo connection is available",
		);
	}

	async verifySignOutButtonHidden(): Promise<void> {
		await expectElementToBeHidden(
			this.signOutButton(),
			"Sign out should not be offered without Kilo credentials",
		);
	}

	async verifyKiloRowCollapsed(): Promise<void> {
		await expectElementToHaveAttribute(this.kiloRow(), "data-state", accountData.rowSummaryState, {
			message: "Signed-out Kilo account row should stay collapsed",
		});
		await expectElementToBeHidden(
			this.accountDetailsPanel(),
			"Signed-out Kilo account row should not show account details",
		);
	}
}
