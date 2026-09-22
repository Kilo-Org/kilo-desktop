import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

export class FilesPage {
	async createAndSelectWorkspace(folderPath: string, name: string): Promise<void> {
		await getPage().evaluate(
			async ({ folderPath, name }) => {
				type InvokeResult =
					| { ok: true; value: unknown }
					| { ok: false; error: { code: string; message: string } };
				type DesktopGlobal = typeof globalThis & {
					desktopApi: {
						invoke(
							channel: "feature:invoke",
							input: { featureId: string; channel: string; args?: unknown },
						): Promise<InvokeResult>;
					};
				};
				const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId: "kilo-ui",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			},
			{ folderPath, name },
		);

		await click(getLocator('[data-slot="aui_thread-list-new"]'));
		await click(getLocatorByRole("combobox", { name: "Select workspace" }));
		await click(getLocatorByText(name, { exact: true }));
	}

	async openFilesPane(): Promise<void> {
		await getLocatorByRole("textbox", { name: "Message input" }).fill("Open the workspace files");
		await click(getLocatorByRole("button", { name: "Send message" }));
		await expectElementToBeVisible(
			getLocatorByTestId("chat-pane-toolbar"),
			"Pane toolbar should be visible after the chat starts",
		);
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		const launchItem = getLocatorByTestId("chat-pane-launch-files.files");
		await expectElementToBeVisible(launchItem, "Files pane launch item should be actionable");
		await click(launchItem);
		await expectElementToBeVisible(
			getLocatorByTestId("files-view"),
			"Files pane should be visible",
		);
	}

	async clickFileInTree(fileName: string): Promise<void> {
		await click(getLocator(`[data-item-path="${fileName}"]`));
	}

	async expectEditorToContain(relativePath: string, text: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByRole("textbox", { name: relativePath }),
			"Editor should be mounted",
		);
		await expectElementToBeVisible(getLocatorByText(text), `Editor should contain: ${text}`);
	}

	async verifyFileIsExposed(fileName: string): Promise<void> {
		await expectElementToBeVisible(
			getLocator(`[data-item-path="${fileName}"]`),
			`Files tree should expose ${fileName}`,
		);
	}

	async verifyFileIsNotExposed(fileName: string): Promise<void> {
		await expectElementToBeHidden(
			getLocator(`[data-item-path="${fileName}"]`),
			`Files tree should no longer expose ${fileName}`,
		);
	}

	async verifyFileHasGitStatus(fileName: string, status: string): Promise<void> {
		await expectElementToBeVisible(
			getLocator(`[data-item-path="${fileName}"][data-item-git-status="${status}"]`),
			`Files tree should mark ${fileName} as ${status}`,
		);
	}
}
