import { BoardPage } from "../pages/workspace-board/board-page.js";
import { test as shellTest } from "./shell.js";

export const test = shellTest.extend<{ boardPage: BoardPage }>({
	appIsolationKey: "board",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	boardPage: async ({}, use) => {
		const boardPage = new BoardPage();
		await use(boardPage);
		// The worker's app outlives the test: a board left popped out would hide the
		// board, and its header actions, from every later test and retry.
		await boardPage.closeBoardWindows();
	},
});

export const { expect } = test;
