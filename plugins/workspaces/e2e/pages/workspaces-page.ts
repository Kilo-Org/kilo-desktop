import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

export class WorkspacesPage {
	async createWorkspaceFromFolder(folderPath: string, folderName: string): Promise<void> {
		await getPage().evaluate(
			async ({ folderPath, folderName }) => {
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
					featureId: "workspaces",
					channel: "create",
					args: { name: folderName, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			},
			{ folderPath, folderName },
		);
		await expectElementToBeVisible(
			getLocatorByTestId("app-sidebar"),
			"App sidebar should remain visible after creating a workspace",
		);
	}
}
