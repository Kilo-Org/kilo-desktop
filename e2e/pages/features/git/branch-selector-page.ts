import {
	click,
	expectElementToBeVisible,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";

import { createAndActivateWorkspace, openNewSession } from "../chat/agent-session.js";

/**
 * Page object for the launcher's branch picker: kilo.git's
 * `kilo.workbench/launcher-option` in the branch slot beside the isolation
 * control, in the session starter's footer, for the folder a new session
 * would work in. Deep coverage —
 * grouping, search, the create dialog, moving to a worktree — lives in
 * kilo.git's Vitest browser tier; this spec only proves the packaged binary
 * renders the grouped popover against a real repository.
 */
export class BranchSelectorPage {
	async openInLauncher(folderPath: string, name: string): Promise<void> {
		await createAndActivateWorkspace(folderPath, name);
		await openNewSession();
		const trigger = getLocatorByTestId("launcher-location")
			.getByTestId("launcher-isolation")
			.getByTestId("git-branch-selector-trigger");
		await expectElementToBeVisible(
			trigger,
			"The branch picker should show beside the isolation control above the starter",
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
