import { test } from "../../../fixtures/features/board.js";

test.describe("Workspace board @packaged", () => {
	test("places a session on the board, drags it between columns, and keeps it after reload @smoke", async ({
		boardPage,
	}) => {
		await boardPage.startSession();
		await boardPage.addSessionToColumn("in-progress");
		await boardPage.open();
		await boardPage.expectSessionIn("in-progress");
		await boardPage.dragSession("in-progress", "review");
		await boardPage.reloadAndOpen();
		await boardPage.expectSessionIn("review");
		await boardPage.openSession("review");
	});

	test("takes a session list row dropped on a column", async ({ boardPage }) => {
		await boardPage.startSession();
		await boardPage.open();
		await boardPage.dragRowOnto("done");
	});

	test("pops the board out, opens a session from its window, and docks it back", async ({
		boardPage,
	}) => {
		await boardPage.startSession();
		await boardPage.addSessionToColumn("backlog");
		await boardPage.open();
		await boardPage.popOut();
		await boardPage.expectSessionInBoardWindow("backlog");
		await boardPage.openSessionFromBoardWindow("backlog");
		await boardPage.dockBoardWindow();
		await boardPage.expectSessionIn("backlog");
	});
});
