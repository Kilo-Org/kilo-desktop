import {
	click,
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

	async openFilesPanel(): Promise<void> {
		await click(getLocatorByTestId("chat-right-panel-toggle"));
		await click(getLocatorByTestId("chat-right-panel-open-files-files"));
		await expectElementToBeVisible(
			getLocatorByTestId("files-view"),
			"Files right-panel contribution should be visible",
		);
	}

	async verifyFileIsExposed(fileName: string): Promise<void> {
		await expectElementToBeVisible(
			getLocator(`[data-item-path="${fileName}"]`),
			`Files tree should expose ${fileName}`,
		);
	}
}
