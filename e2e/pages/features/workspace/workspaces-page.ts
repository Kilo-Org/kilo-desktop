import type { ElectronApplication } from "@playwright/test";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";

import { KeyboardShortcutsPage } from "../../shell/keyboard-shortcuts-page.js";

/**
 * Page object for kilo.workspaces' dialogs, reached through their commands in
 * the command palette.
 */
export class WorkspacesPage {
	readonly #shortcuts: KeyboardShortcutsPage;

	constructor(electronApp: ElectronApplication) {
		this.#shortcuts = new KeyboardShortcutsPage(electronApp);
	}

	private readonly formDialog = () => getLocatorByTestId("workspace-form-dialog");
	private readonly manager = () => getLocatorByTestId("workspace-manager-dialog");

	async runCommand(commandKey: string): Promise<void> {
		await this.#shortcuts.openCommandPalette();
		await click(getLocatorByTestId(`command-palette-item-${commandKey}`));
	}

	/** Adds a workspace from the folder the (stubbed) native picker returns. */
	async addWorkspaceFromPicker(folderName: string): Promise<void> {
		await this.runCommand("kilo.workspaces/add");
		await expectElementToBeVisible(this.formDialog(), "Add workspace should open the form");
		await click(getLocatorByTestId("workspace-folder-dropzone"));
		await expectElementToBeVisible(
			this.formDialog().getByText(folderName, { exact: true }),
			"The picked folder should be listed",
		);
		await click(this.formDialog().getByRole("button", { name: "Create workspace" }));
		await expectElementToBeHidden(this.formDialog(), {
			message: "The form should close once the workspace is created",
		});
	}

	async verifyListed(name: string): Promise<void> {
		await this.runCommand("kilo.workspaces/manage");
		await expectElementToBeVisible(
			this.manager().getByText(name, { exact: true }),
			`Manage workspaces should list ${name}`,
		);
		await pressPageKeyboard("Escape");
	}
}
