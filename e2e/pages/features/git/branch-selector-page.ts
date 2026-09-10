import {
	click,
	expectElementToBeVisible,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";

import { paveWorkspaceChat } from "./pave-workspace-chat.js";

/**
 * Page object for the composer footer's branch switcher popover. The
 * selector is contributed to the `kilo-ui/chat-composer-draft-footer`
 * zone, so the flow paves a workspace chat first (same trick as the
 * Changes pane's smoke spec). Deep coverage — grouping, search, the
 * create dialog — lives in the Vitest browser tier
 * (GitBranchSelector.browser.test.tsx); this spec only proves the
 * packaged binary renders the grouped popover against a real repository.
 */
export class BranchSelectorPage {
	async openInWorkspaceChat(folderPath: string, name: string): Promise<void> {
		await paveWorkspaceChat(folderPath, name);
		const trigger = getLocatorByTestId("git-branch-selector-trigger");
		await expectElementToBeVisible(
			trigger,
			"Branch selector trigger should render in the composer footer",
		);
		await click(trigger);
	}

	async verifyGroupedPopover(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByText("Default Branch", { exact: true }),
			"Default Branch group heading should render",
		);
		await expectElementToBeVisible(
			getLocatorByText("Recent Branches", { exact: true }),
			"Recent Branches group heading should render",
		);
		await expectElementToBeVisible(
			getLocatorByText("Other Branches", { exact: true }),
			"Other Branches group heading should render",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("git-branch-item-main"),
			"The default branch should list under its group",
		);
	}
}
