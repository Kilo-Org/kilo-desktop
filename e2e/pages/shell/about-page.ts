import { stat } from "node:fs/promises";

import {
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveCount,
	expectElementToHaveText,
	getLocatorByTestId,
	getText,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";

import { aboutData } from "../../testdata/about.js";

type RevealedPaths = { __kiloE2eRevealedPaths?: string[] };
type FileManagerStubScope = typeof globalThis &
	RevealedPaths & { __kiloE2eOriginalShowItemInFolder?: (fullPath: string) => void };

/**
 * "Show in Finder" opens an OS window Playwright cannot observe or close, so
 * `stubFileManager` swaps `shell.showItemInFolder` in the main process for a
 * recorder. The click still travels the real renderer → IPC → main path.
 */
export class AboutPage {
	constructor(private readonly app: ElectronApplication) {}

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
	private readonly applicationLogsPath = () =>
		this.applicationLogsRow().locator('[data-slot="item-description"] code');
	private readonly showLogFileButton = () => getLocatorByTestId("about-show-log-file");

	private readonly kiloConfigTitle = () => this.kiloConfigRow().locator('[data-slot="item-title"]');
	private readonly kiloConfigDescription = () =>
		this.kiloConfigRow().locator('[data-slot="item-description"]');
	private readonly kiloConfigPath = () =>
		this.kiloConfigRow().locator('[data-slot="item-description"] code');
	private readonly showKiloConfigButton = () => getLocatorByTestId("about-show-global-kilo-config");

	private readonly legalSection = () => getLocatorByTestId("about-legal");
	private readonly legalHeading = () => this.legalSection().locator("#about-legal-heading");
	private readonly viewThirdPartyNoticesButton = () =>
		getLocatorByTestId("about-view-third-party-notices");
	private readonly showChromiumNoticesButton = () =>
		getLocatorByTestId("about-show-chromium-notices");
	private readonly legalDocument = () => getLocatorByTestId("legal-document");
	private readonly legalDocumentTitle = () => this.legalDocument().getByRole("heading");
	private readonly legalDocumentText = () => getLocatorByTestId("legal-document-text");

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

	async verifyLogFilePath(): Promise<void> {
		await expectElementToBeVisible(
			this.applicationLogsPath(),
			"Application logs row should show the log file path",
		);
		await expectElementToHaveText(this.applicationLogsPath(), aboutData.logFilePathPattern, {
			message: "Log file path should be absolute and point at main.log",
		});
	}

	/** Visibility, label, and enabled state only — clicking opens an OS file manager window. */
	async verifyShowLogFileButton(): Promise<void> {
		await expectElementToBeVisible(
			this.showLogFileButton(),
			"Application logs row should offer to reveal the log file",
		);
		await expectElementToHaveText(this.showLogFileButton(), aboutData.revealInFileManagerLabel, {
			message: "Reveal log button should be named for the platform's file manager",
		});
		await expectElementToBeEnabled(
			this.showLogFileButton(),
			"Reveal log button should be enabled once the log path is known",
		);
	}

	async stubFileManager(): Promise<void> {
		await this.app.evaluate(({ shell }) => {
			const scope = globalThis as FileManagerStubScope;
			scope.__kiloE2eOriginalShowItemInFolder ??= shell.showItemInFolder;
			scope.__kiloE2eRevealedPaths = [];
			shell.showItemInFolder = (fullPath: string) => {
				scope.__kiloE2eRevealedPaths?.push(fullPath);
			};
		});
	}

	async restoreFileManager(): Promise<void> {
		await this.app.evaluate(({ shell }) => {
			const scope = globalThis as FileManagerStubScope;
			if (scope.__kiloE2eOriginalShowItemInFolder) {
				shell.showItemInFolder = scope.__kiloE2eOriginalShowItemInFolder;
			}
			delete scope.__kiloE2eOriginalShowItemInFolder;
			delete scope.__kiloE2eRevealedPaths;
		});
	}

	async clickShowLogFile(): Promise<void> {
		await click(this.showLogFileButton());
	}

	async verifyLogFileRevealed(): Promise<void> {
		await this.verifyRevealedFilePath(
			await getText(this.applicationLogsPath()),
			"Show in file manager should reveal the log file shown in the row",
		);
	}

	async verifyRevealedFilePath(expected: string | RegExp, message: string): Promise<void> {
		const matcher = typeof expected === "string" ? expected : expect.stringMatching(expected);
		await expect.poll(() => this.revealedPaths(), { message }).toEqual([matcher]);
	}

	/** Every OS file manager is handed the path as-is, so it must name a real file on this machine. */
	async verifyRevealedFileExists(): Promise<void> {
		const [revealedPath] = (await this.revealedPaths()) ?? [];
		if (!revealedPath) throw new Error("Show in file manager should have revealed a path");
		const isFile = await stat(revealedPath).then(
			(stats) => stats.isFile(),
			() => false,
		);
		expect(isFile, `Revealed path should be an existing file: ${revealedPath}`).toBe(true);
	}

	private revealedPaths(): Promise<string[] | undefined> {
		return this.app.evaluate(() => (globalThis as RevealedPaths).__kiloE2eRevealedPaths);
	}

	async verifyKiloConfigTitle(): Promise<void> {
		await expectElementToBeVisible(this.kiloConfigRow(), "Support should list the Kilo config row");
		await expectElementToHaveText(this.kiloConfigTitle(), aboutData.kiloConfigTitle, {
			message: "Kilo config row should be titled Kilo config",
		});
	}

	async verifyKiloConfigNotCreated(): Promise<void> {
		await expectElementToHaveText(
			this.kiloConfigDescription(),
			aboutData.kiloConfigMissingDescription,
			{ message: "Kilo config row should say no global config exists in a fresh profile" },
		);
	}

	async verifyShowKiloConfigButtonDisabled(): Promise<void> {
		await this.verifyShowKiloConfigButtonLabel();
		await expectElementToBeDisabled(
			this.showKiloConfigButton(),
			"Reveal config button should be disabled while no global config file exists",
		);
	}

	async verifyKiloConfigPath(expectedPath: string): Promise<void> {
		await expectElementToHaveText(this.kiloConfigPath(), expectedPath, {
			message: "Kilo config row should show the path of the existing global config",
		});
	}

	async verifyShowKiloConfigButtonEnabled(): Promise<void> {
		await this.verifyShowKiloConfigButtonLabel();
		await expectElementToBeEnabled(
			this.showKiloConfigButton(),
			"Reveal config button should be enabled once a global config file exists",
		);
	}

	private async verifyShowKiloConfigButtonLabel(): Promise<void> {
		await expectElementToBeVisible(
			this.showKiloConfigButton(),
			"Kilo config row should show the reveal button",
		);
		await expectElementToHaveText(this.showKiloConfigButton(), aboutData.revealInFileManagerLabel, {
			message: "Reveal config button should be named for the platform's file manager",
		});
	}

	async verifyLegalSection(): Promise<void> {
		await expectElementToBeVisible(this.legalSection(), "About should show the Legal section");
		await expectElementToHaveText(this.legalHeading(), aboutData.legalTitle, {
			message: "Legal section heading should read Legal",
		});
	}

	/** The notices written beside app.asar at package time, shown in the in-app viewer. */
	async verifyThirdPartyNoticesShown(): Promise<void> {
		await click(this.viewThirdPartyNoticesButton());
		await this.verifyLegalDocument(
			aboutData.thirdPartyNoticesTitle,
			aboutData.thirdPartyNoticesTextPattern,
		);
	}

	async clickShowChromiumNotices(): Promise<void> {
		await click(this.showChromiumNoticesButton());
	}

	private async verifyLegalDocument(title: string, text: RegExp): Promise<void> {
		await expectElementToHaveText(this.legalDocumentTitle(), title, {
			message: `The legal document viewer should be titled ${title}`,
		});
		await expectElementToHaveText(this.legalDocumentText(), text, {
			message: `${title} should be the document the packaged app ships`,
		});
		await getPage().keyboard.press("Escape");
		await expectElementToBeHidden(this.legalDocument(), "The viewer should close on Escape");
	}

	async clickShowKiloConfig(): Promise<void> {
		await click(this.showKiloConfigButton());
	}
}
