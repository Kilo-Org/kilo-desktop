import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	getLocatorByTestId,
	isElementVisible,
} from "@anaconda/playwright-utils";

import {
	SETTINGS_GROUPS,
	SETTINGS_SECTIONS,
	type SettingsSection,
} from "../../testdata/settings.js";

export class SettingsPage {
	private readonly settingsIcon = () => getLocatorByTestId("nav-settings");
	private readonly sidebar = () => getLocatorByTestId("settings-sidebar");
	private readonly backButton = () => getLocatorByTestId("settings-back");
	private readonly search = () => getLocatorByTestId("settings-search");
	private readonly sectionNav = () => getLocatorByTestId("settings-section-nav");
	private readonly contentPane = () => getLocatorByTestId("settings-page");
	private readonly sectionGroup = (id: string) => getLocatorByTestId(`settings-group-${id}`);
	private readonly sectionEntry = (id: string) => getLocatorByTestId(`settings-section-${id}`);
	private readonly sectionHeading = () => getLocatorByTestId("settings-section-heading");
	private readonly sectionContent = (testId: string) => getLocatorByTestId(testId);
	private readonly signInGate = () => getLocatorByTestId("kilo-auth-gate-signin");
	private readonly signInButton = () => getLocatorByTestId("kilo-auth-gate-sign-in-button");

	async clickSettingsIcon(): Promise<void> {
		await click(this.settingsIcon());
	}

	async openSection(section: SettingsSection): Promise<void> {
		await click(this.sectionEntry(section.id));
	}

	/** Whether this build registers the section (flag-gated sections may be absent). */
	async isSectionListed(section: SettingsSection): Promise<boolean> {
		await expectElementToBeVisible(this.sidebar(), "Settings should take over the app sidebar");
		return isElementVisible(this.sectionEntry(section.id));
	}

	async verifyLayout(): Promise<void> {
		await this.verifySidebar();
		await this.verifyContentPane();
		await this.verifySectionGroups();
		await this.verifySectionEntries();
	}

	async verifySidebar(): Promise<void> {
		await expectElementToBeVisible(this.sidebar(), "Settings should take over the app sidebar");
		await expectElementToHaveText(this.backButton(), "Back to app", {
			message: "Sidebar should offer a Back to app control",
		});
		await expectElementToHaveAttribute(this.search(), "placeholder", "Search settings", {
			message: "Sidebar should offer a settings search field",
		});
		await expectElementToBeVisible(this.sectionNav(), "Sidebar should list the settings sections");
	}

	async verifyContentPane(): Promise<void> {
		await expectElementToBeVisible(this.contentPane(), "Settings content pane should be visible");
	}

	async verifySectionGroups(): Promise<void> {
		for (const group of SETTINGS_GROUPS) {
			await expectElementToHaveText(this.sectionGroup(group.id), group.label, {
				message: `Sidebar should show the "${group.label}" settings group`,
			});
		}
	}

	async verifySectionEntries(): Promise<void> {
		for (const section of SETTINGS_SECTIONS) {
			await expectElementToHaveText(this.sectionEntry(section.id), section.title, {
				message: `Sidebar should list the "${section.title}" section`,
			});
		}
	}

	async verifySectionOpened(section: SettingsSection): Promise<void> {
		await this.verifySectionActive(section);
		if (section.contentTestId) {
			await expectElementToBeVisible(
				this.sectionContent(section.contentTestId),
				`"${section.title}" should show its content once Kilo authentication resolves`,
			);
		}
		await this.verifySectionHeading(section);
	}

	async verifySectionOpenedSignedOut(section: SettingsSection): Promise<void> {
		await this.verifySectionActive(section);
		if (!section.signInGated) {
			await this.verifySectionHeading(section);
			await expectElementToBeHidden(
				this.signInButton(),
				`"${section.title}" should not ask a signed-out user to sign in`,
			);
			return;
		}
		await expectElementToContainText(
			this.signInGate(),
			`${section.title} requires a Kilo account. Sign in to continue.`,
			{ message: `"${section.title}" should ask a signed-out user to sign in to Kilo` },
		);
		await expectElementToBeVisible(
			this.signInButton(),
			`"${section.title}" should show a Sign in button for a signed-out user`,
		);
		await expectElementToBeHidden(
			this.sectionHeading(),
			`"${section.title}" content should stay hidden until the user signs in`,
		);
	}

	private async verifySectionActive(section: SettingsSection): Promise<void> {
		await expectElementToHaveAttribute(this.sectionEntry(section.id), "aria-current", "page", {
			message: `"${section.title}" should be the active sidebar entry after selecting it`,
		});
	}

	private async verifySectionHeading(section: SettingsSection): Promise<void> {
		await expectElementToHaveText(this.sectionHeading(), section.title, {
			message: `"${section.title}" section should open with its page heading`,
		});
	}
}
