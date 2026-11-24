import path from "node:path";

import {
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveText,
	expectElementToHaveValue,
	expectElementValueNotToBeEmpty,
	expectElementValueToBeEmpty,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
	getText,
	isElementVisible,
	pressPageKeyboard,
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
	private readonly controls = () => getLocatorByTestId("environments-controls");
	private readonly newEnvironmentMenu = () => getLocatorByTestId("environments-new-menu");
	private readonly createMenuItem = () => getLocatorByTestId("environments-create-item");
	private readonly createDialog = () => getLocatorByTestId("environments-create-dialog");
	private readonly createTitle = () =>
		this.createDialog().getByRole("heading", { name: environmentsData.createDialog.title });
	private readonly createNameInput = () => getLocatorByTestId("environments-create-name");
	private readonly createLocationInput = () => getLocatorByTestId("environments-create-location");
	private readonly createPythonPicker = () => getLocatorByTestId("environments-create-python");
	private readonly createPackageSearch = () =>
		getLocatorByTestId("environments-create-package-search");
	private readonly createSubmit = () => getLocatorByTestId("environments-create-submit");
	private readonly createNameError = () => getLocatorByTestId("environments-create-name-error");
	private readonly createPrefixError = () => getLocatorByTestId("environments-create-prefix-error");

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

	/**
	 * Opens the panel's "New environment" menu and its Create new item. Waits for the location to
	 * arrive from the real bridge's `conda.info`, the one field the popup cannot render without.
	 */
	async openCreateDialog(): Promise<void> {
		await click(this.newEnvironmentMenu());
		await click(this.createMenuItem());
		await expectElementToBeVisible(
			this.createDialog(),
			"Create new should open the Create environment popup",
		);
		await expectElementValueNotToBeEmpty(this.createLocationInput(), {
			message: "The popup should fill its location from conda",
		});
	}

	/** The popup's static scaffold before any name is typed. */
	async verifyCreateDialogScaffold(): Promise<void> {
		await expectElementToBeVisible(
			this.createTitle(),
			"The popup should be titled Create environment",
		);
		await expectElementToContainText(
			this.createDialog(),
			environmentsData.createDialog.description,
			{ message: "The popup should explain what it configures" },
		);
		await expectElementValueToBeEmpty(this.createNameInput(), {
			message: "The popup should open with an empty name",
		});
		await expectElementToBeVisible(
			this.createPythonPicker(),
			"The popup should offer a Python version",
		);
		await expectElementToBeVisible(
			this.createPackageSearch(),
			"The popup should offer a package search",
		);
		await expectElementToBeDisabled(this.createSubmit(), {
			message: "Create should stay disabled until a free name is checked",
		});
	}

	/** The location dropdown offers the worker's sandbox directory, from the real `conda.info`. */
	async verifySandboxLocationIsOffered(): Promise<void> {
		await click(this.createLocationInput());
		const option = getLocatorByRole("option").filter({ hasText: this.sandbox.envsDir });
		await expectElementToBeVisible(
			option,
			`The location list should offer "${this.sandbox.envsDir}"`,
		);
		// Leave the popup's own state as it found it: an open list would swallow the
		// next click on Cancel.
		await pressPageKeyboard("Escape");
		await expectElementToBeHidden(option, "Escape should close the location list");
	}

	/** Points the popup at the worker's sandbox so prefix checks never touch the host's conda. */
	async selectSandboxLocation(): Promise<void> {
		await click(this.createLocationInput());
		const option = getLocatorByRole("option").filter({ hasText: this.sandbox.envsDir });
		await click(option);
		await expectElementToHaveValue(this.createLocationInput(), this.sandbox.envsDir, {
			message: "Picking the sandbox directory should set the location",
		});
	}

	async verifyCreateNameRejected(name: string): Promise<void> {
		await fill(this.createNameInput(), name);
		await expectElementToContainText(
			this.createNameError(),
			environmentsData.createDialog.invalidNameError,
			{ message: `An invalid name like "${name}" should show the name rule` },
		);
		await expectElementToBeDisabled(this.createSubmit(), {
			message: "Create should stay disabled for an invalid name",
		});
	}

	/** The seeded environment already occupies the prefix the typed name would create. */
	async verifySeededNameIsRejected(): Promise<void> {
		const prefix = path.join(this.sandbox.envsDir, environmentsData.seededEnvName);
		await this.selectSandboxLocation();
		await fill(this.createNameInput(), environmentsData.seededEnvName);
		await expectElementToContainText(
			this.createPrefixError(),
			`An environment already exists at ${prefix}.`,
			{ message: "The popup should report the seeded environment at the target prefix" },
		);
		await expectElementToBeDisabled(this.createSubmit(), {
			message: "Create should stay disabled when the prefix holds an environment",
		});
	}

	/** conda keeps `base` for its own root environment; the real prefix check knows that. */
	async verifyReservedNameIsRejected(): Promise<void> {
		const name = environmentsData.createDialog.reservedName;
		await this.selectSandboxLocation();
		await fill(this.createNameInput(), name);
		await expectElementToContainText(this.createPrefixError(), `"${name}" is reserved by conda.`, {
			message: `The popup should refuse conda's reserved name "${name}"`,
		});
		await expectElementToBeDisabled(this.createSubmit(), {
			message: "Create should stay disabled for a reserved name",
		});
	}

	/** A free name in the sandbox passes the real prefix check, the only gate on Create. */
	async verifyFreeNameIsCreatable(): Promise<void> {
		await this.selectSandboxLocation();
		await fill(this.createNameInput(), environmentsData.createDialog.freeName);
		await expectElementToBeEnabled(this.createSubmit(), {
			message: "Create should enable once the free name's prefix checks out",
		});
	}

	async cancelCreateDialog(): Promise<void> {
		await click(this.createDialog().getByRole("button", { name: "Cancel" }));
		await expectElementToBeHidden(this.createDialog(), "Cancel should close the popup");
		await expectElementToBeVisible(
			this.controls(),
			"The environments panel should be back after closing the popup",
		);
	}

	/** Closes the popup when a test leaves it open, so the next test starts at the panel. */
	async dismissCreateDialogIfOpen(): Promise<void> {
		if (!(await isElementVisible(this.createDialog(), { timeout: 0 }))) return;
		// An open location list would swallow the Cancel click; Escape closes the topmost popup.
		await pressPageKeyboard("Escape");
		if (await isElementVisible(this.createDialog(), { timeout: 0 })) {
			await click(this.createDialog().getByRole("button", { name: "Cancel" }));
		}
		await expectElementToBeHidden(this.createDialog(), "The popup should close between tests");
	}

	private async throwIfShown(failure: Locator, reason: string): Promise<void> {
		if (await isElementVisible(failure, { timeout: 0 })) {
			throw new Error(`${reason}: ${await getText(failure)}`);
		}
	}
}
