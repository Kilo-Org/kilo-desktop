import { click, getLocator, getLocatorByRole, getLocatorByText } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Pave a workspace chat for a folder: create the workspace through the
 * shell's `desktopApi.invoke` (no UI drag needed), then start a new chat
 * bound to it via the workspace selector.
 */
export async function paveWorkspaceChat(folderPath: string, name: string): Promise<void> {
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
