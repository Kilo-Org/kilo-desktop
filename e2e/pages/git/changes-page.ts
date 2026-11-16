import { writeFile } from "node:fs/promises";
import path from "node:path";

import { click, expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { git } from "../../utils/hermetic-git.js";
import { openNewSessionInNewWorkspace, startEmptySession } from "../chat/agent-session.js";
import { waitForWorkspaceWatcher } from "../work-sessions/workspace-watcher-page.js";

/** kilo.git's `CHANGES_PANE_KIND`. */
const CHANGES_KIND = "kilo.git/changes";

/** Debounce (1 s) + cooldown (5 s) + a refresh pass — generous for CI. */
const LIVE_RELOAD_TIMEOUT_MS = 20_000;

/**
 * Page object for kilo.git's Changes pane. The pane opens inside a session,
 * so the flow registers the workspace, starts an empty session in it from
 * the New Session page (local: the repository's own checkout) and adds
 * Changes from the session header's +. Deep coverage — streamed rendering, refresh,
 * split/unified, reveal — lives in kilo.git's Vitest browser tier.
 */
export class ChangesPage {
	/** Registers the workspace, waits for its file watching, and starts an empty session in it. */
	async startSessionInWorkspace(folderPath: string, name: string): Promise<void> {
		await openNewSessionInNewWorkspace(folderPath, name);
		await waitForWorkspaceWatcher(folderPath);
		await startEmptySession();
	}

	async openChangesPane(): Promise<void> {
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		const launchItem = getLocatorByTestId(`chat-pane-launch-${CHANGES_KIND}`);
		await expectElementToBeVisible(launchItem, "The + menu should offer Changes");
		await click(launchItem);
		await expectElementToBeVisible(
			getLocatorByTestId("git-diff-root"),
			"Choosing Changes should open the Changes pane",
		);
	}

	async verifyPaneMounted(): Promise<void> {
		// `git-diff-view` only renders once the streamed patch published its
		// first items, so waiting for it proves the kilo-git:// protocol
		// round-trip succeeded, not just that the pane mounted.
		await getLocatorByTestId("git-diff-view").waitFor({ state: "visible" });
	}

	async initializeFromErrorState(): Promise<void> {
		const initButton = getLocatorByTestId("git-diff-init");
		await expectElementToBeVisible(
			initButton,
			"Initialize Git button should replace Retry in the 404 error state",
		);
		await click(initButton);
		await this.verifyPaneMounted();
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

	/**
	 * Click Open file in a file's diff header. Headers live in each
	 * `diffs-container`'s shadow root (Playwright's CSS pierces it); the
	 * actions are slotted light DOM on the same host.
	 */
	async openFileFromHeader(relativePath: string): Promise<void> {
		const container = getPage()
			.locator("diffs-container")
			.filter({
				has: getPage().locator("[data-diffs-header] [data-title]", { hasText: relativePath }),
			});
		// The actions fade in on header hover.
		await container.locator("[data-diffs-header] [data-title]").hover();
		const open = container.getByTestId("git-diff-file-open");
		await expectElementToBeVisible(open, `${relativePath}'s header should offer Open file`);
		await click(open);
	}

	/** A Files pane shows `relativePath` with `text` in its editor. */
	async expectFileOpenInFilesPane(relativePath: string, text: string): Promise<void> {
		// Scoped to the Files pane: the diff beside it shows the same text.
		const filesView = getLocatorByTestId("files-view");
		await expectElementToBeVisible(filesView, "Open file should open a Files pane");
		await expectElementToBeVisible(
			filesView.getByRole("textbox", { name: relativePath }),
			`The Files pane should show ${relativePath}`,
		);
		await expectElementToBeVisible(filesView.getByText(text), `The editor should contain: ${text}`);
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
		git(folderPath, ["add", "-A"]);
		// commit.gpgsign=false is already set durably in the repo's local config
		// by the gitWorkspace fixture; the hermetic env prevents any system
		// gitconfig from re-enabling signing.
		git(folderPath, ["commit", "-m", message]);
	}
}
