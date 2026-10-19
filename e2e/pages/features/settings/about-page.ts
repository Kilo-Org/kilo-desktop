import {
	expectElementToBeDisabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveCount,
	expectElementToHaveText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { aboutData } from "../../../testdata/about.js";

export class AboutPage {
	private readonly aboutSettings = () => getLocatorByTestId("about-settings");
	private readonly loadingPlaceholders = () =>
		this.aboutSettings().locator('[data-slot="skeleton-text"]');
	private readonly pageHeading = () => getLocatorByTestId("settings-section-heading");
	private readonly pageDescription = () => this.aboutSettings().locator("header p");

	private readonly versionSection = () => getLocatorByTestId("about-version");
	private readonly versionNumber = () =>
		this.versionSection().locator('[data-slot="item-title"] code');
	private readonly betaBadge = () => getLocatorByTestId("about-beta-badge");
	private readonly updateStatusMessage = () => getLocatorByTestId("update-status-message");
	private readonly checkForUpdatesButton = () => getLocatorByTestId("update-check");
	private readonly installUpdateButton = () => getLocatorByTestId("update-install");
	private readonly releaseNotes = () => getLocatorByTestId("update-release-notes");

	private readonly updateTrackRow = () =>
		this.versionSection().locator('[data-slot="item"]:has([data-qa-id="update-track"])');
	private readonly updateTrackTitle = () =>
		this.updateTrackRow().locator('[data-slot="item-title"]');
	private readonly updateTrackDescription = () =>
		this.updateTrackRow().locator('[data-slot="item-description"]');
	private readonly updateTrackSelect = () => getLocatorByTestId("update-track");
	private readonly updateTrackValue = () =>
		this.updateTrackSelect().locator('[data-slot="select-value"]');

	private readonly supportSection = () => getLocatorByTestId("about-support");
	private readonly supportHeading = () => this.supportSection().locator("#about-support-heading");
	private readonly supportDescription = () =>
		this.supportSection().locator('[data-slot="field-description"]');

	private readonly applicationLogsRow = () => getLocatorByTestId("about-logs");
	private readonly applicationLogsTitle = () =>
		this.applicationLogsRow().locator('[data-slot="item-title"]');

	private readonly kiloConfigRow = () => getLocatorByTestId("about-global-kilo-config");
	private readonly kiloConfigTitle = () => this.kiloConfigRow().locator('[data-slot="item-title"]');

	/** Update state, the log path, and the Kilo config row each render a skeleton until they load. */
	async waitForAboutSettled(): Promise<void> {
		await expectElementToBeVisible(this.aboutSettings(), "About settings should open");
		await expectElementToHaveCount(this.loadingPlaceholders(), 0, {
			message: "About settings should finish loading update state, log path, and Kilo config",
		});
	}

	async verifyPageHeading(): Promise<void> {
		await expectElementToBeVisible(this.pageHeading(), "About page heading should be visible");
		await expectElementToHaveText(this.pageHeading(), aboutData.pageTitle, {
			message: "About page should open with its section heading",
		});
	}

	async verifyPageDescription(): Promise<void> {
		await expectElementToBeVisible(
			this.pageDescription(),
			"About page header should show a description",
		);
		await expectElementToHaveText(this.pageDescription(), aboutData.pageDescription, {
			message: "About page header should show the section description",
		});
	}

	async verifyVersionSectionVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.versionSection(),
			"About page should show the version and updates card",
		);
	}

	async verifySupportSectionVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.supportSection(),
			"About page should show the Support section in the packaged app",
		);
	}

	async verifyVersionNumber(): Promise<void> {
		await expectElementToBeVisible(this.versionNumber(), "About should display the app version");
		await expectElementToHaveText(this.versionNumber(), aboutData.versionPattern, {
			message: "App version should be a semantic version",
		});
	}

	async verifyBetaBadge(): Promise<void> {
		await expectElementToBeVisible(this.betaBadge(), "About should label the app as beta");
		await expectElementToHaveText(this.betaBadge(), aboutData.betaBadgeLabel, {
			message: "Beta badge should read Beta",
		});
	}

	async verifyUpdatesUnavailableMessage(): Promise<void> {
		await expectElementToBeVisible(
			this.updateStatusMessage(),
			"About should display the update status",
		);
		await expectElementToHaveText(this.updateStatusMessage(), aboutData.updatesUnavailablePattern, {
			message: "Update status should explain why updates are unavailable without a feed",
		});
	}

	async verifyCheckForUpdatesDisabled(): Promise<void> {
		await expectElementToBeVisible(
			this.checkForUpdatesButton(),
			"About should show the Check for updates button",
		);
		await expectElementToHaveText(this.checkForUpdatesButton(), aboutData.checkForUpdatesLabel, {
			message: "Update button should read Check for updates",
		});
		await expectElementToBeDisabled(
			this.checkForUpdatesButton(),
			"Check for updates should be disabled while updates are unavailable",
		);
	}

	async verifyNoUpdateReadyToInstall(): Promise<void> {
		await expectElementToBeHidden(
			this.installUpdateButton(),
			"Restart to update should not be offered when no update was downloaded",
		);
		await expectElementToBeHidden(
			this.releaseNotes(),
			"Release notes should not be shown when no update is available",
		);
	}

	async verifyUpdateTrackRow(): Promise<void> {
		await expectElementToBeVisible(this.updateTrackRow(), "About should show the update track row");
		await expectElementToHaveText(this.updateTrackTitle(), aboutData.updateTrackTitle, {
			message: "Update track row should be titled Update track",
		});
		await expectElementToHaveText(this.updateTrackDescription(), aboutData.updateTrackDescription, {
			message: "Update track row should describe the stable and preview tracks",
		});
	}

	async verifyUpdateTrackLocked(): Promise<void> {
		await expectElementToBeVisible(
			this.updateTrackSelect(),
			"About should show the update track selector",
		);
		await expectElementToHaveText(this.updateTrackValue(), aboutData.updateTrackValuePattern, {
			message: "Update track selector should show the current track",
		});
		await expectElementToBeDisabled(
			this.updateTrackSelect(),
			"Update track should not be switchable while updates are unavailable",
		);
	}

	async verifySupportHeading(): Promise<void> {
		await expectElementToBeVisible(this.supportHeading(), "Support section should have a heading");
		await expectElementToHaveText(this.supportHeading(), aboutData.supportTitle, {
			message: "Support section heading should read Support",
		});
		await expectElementToHaveText(this.supportDescription(), aboutData.supportDescription, {
			message: "Support section should explain what the information is for",
		});
	}

	async verifyApplicationLogsTitle(): Promise<void> {
		await expectElementToBeVisible(
			this.applicationLogsRow(),
			"Support should list the application logs row",
		);
		await expectElementToHaveText(this.applicationLogsTitle(), aboutData.applicationLogsTitle, {
			message: "Application logs row should be titled Application logs",
		});
	}

	async verifyKiloConfigTitle(): Promise<void> {
		await expectElementToBeVisible(this.kiloConfigRow(), "Support should list the Kilo config row");
		await expectElementToHaveText(this.kiloConfigTitle(), aboutData.kiloConfigTitle, {
			message: "Kilo config row should be titled Kilo config",
		});
	}
}
