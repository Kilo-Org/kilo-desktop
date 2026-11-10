import { test } from "../../fixtures/chat.js";

/**
 * A new chat before its first message: the New Session page's session
 * starter, and an Agent pane added to an existing session. Asserts the layout
 * and the composer's controls; sending lives in the composer specs.
 */
test.describe("New chat", () => {
	test("the New Session page welcomes above the session starter, which stands in for the Agent @smoke", async ({
		appShellPage,
		newChatPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionPage();
		await newChatPage.verifyHeadlineAboveStarter("What should we work on?");
		await newChatPage.verifyLocationAboveStarter();
		await newChatPage.verifyComposerPlaceholder("Send a message");
		await newChatPage.verifyMessageInputVisible();
		await newChatPage.verifyAddAttachmentVisible();
		await newChatPage.verifySendVisible();
		await newChatPage.verifyAgentNotOfferedAsTool();
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
