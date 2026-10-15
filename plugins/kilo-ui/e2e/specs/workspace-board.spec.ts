import { test } from "../fixtures.js";

test.use({
	appIsolationKey: "kilo-ui",
});

test.describe("Workspace board @smoke", () => {
	test("places a chat on the board, drags it between columns, and keeps it after reload", async ({
		workspaceBoardPage,
	}) => {
		await workspaceBoardPage.startChat();
		await workspaceBoardPage.addChatToColumn("in-progress", "In progress");
		await workspaceBoardPage.open();
		await workspaceBoardPage.expectChatIn("in-progress");
		await workspaceBoardPage.dragChat("in-progress", "review");
		await workspaceBoardPage.reloadAndOpen();
		await workspaceBoardPage.expectChatIn("review");
		await workspaceBoardPage.openChat("review");
	});
});
