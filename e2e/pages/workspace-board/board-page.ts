import {
	click,
	expectElementToBeVisible,
	getAttribute,
	getLocator,
	getLocatorByTestId,
	hover,
	pressLocatorKeyboard,
} from "@anaconda/playwright-utils";
import { getAllPages, getPage } from "@anaconda/playwright-utils/page-utils";
import { expect, type Locator, type Page } from "@playwright/test";
import { runFromCommandPalette } from "../shell/command-palette.js";

/**
 * Page object for kilo.workspace-board's workspace board. Every step targets the
 * session this page object started, by its Work Session id: the board
 * persists across specs that share an app, so "the first card in a column"
 * could be a leftover from another run.
 */
export class BoardPage {
	private sessionId: string | undefined;
	private boardWindow: Page | undefined;

	async startSession(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
		await runFromCommandPalette("kilo.work-sessions/new-empty-work-session");
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"Starting a session should open it",
		);
		const row = this.activeRow();
		await expectElementToBeVisible(row, "The started session should be the active row");
		this.sessionId = (await getAttribute(row, "data-session-id")) ?? undefined;
	}

	/**
	 * Opens the submenu from the keyboard: a hover can land while the menu is
	 * still animating in, which leaves the submenu closed.
	 */
	async addSessionToColumn(columnId: string): Promise<void> {
		const row = this.sessionRow();
		await hover(row);
		await click(row.getByTestId("session-list-item-more"));
		await pressLocatorKeyboard(
			getLocatorByTestId("session-menu-kilo.workspace-board/add-to-board"),
			"ArrowRight",
		);
		await click(getLocatorByTestId(`session-menu-kilo.workspace-board/add-to-board-${columnId}`));
	}

	/** The session list's toggle shows the board, so it is only clicked while the board is hidden. */
	async open(): Promise<void> {
		const toggle = getLocatorByTestId("session-list-board");
		await expectElementToBeVisible(toggle, "The board toggle should be in the session list");
		if ((await getAttribute(toggle, "aria-pressed")) !== "true") await click(toggle);
		await expectElementToBeVisible(getLocatorByTestId("workspace-board"), "The board should open");
	}

	async expectSessionIn(columnId: string): Promise<void> {
		await expectElementToBeVisible(
			this.card(columnId),
			`The session should be in the ${columnId} column`,
		);
	}

	async dragSession(fromColumnId: string, toColumnId: string): Promise<void> {
		await dragOnto(this.card(fromColumnId), this.column(toColumnId));
		await this.expectSessionIn(toColumnId);
	}

	async dragRowOnto(columnId: string): Promise<void> {
		await dragOnto(this.sessionRow(), this.column(columnId));
		await this.expectSessionIn(columnId);
	}

	async reloadAndOpen(): Promise<void> {
		await getPage().reload();
		await this.open();
	}

	async openSession(columnId: string): Promise<void> {
		await click(this.card(columnId).getByTestId("workspace-board-card-open"));
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"Opening a card should show its session",
		);
	}

	/** Pops the open board out; the main window goes back to the open session. */
	async popOut(): Promise<void> {
		await click(getLocatorByTestId("sessions-view-pop-out"));
		this.boardWindow = await this.waitForBoardWindow();
		await expectElementToBeVisible(
			this.boardWindow.getByTestId("workspace-board"),
			"The board should open in its own window",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"The main window should go back to the session",
		);
	}

	async expectSessionInBoardWindow(columnId: string): Promise<void> {
		await expectElementToBeVisible(
			this.boardWindowCard(columnId),
			`The session should be in the board window's ${columnId} column`,
		);
	}

	/** Leaves the main window on the launcher first, so the card has to open the session there. */
	async openSessionFromBoardWindow(columnId: string): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"The launcher should show",
		);
		await click(this.boardWindowCard(columnId).getByTestId("workspace-board-card-open"));
		await expectElementToBeVisible(
			this.activeRow().and(this.sessionRow()),
			"The board window should open the session in the main window",
		);
	}

	async dockBoardWindow(): Promise<void> {
		const boardWindow = this.requireBoardWindow();
		const closed = boardWindow.waitForEvent("close");
		await click(boardWindow.getByTestId("sessions-view-dock"));
		await closed;
		this.boardWindow = undefined;
		await expectElementToBeVisible(
			getLocatorByTestId("workspace-board"),
			"The board should be back in the main window",
		);
	}

	async closeBoardWindows(): Promise<void> {
		for (const page of await boardWindows()) await page.close();
		this.boardWindow = undefined;
	}

	private async waitForBoardWindow(): Promise<Page> {
		await expect
			.poll(async () => (await boardWindows()).length, { message: "The board window should open" })
			.toBeGreaterThan(0);
		const [boardWindow] = await boardWindows();
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
		return getLocator('[data-qa-id="session-list-item"][data-active="true"]');
	}

	private sessionRow(): Locator {
		return getLocator(
			`[data-qa-id="session-list-item"][data-session-id="${this.requireSessionId()}"]`,
		);
	}

	private column(columnId: string): Locator {
		return getLocatorByTestId(`workspace-board-column-${columnId}`);
	}

	private card(columnId: string): Locator {
		return this.column(columnId).getByTestId(`workspace-board-card-${this.requireSessionId()}`);
	}

	private requireSessionId(): string {
		if (!this.sessionId) throw new Error("Start a session before using the board.");
		return this.sessionId;
	}
}

/**
 * Drags `source` onto the middle of `target` with the HTML5 drag events a real
 * drag fires, sharing one DataTransfer, so it exercises the app's drag
 * handlers the same way on every platform. Playwright's `dragTo` drives
 * Chromium's drag loop instead, whose drop never reached the packaged app on
 * the Windows CI runners although the same drag lands on macOS.
 */
async function dragOnto(source: Locator, target: Locator): Promise<void> {
	await expectElementToBeVisible(source, "The dragged element should be visible");
	await expectElementToBeVisible(target, "The drop target should be visible");
	const targetHandle = await target.elementHandle();
	await source.evaluate((sourceElement, targetElement) => {
		if (!targetElement) throw new Error("The drop target is gone.");
		const dataTransfer = new DataTransfer();
		const rect = targetElement.getBoundingClientRect();
		const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
		const fire = (element: Element, type: string, at: Partial<typeof point> = {}) =>
			element.dispatchEvent(
				new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true, ...at }),
			);
		fire(sourceElement, "dragstart");
		fire(targetElement, "dragenter", point);
		fire(targetElement, "dragover", point);
		fire(targetElement, "drop", point);
		fire(sourceElement, "dragend", point);
	}, targetHandle);
}

/** Secondary windows load the same URL as the main one; the board's shows its window view. */
async function boardWindows(): Promise<Page[]> {
	const pages = getAllPages();
	const shown = await Promise.all(
		pages.map(async (page) => (await page.getByTestId("sessions-view-window").count()) > 0),
	);
	return pages.filter((_, index) => shown[index]);
}
