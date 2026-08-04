import {
	click,
	expectElementToBeVisible,
	getLocatorByRole,
	getLocatorByText,
} from "@anaconda/playwright-utils";

export class WorkspacesPage {
	async createWorkspaceFromFolder(folderName: string): Promise<void> {
		await click(getLocatorByRole("combobox", { name: "Select workspace" }));
		await click(getLocatorByText("Create workspace", { exact: true }));
		await click(getLocatorByRole("button", { name: /Drop folders/ }));
		await click(getLocatorByRole("button", { name: "Create workspace" }));
		await expectElementToBeVisible(
			getLocatorByText(folderName, { exact: true }),
			`Workspace selector should display the folder-derived name "${folderName}"`,
		);
	}
}
