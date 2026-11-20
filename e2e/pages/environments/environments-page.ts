import path from "node:path";

import {
	expectElementToBeVisible,
	expectElementToHaveText,
	getLocatorByTestId,
	getLocatorByText,
	getText,
	isElementVisible,
} from "@anaconda/playwright-utils";
import type { Locator } from "@playwright/test";

import { type CondaSandbox, environmentsData } from "../../testdata/environments.js";

/**
 * The Conda Environments settings page body (kilo.environments) in the packaged app. Opening the
 * section and its heading belong to `SettingsPage`; the panel's own controls are covered by the
 * plugin's browser tests, so this checks only what needs the real conda bridge: the list settles
 * and shows the sandbox's seeded environment.
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
	// Rows are found by prefix: a host environment may share the seeded name, never its sandbox path.
	private readonly rowAt = (prefix: string) =>
		this.rows().filter({
			has: getLocatorByTestId("environments-conda-prefix").and(
				getLocatorByText(prefix, { exact: true }),
			),
		});
	private readonly rowName = (prefix: string) =>
		this.rowAt(prefix).getByTestId("environments-conda-name");

	constructor(private readonly sandbox: CondaSandbox) {}

	/**
	 * Waits past sign-in and the bridge's warm-up within one `settledTimeoutMs` budget, and fails
	 * with the page's own text if the bridge is unavailable or the list failed to load.
	 */
	async waitForEnvironmentsLoaded(): Promise<void> {
		const deadline = Date.now() + environmentsData.settledTimeoutMs;
		const remaining = () => Math.max(deadline - Date.now(), 1);
		await expectElementToBeVisible(this.provider().or(this.unavailableMessage()), {
			message:
				"Conda Environments should open once Kilo sign-in and the conda bridge status resolve",
			timeout: remaining(),
		});
		await this.throwIfShown(this.unavailableMessage(), "Conda Environments is unavailable");
		await expectElementToBeVisible(this.list().or(this.emptyList()).or(this.loadError()), {
			message: "The environment list should finish loading once the conda bridge is ready",
			timeout: remaining(),
		});
		await this.throwIfShown(this.loadError(), "Conda Environments failed to load");
	}

	async verifySectionDescription(): Promise<void> {
		await expectElementToHaveText(this.sectionDescription(), environmentsData.description, {
			message: "The page should show the description kilo.environments contributes",
		});
	}

	async verifyEnvironmentListed(name: string): Promise<void> {
		const prefix = path.join(this.sandbox.envsDir, name);
		await expectElementToBeVisible(
			this.rowAt(prefix),
			`The sandbox environment at "${prefix}" should be listed`,
		);
		await expectElementToHaveText(this.rowName(prefix), name, {
			message: `The environment at "${prefix}" should be named "${name}"`,
		});
	}

	private async throwIfShown(failure: Locator, reason: string): Promise<void> {
		if (await isElementVisible(failure, { timeout: 0 })) {
			throw new Error(`${reason}: ${await getText(failure)}`);
		}
	}
}
