import { execFileSync } from "node:child_process";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import {
	openNewSessionInNewWorkspace,
	waitForSessionStartedBySend,
} from "../chat/agent-session.js";

/**
 * Page object for kilo.git's "Initialize Git" button: its `footer` composer
 * action under a chat's composer, shown while the chat's folder is not a
 * repository. The footer shows once the chat exists, so the flow opens the
 * New Session page in the workspace and sends the starter's first message,
 * which starts the work session and opens its Agent pane. Deep coverage (refresh,
 * failures) lives in kilo.git's Vitest browser tier.
 */
export class InitButtonPage {
	private readonly button = () =>
		getLocatorByTestId("kilo-agent-pane").getByTestId("git-init-thread-button");

	/** The New Session page in a new workspace for a plain folder: no isolation to choose. */
	async openNewSession(folderPath: string, name: string): Promise<void> {
		// New session from an open session starts in that session's workspace,
		// so the workspace is activated once the New Session page is showing.
		await openNewSessionInNewWorkspace(folderPath, name);
		await expectElementToBeHidden(
			getLocatorByTestId("launcher-location").getByTestId("launcher-isolation"),
			{ message: "A folder that is not a repository offers no worktree isolation" },
		);
	}

	/** The starter's first send starts the session; its chat's composer footer then shows. */
	async startChat(): Promise<void> {
		await fill(
			getLocatorByRole("textbox", { name: "Message input" }),
			"Turn this folder into a repository",
		);
		await click(getLocatorByTestId("kilo-composer-send"));
		await waitForSessionStartedBySend();
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-agent-pane").getByTestId("kilo-composer-footer"),
			"The chat's composer footer should show once the chat starts",
		);
	}

	async initializeFromFooter(): Promise<void> {
		await this.verifyButtonShown();
		await click(this.button());
		await this.verifyBranchLabelReplacedButton();
	}

	/**
	 * `git init` from a terminal, then back to the app: the footer reads the
	 * folder again when the window regains focus, which the test raises
	 * itself because the packaged window never loses it here.
	 */
	async initializeOutsideTheApp(folderPath: string): Promise<void> {
		await this.verifyButtonShown();
		execFileSync("git", ["init", "-b", "main"], {
			cwd: folderPath,
			env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
		});
		await getPage().evaluate(() => globalThis.dispatchEvent(new Event("focus")));
		await this.verifyBranchLabelReplacedButton();
	}

	private async verifyButtonShown(): Promise<void> {
		await expectElementToBeVisible(
			this.button(),
			"Initialize Git should show under the composer for a plain workspace folder",
		);
	}

	private async verifyBranchLabelReplacedButton(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-agent-pane").getByTestId("git-branch-label"),
			"The branch label should replace the button once the repository exists",
		);
		await expectElementToBeHidden(this.button(), {
			message: "Initialize Git should leave once the folder is a repository",
		});
	}
}
