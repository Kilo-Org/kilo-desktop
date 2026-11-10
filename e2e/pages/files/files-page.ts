import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";

import { openNewSessionInNewWorkspace, startEmptySession } from "../chat/agent-session.js";
import { waitForWorkspaceWatcher } from "../work-sessions/workspace-watcher-page.js";

const FILES_KIND = "kilo.files/files";

/**
 * Page object for kilo.files' Files pane. The pane opens inside a session, so
 * the flow registers the workspace, starts an empty session in it from the
 * New Session page and adds Files from the session header's +. Files opened from the
 * tree open in their own panes. Deep coverage lives in kilo.files' Vitest
 * browser tier.
 */
export class FilesPage {
	/** Registers the workspace, waits for its file watching, and starts an empty session in it. */
	async startSessionInWorkspace(folderPath: string, name: string): Promise<void> {
		await openNewSessionInNewWorkspace(folderPath, name);
		await waitForWorkspaceWatcher(folderPath);
		await startEmptySession();
	}

	async openFilesPane(): Promise<void> {
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		const launchItem = getLocatorByTestId(`chat-pane-launch-${FILES_KIND}`);
		await expectElementToBeVisible(launchItem, "The + menu should offer Files");
		await click(launchItem);
		await expectElementToBeVisible(
			getLocatorByTestId("files-view"),
			"Choosing Files should open the Files pane",
		);
	}

	async clickFileInTree(fileName: string): Promise<void> {
		await click(getLocator(`[data-item-path="${fileName}"]`));
	}

	async expectEditorToContain(relativePath: string, text: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByRole("textbox", { name: relativePath }),
			"Editor should be mounted",
		);
		await expectElementToBeVisible(getLocatorByText(text), `Editor should contain: ${text}`);
	}

	async verifyFileIsExposed(fileName: string): Promise<void> {
		await expectElementToBeVisible(
			getLocator(`[data-item-path="${fileName}"]`),
			`Files tree should expose ${fileName}`,
		);
	}

	async verifyFileIsNotExposed(fileName: string): Promise<void> {
		await expectElementToBeHidden(
			getLocator(`[data-item-path="${fileName}"]`),
			`Files tree should no longer expose ${fileName}`,
		);
	}

	async verifyFileHasGitStatus(fileName: string, status: string): Promise<void> {
		await expectElementToBeVisible(
			getLocator(`[data-item-path="${fileName}"][data-item-git-status="${status}"]`),
			`Files tree should mark ${fileName} as ${status}`,
		);
	}
}
