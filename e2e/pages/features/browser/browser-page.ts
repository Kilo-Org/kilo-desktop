import {
	click,
	expectElementToBeDisabled,
	expectElementToBeVisible,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { paveWorkspaceChat } from "../git/pave-workspace-chat.js";

export class BrowserPage {
	async createAndSelectWorkspace(folderPath: string, name: string): Promise<void> {
		await paveWorkspaceChat(folderPath, name);
	}

	async openBrowserTab(): Promise<void> {
		const send = getLocatorByTestId(/kilo-composer-send(-when-connected)?/);
		await expectElementToBeVisible(send, "Composer should be ready before starting browser smoke");
		await fill(getLocatorByRole("textbox", { name: "Message input" }), "Open the browser pane");
		await click(send);
		await expectElementToBeVisible(
			getLocatorByTestId("chat-pane-toolbar"),
			"Pane toolbar should appear after starting the chat",
		);
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		await click(getLocatorByTestId("chat-pane-launch-browser.browser"));
		await expectElementToBeVisible(getLocatorByTestId("browser-view"), "Browser pane should mount");
	}

	async navigate(url: string): Promise<void> {
		await fill(getLocatorByTestId("browser-url"), url);
		await getLocatorByTestId("browser-url").press("Enter");
	}

	async verifyLoaded(title: string): Promise<void> {
		await expectElementToBeDisabled(
			getLocatorByTestId("browser-forward"),
			"Forward should initially be unavailable",
		);
		await expectElementToBeVisible(
			getLocatorByRole("tab", { name: title }),
			"Loaded page title should become the browser pane title",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("browser-refresh"),
			"Refresh control should remain visible after navigation",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("browser-menu"),
			"Browser menu should remain visible after navigation",
		);
	}
}
