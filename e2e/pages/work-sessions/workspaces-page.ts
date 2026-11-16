import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocatorByTestId,
	pressPageKeyboard,
} from "@anaconda/playwright-utils";

import { runFromCommandPalette } from "../shell/command-palette.js";

/**
 * Page object for kilo.work-sessions' workspace dialogs (a kilo.shell dialog),
 * reached through their commands in the command palette.
 */
export class WorkspacesPage {
	private readonly formDialog = () => getLocatorByTestId("workspace-form-dialog");
	private readonly manager = () => getLocatorByTestId("workspace-manager-dialog");

	/** Adds a workspace from the folder the (stubbed) native picker returns. */
	async addWorkspaceFromPicker(folderName: string): Promise<void> {
		await runFromCommandPalette("kilo.work-sessions/add-workspace");
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
		await runFromCommandPalette("kilo.work-sessions/manage-workspaces");
		await expectElementToBeVisible(
			this.manager().getByText(name, { exact: true }),
			`Manage workspaces should list ${name}`,
		);
		await pressPageKeyboard("Escape");
	}
}
