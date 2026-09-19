import {
	click,
	expectElementToBeVisible,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";
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

	// Worker fixture resets to `#/`; the shell redirects that to chat.
	await getPage().waitForURL("kilo-desktop://app/#/plugins/chat");
	await expectElementToBeVisible(
		getLocatorByTestId("new-chat"),
		"New Chat should be available before selecting a workspace",
	);
	await expectElementToBeVisible(
		getLocatorByRole("textbox", { name: "Message input" }),
		"Composer should be ready before selecting a workspace",
	);

	const draftFooter = getLocatorByTestId("kilo-composer-draft-footer");
	// Shared worker apps can already be in draft after the hash reset. Clicking
	// New Chat again races lazy session init (status leaves "new") and hides
	// this footer for the rest of the 15s wait.
	if ((await draftFooter.count()) === 0) {
		await click(getLocatorByTestId("new-chat"));
	}
	await expectElementToBeVisible(
		draftFooter,
		"New Chat should enter draft state before selecting a workspace",
	);
	await click(getLocatorByRole("combobox", { name: "Select workspace" }));
	await click(getLocatorByText(name, { exact: true }));
}
