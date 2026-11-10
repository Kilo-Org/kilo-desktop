import { openChatFindBar, verifyFindInputFocused } from "../../pages/chat/chat-find-page.js";
import { test } from "../../fixtures/chat.js";

test.describe("Chat transcript find @smoke @packaged", () => {
	test("opens a scoped find bar on the platform find chord", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await openChatFindBar();
		await verifyFindInputFocused();
	});
});
