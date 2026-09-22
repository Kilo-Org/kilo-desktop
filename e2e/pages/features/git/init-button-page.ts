import { execFileSync } from "node:child_process";

import {
	click,
	expectElementToBeVisible,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { paveWorkspaceChat } from "./pave-workspace-chat.js";

/**
 * Page object for the composer footers' "Initialize Git" buttons — the git
 * plugin's swaps inside the `kilo-ui/chat-composer-draft-footer` and
 * `kilo-ui/chat-composer-footer` zone contributions, rendered while the
 * workspace folder is not a repository. The draft footer renders for empty
 * chats, so that flow only paves a workspace chat; the thread footer renders
 * once the thread has usage data, so that flow also sends a message first.
 * Deep coverage — visibility gating, invalidation, toasts — lives in the
 * Vitest browser tier (InitializeGitButton / GitBranchSelector /
 * GitBranchLabel browser suites).
 */
export class InitButtonPage {
	async createWorkspaceChat(folderPath: string, name: string): Promise<void> {
		await paveWorkspaceChat(folderPath, name);
	}

	async startThread(): Promise<void> {
		await getLocatorByRole("textbox", { name: "Message input" }).fill(
			"Turn this folder into a repository",
		);
		await click(getLocatorByRole("button", { name: "Send message" }));
		// Waiting for the toolbar proves the thread (and its footers) started.
		await expectElementToBeVisible(
			getLocatorByTestId("chat-pane-toolbar"),
			"Pane toolbar should be visible after the chat starts",
		);
	}

	async initializeFromDraftFooter(): Promise<void> {
		const button = getLocatorByTestId("git-init-draft-button");
		await expectElementToBeVisible(
			button,
			"Initialize Git button should render in the draft footer for a plain workspace folder",
		);
		await click(button);
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-selector-trigger"),
			"The branch selector should replace the init button once the repository exists",
		);
	}

	async initializeFromThreadFooter(): Promise<void> {
		const button = getLocatorByTestId("git-init-thread-button");
		await expectElementToBeVisible(
			button,
			"Initialize Git button should render in the thread footer for a plain workspace folder",
		);
		await click(button);
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-label"),
			"The branch label should replace the init button once the repository exists",
		);
	}

	async initializeExternally(folderPath: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("git-init-draft-button"),
			"Initialize Git button should render before external initialization",
		);
		execFileSync("git", ["-C", folderPath, "init"]);
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-selector-trigger"),
			"The branch selector should appear after external initialization",
		);
	}
}
