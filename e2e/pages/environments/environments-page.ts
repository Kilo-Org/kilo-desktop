import path from "node:path";

import {
	click,
	expectElementToBeEditable,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	getLocatorByTestId,
	getLocatorByText,
	getText,
	isElementVisible,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";
import type { Locator } from "@playwright/test";

import type { CondaSandbox } from "../../fixtures/environments.js";
import { environmentsData } from "../../testdata/environments.js";

/**
 * The Conda Environments settings page body (kilo.environments). Opening the section and its
 * heading belong to `SettingsPage`; this covers the conda bridge's list and toolbar, which
 * settle only after Kilo sign-in and the bridge's warm-up.
 */
export class EnvironmentsPage {
	private readonly sectionDescription = () => getLocatorByTestId("settings-section-description");
	private readonly provider = () => getLocatorByTestId("environments-provider-conda");
	private readonly unavailableMessage = () =>
		getLocatorByTestId("environments-unavailable-message");
	private readonly list = () => getLocatorByTestId("environments-conda-list");
	private readonly emptyList = () => getLocatorByTestId("environments-conda-empty");
	private readonly loadError = () => getLocatorByTestId("environments-conda-error");
	private readonly rows = () => this.list().getByTestId("environments-conda-row");
	private readonly row = (name: string) =>
		this.rows().filter({ has: getLocatorByText(name, { exact: true }) });
	private readonly rowPrefix = (name: string) =>
		this.row(name).getByTestId("environments-conda-prefix");
	private readonly searchInput = () => getLocatorByTestId("environments-search-input");
	private readonly sortMenu = () => getLocatorByTestId("environments-sort-menu");
	private readonly newMenu = () => getLocatorByTestId("environments-new-menu");
	private readonly createItem = () => getLocatorByTestId("environments-create-item");
	private readonly importItem = () => getLocatorByTestId("environments-import-item");

	constructor(private readonly sandbox: CondaSandbox) {}

	/** Waits past sign-in and the bridge's warm-up; fails with the page's error if loading failed. */
	async waitForEnvironmentsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.provider().or(this.unavailableMessage()), {
			message:
				"Conda Environments should open once Kilo sign-in and the conda bridge status resolve",
			timeout: environmentsData.settledTimeoutMs,
		});
		await this.throwIfShown(this.unavailableMessage(), "Conda Environments is unavailable");
		await expectElementToBeVisible(this.list().or(this.emptyList()).or(this.loadError()), {
			message: "The environment list should finish loading once the conda bridge is ready",
			timeout: environmentsData.settledTimeoutMs,
		});
		await this.throwIfShown(this.loadError(), "Conda Environments failed to load");
	}

	private async throwIfShown(failure: Locator, reason: string): Promise<void> {
		if (await isElementVisible(failure, { timeout: 0 })) {
			throw new Error(`${reason}: ${await getText(failure)}`);
		}
	}

	/** Description, toolbar, New environment menu and list of the environments tab. */
	async verifyEnvironmentsTabUi(): Promise<void> {
		await expectElementToHaveText(this.sectionDescription(), environmentsData.description, {
			message: "The page should describe what Conda Environments manages",
		});
		await expectElementToHaveAttribute(
			this.searchInput(),
			"placeholder",
			environmentsData.searchPlaceholder,
			{ message: "The toolbar should offer an environment search field" },
		);
		await expectElementToBeEditable(this.searchInput(), {
			message: "The search field should accept input",
		});
		await expectElementToHaveAttribute(this.sortMenu(), "aria-label", environmentsData.sortLabel, {
			message: "The toolbar should offer a sort button",
		});
		await expectElementToBeEnabled(this.sortMenu(), {
			message: "The sort button should be enabled",
		});
		await expectElementToContainText(this.newMenu(), environmentsData.newEnvironmentLabel, {
			message: "The header should offer a New environment button",
		});
		await click(this.newMenu());
		await expectElementToHaveText(this.createItem(), environmentsData.createItemLabel, {
			message: "New environment should offer creating an environment",
		});
		await expectElementToHaveText(this.importItem(), environmentsData.importItemLabel, {
			message: "New environment should offer importing an environment file",
		});
		await pressPageKeyboard("Escape");
		await expectElementToBeHidden(this.createItem(), {
			message: "Escape should close the New environment menu",
		});
		await expectElementToBeVisible(this.list(), {
			message: "The tab should list the conda environments",
		});
	}

	async verifyEnvironmentListed(name: string): Promise<void> {
		await expectElementToBeVisible(this.row(name), `"${name}" should be listed`);
		await expectElementToHaveText(this.rowPrefix(name), path.join(this.sandbox.envsDir, name), {
			message: `"${name}" should show its location under the sandbox's envs directory`,
		});
	}
}
