import { test } from "../../../fixtures/features/chat.js";

/**
 * A new chat before its first message: the New Session page's session
 * starter, and an Agent pane added to an existing session. Asserts the layout
 * and the composer's controls; sending lives in the composer specs. The e2e
 * build turns on `new-session-pane-kinds`, which offers the other pane kinds
 * under the starter (off in the product, as on origin).
 */
test.describe("New chat", () => {
	test("the New Session page welcomes above the session starter and offers the other pane kinds @smoke", async ({
		appShellPage,
		newChatPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionPage();
		await newChatPage.verifyHeadlineAboveStarter("What should we work on?");
		await newChatPage.verifyDraftFooterUnderComposer();
		await newChatPage.verifyComposerPlaceholder("Send a message");
		await newChatPage.verifyMessageInputVisible();
		await newChatPage.verifyAddAttachmentVisible();
		await newChatPage.verifySendVisible();
		await newChatPage.verifyOtherPaneKindsOffered();
	});

	test("an Agent pane added to a session opens with the composer docked at the bottom @smoke", async ({
		appShellPage,
		newChatPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openAgentPaneDraft();
		await newChatPage.verifyComposerDocked();
		await newChatPage.verifyComposerPlaceholder("Send a message");
		await newChatPage.verifyMessageInputVisible();
		await newChatPage.verifySendVisible();
	});
});
