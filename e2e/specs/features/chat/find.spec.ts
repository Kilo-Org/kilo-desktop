import {
	openChatFindBar,
	verifyFindInputFocused,
} from "../../../pages/features/chat/chat-find-page.js";
import { test } from "../../../fixtures/shell.js";

test.describe("Chat transcript find @smoke @packaged", () => {
	test("opens a scoped find bar on the platform find chord", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await openChatFindBar();
		await verifyFindInputFocused();
	});
});
