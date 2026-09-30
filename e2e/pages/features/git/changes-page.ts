import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
	click,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { paveWorkspaceChat } from "./pave-workspace-chat.js";

// Prevent system gitconfig reads — mirrors the fixture's HERMETIC_GIT_ENV.
const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_AUTHOR_NAME: "Git Plugin E2E",
	GIT_AUTHOR_EMAIL: "git-plugin-e2e@example.com",
	GIT_COMMITTER_NAME: "Git Plugin E2E",
	GIT_COMMITTER_EMAIL: "git-plugin-e2e@example.com",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_COUNT: "0",
};

/** Debounce (1 s) + cooldown (5 s) + a refresh pass — generous for CI. */
const LIVE_RELOAD_TIMEOUT_MS = 20_000;

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
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		const launchItem = getLocatorByTestId("chat-pane-launch-git.changes");
		await expectElementToBeVisible(launchItem, "Changes pane launch item should be actionable");
		await click(launchItem);
	}

	async verifyTabMounted(): Promise<void> {
		// `git-diff-view` only renders once the streamed patch published its
		// first items, so waiting for it proves the kilo-git:// protocol
		// round-trip succeeded, not just that the shell mounted the tab.
		await getLocatorByTestId("git-diff-view").waitFor({ state: "visible" });
	}

	async initializeFromErrorState(): Promise<void> {
		const initButton = getLocatorByTestId("git-diff-init");
		await expectElementToBeVisible(
			initButton,
			"Initialize Git button should replace Retry in the 404 error state",
		);
		await click(initButton);
		await this.verifyTabMounted();
	}

	/**
	 * Wait until the tree shows exactly `paths`, in order. Rows carry
	 * `data-item-path` inside the tree host's shadow root; folder rows end
	 * with a slash. The live reload's debounce (1 s) and refresh pass are the
	 * wait, so callers assert the settled state, never a manual refresh.
	 */
	async expectTreePaths(paths: string[]): Promise<void> {
		await getPage().waitForFunction(
			(expectedPaths: string[]) => {
				const rows = Array.from(
					document
						.querySelector('[data-qa-id="git-diff-tree"]')
						?.shadowRoot?.querySelectorAll("[data-item-path]") ?? [],
				).map((row) => row.getAttribute("data-item-path"));
				return (
					rows.length === expectedPaths.length &&
					expectedPaths.every((expectedPath, index) => rows[index] === expectedPath)
				);
			},
			paths,
			{ timeout: LIVE_RELOAD_TIMEOUT_MS },
		);
	}

	/** Wait until every change is gone and the empty state replaced the diff. */
	async expectNoChanges(): Promise<void> {
		await getLocatorByTestId("git-diff-empty").waitFor({
			state: "visible",
			timeout: LIVE_RELOAD_TIMEOUT_MS,
		});
	}

	/** Write a file into the repo from outside the app (external editor). */
	async writeWorkingTreeFile(folderPath: string, name: string, contents: string): Promise<void> {
		await writeFile(path.join(folderPath, name), contents);
	}

	/** Stage everything and commit from a terminal. */
	async stageAndCommitAll(folderPath: string, message: string): Promise<void> {
		const git = (args: string[]) =>
			execFileSync("git", ["-C", folderPath, ...args], { env: HERMETIC_GIT_ENV });
		git(["add", "-A"]);
		// commit.gpgsign=false is already set durably in the repo's local config
		// by the gitWorkspace fixture; the hermetic env prevents any system
		// gitconfig from re-enabling signing.
		git(["commit", "-m", message]);
	}
}
