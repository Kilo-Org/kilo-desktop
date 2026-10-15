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
import { getPage } from "@anaconda/playwright-utils/page-utils";
import type { Locator } from "@playwright/test";
import { openNewChatDraft } from "@kilo-desktop/e2e";

/**
 * Every step targets the chat this page object started, by its Kilo session id:
 * the board persists across specs that share an app, so "the first card in a
 * column" could be a leftover from another run.
 */
export class WorkspaceBoardPage {
	private sessionId: string | undefined;

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

	async addChatToColumn(columnId: string, label: string): Promise<void> {
		const row = this.chatRow();
		await hover(row);
		await click(row.getByRole("button", { name: "Thread actions" }));
		await click(getLocatorByTestId("session-list-item-board-menu"));
		await click(getLocatorByTestId(`session-list-item-board-${columnId}`));
		await expectElementToBeVisible(
			row.getByRole("img", { name: `On board: ${label}` }),
			"The sidebar row should show its board column",
		);
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
