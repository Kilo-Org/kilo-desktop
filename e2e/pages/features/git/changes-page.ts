import {
	click,
	expectElementToBeVisible,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/**
 * Page object for the git plugin's "Changes" chat pane.
 *
 * The pane only exists inside a workspace chat session, so the flow first
 * paves one (same `desktopApi.invoke` trick as the files plugin's smoke
 * spec): create a workspace, bind a new chat to it, then send a message —
 * a fresh draft renders no pane canvas (`shouldShowChatCanvas`), so the
 * header toolbar that launches contributed panes only appears once the
 * thread has started. Deep coverage — streamed rendering, refresh,
 * split/unified — lives in the Vitest browser tier (GitDiffView.browser.test.tsx).
 */
export class ChangesPage {
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

	async openChangesTab(): Promise<void> {
		await getLocatorByRole("textbox", { name: "Message input" }).fill(
			"Review the workspace changes",
		);
		await click(getLocatorByRole("button", { name: "Send message" }));
		// `PaneLaunchToolbar` carries one launch button per addable
		// contribution, keyed by definition id (`<featureId>.<contributionId>`,
		// dot unsanitized) — `git.changes` for the Changes pane.
		await expectElementToBeVisible(
			getLocatorByTestId("chat-pane-toolbar"),
			"Pane toolbar should be visible after the chat starts",
		);
		await click(getLocatorByTestId("chat-pane-launch-git.changes"));
	}

	async verifyTabMounted(): Promise<void> {
		// `git-diff-view` only renders once the streamed patch published its
		// first items, so waiting for it proves the kilo-git:// protocol
		// round-trip succeeded, not just that the shell mounted the tab.
		await getLocatorByTestId("git-diff-view").waitFor({ state: "visible" });
	}
}
