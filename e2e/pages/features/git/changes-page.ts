import {
	click,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { paveWorkspaceChat } from "./pave-workspace-chat.js";

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
		await paveWorkspaceChat(folderPath, name);
	}

	async openChangesTab(): Promise<void> {
		const send = getLocatorByTestId(/kilo-composer-send(-when-connected)?/);
		await expectElementToBeVisible(
			send,
			"Composer should be ready to send before starting the chat",
		);
		await fill(
			getLocatorByRole("textbox", { name: "Message input" }),
			"Review the workspace changes",
		);
		await click(send);
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
