import {
	click,
	dragAndDrop,
	expectElementToBeVisible,
	fill,
	getAttribute,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	hover,
} from "@anaconda/playwright-utils";
import { getAllPages, getPage } from "@anaconda/playwright-utils/page-utils";
import { expect, type Locator, type Page } from "@playwright/test";
import { openNewChatDraft } from "@kilo-desktop/e2e";

/**
 * Every step targets the chat this page object started, by its Kilo session id:
 * the board persists across specs that share an app, so "the first card in a
 * column" could be a leftover from another run.
 */
export class WorkspaceBoardPage {
	private sessionId: string | undefined;
	private boardWindow: Page | undefined;

	async startChat(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await openNewChatDraft();
		const send = getLocatorByTestId(/kilo-composer-send(-when-connected)?/);
		await expectElementToBeVisible(send, "Composer should be ready before starting the chat");
		await fill(getLocatorByRole("textbox", { name: "Message input" }), "Plan board work");
		await click(send);
		const row = this.activeRow();
		await expectElementToBeVisible(row, "The started chat should be the active row");
		await expectElementToBeVisible(
			row.and(getLocator("[data-session-id]")),
			"The started chat should have a Kilo session id",
		);
		this.sessionId = (await getAttribute(row, "data-session-id")) ?? undefined;
	}

	async addChatToColumn(columnId: string): Promise<void> {
		const row = this.chatRow();
		await hover(row);
		await click(row.getByRole("button", { name: "Thread actions" }));
		await click(getLocatorByTestId("session-list-item-board-menu"));
		await click(getLocatorByTestId(`session-list-item-board-${columnId}`));
	}

	/** The sidebar button toggles the board, so it is only clicked while the board is closed. */
	async open(): Promise<void> {
		const toggle = getLocatorByTestId("session-list-board");
		await expectElementToBeVisible(toggle, "The board toggle should be in the sidebar");
		if ((await getAttribute(toggle, "aria-pressed")) !== "true") await click(toggle);
		await expectElementToBeVisible(getLocatorByTestId("workspace-board"), "The board should open");
	}

	async expectChatIn(columnId: string): Promise<void> {
		await expectElementToBeVisible(
			this.card(columnId),
			`The chat should be in the ${columnId} column`,
		);
	}

	async dragChat(fromColumnId: string, toColumnId: string): Promise<void> {
		await dragAndDrop(this.card(fromColumnId), this.column(toColumnId), { steps: 15 });
		await this.expectChatIn(toColumnId);
	}

	async reloadAndOpen(): Promise<void> {
		await getPage().reload();
		await this.open();
	}

	async openChat(columnId: string): Promise<void> {
		await click(this.card(columnId).getByTestId("workspace-board-card-open"));
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-chat-thread"),
			"Opening a card should show its chat",
		);
	}

	/** Pops the open board out; the main window goes back to the chat. */
	async popOut(): Promise<void> {
		await click(getLocatorByTestId("workspace-board-pop-out"));
		this.boardWindow = await this.waitForBoardWindow();
		await expectElementToBeVisible(
			this.boardWindow.getByTestId("workspace-board"),
			"The board should open in its own window",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("kilo-chat-thread"),
			"The main window should go back to the chat",
		);
	}

	async expectChatInBoardWindow(columnId: string): Promise<void> {
		await expectElementToBeVisible(
			this.boardWindowCard(columnId),
			`The chat should be in the board window's ${columnId} column`,
		);
	}

	/** Leaves the main window on a fresh draft first, so the card has to switch it. */
	async openChatFromBoardWindow(columnId: string): Promise<void> {
		await openNewChatDraft();
		await click(this.boardWindowCard(columnId).getByTestId("workspace-board-card-open"));
		await expectElementToBeVisible(
			this.activeRow().and(this.chatRow()),
			"The board window should open the chat in the main window",
		);
	}

	async dockBoardWindow(): Promise<void> {
		const boardWindow = this.requireBoardWindow();
		const closed = boardWindow.waitForEvent("close");
		await click(boardWindow.getByTestId("workspace-board-dock"));
		await closed;
		this.boardWindow = undefined;
		await expectElementToBeVisible(
			getLocatorByTestId("workspace-board"),
			"The board should be back in the main window",
		);
	}

	async closeBoardWindows(): Promise<void> {
		for (const page of getAllPages().filter(isBoardWindow)) await page.close();
		this.boardWindow = undefined;
	}

	private async waitForBoardWindow(): Promise<Page> {
		await expect
			.poll(() => getAllPages().some(isBoardWindow), { message: "The board window should open" })
			.toBe(true);
		const boardWindow = getAllPages().find(isBoardWindow);
		if (!boardWindow) throw new Error("The board window closed as it opened.");
		return boardWindow;
	}

	private boardWindowCard(columnId: string): Locator {
		return this.requireBoardWindow()
			.getByTestId(`workspace-board-column-${columnId}`)
			.getByTestId(`workspace-board-card-${this.requireSessionId()}`);
	}

	private requireBoardWindow(): Page {
		if (!this.boardWindow) throw new Error("Pop the board out first.");
		return this.boardWindow;
	}

	private activeRow(): Locator {
		return getLocator('[data-slot="aui_session-list-item"][data-active="true"]');
	}

	private chatRow(): Locator {
		return getLocator(
			`[data-slot="aui_session-list-item"][data-session-id="${this.requireSessionId()}"]`,
		);
	}

	private column(columnId: string): Locator {
		return getLocatorByTestId(`workspace-board-column-${columnId}`);
	}

	private card(columnId: string): Locator {
		return this.column(columnId).getByTestId(`workspace-board-card-${this.requireSessionId()}`);
	}

	private requireSessionId(): string {
		if (!this.sessionId) throw new Error("Start a chat before using the board.");
		return this.sessionId;
	}
}

function isBoardWindow(page: Page): boolean {
	return (
		page.url().includes("#/plugins/workspace-board?") && page.url().includes("paneWindow=true")
	);
}
