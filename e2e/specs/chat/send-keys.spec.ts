import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";
import { chatSendKeysData } from "../../testdata/chat/send-keys.js";

test.describe("Chat welcome send keys", () => {
	test.beforeEach(
		async ({ appShellPage, chatStubProviderPage, chatComposerPage, chatModelSelectorPage }) => {
			await appShellPage.verifyShellIsLoaded();
			await appShellPage.openSettings();
			await chatStubProviderPage.configureStubProvider();
			await appShellPage.leaveSettings();

			await chatComposerPage.openDraft();
			await chatModelSelectorPage.openModelSelector();
			await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
			await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);
		},
	);

	test("Enter sends a typed message, starting the session and showing the reply @smoke @packaged", async ({
		chatComposerPage,
	}) => {
		await chatComposerPage.typeMessage(chatSendKeysData.enterPrompt);
		await chatComposerPage.pressKey("Enter");

		await chatComposerPage.verifyChatStarted(chatSendKeysData.enterPrompt);
		await chatComposerPage.verifyAssistantReplyVisible(chatSendKeysData.enterReply);
	});

	test("Shift+Enter adds a line without sending, and Enter sends both lines in order @packaged", async ({
		chatComposerPage,
		chatStubProviderPage,
	}) => {
		await chatComposerPage.typeMessage(chatSendKeysData.newlineFirstLine);
		await chatComposerPage.pressKey("Shift+Enter");
		await chatComposerPage.appendMessageSequentially(chatSendKeysData.newlineSecondLine);

		await chatComposerPage.verifyComposerHoldsText(chatSendKeysData.newlineFirstLine);
		await chatComposerPage.verifyComposerHoldsText(chatSendKeysData.newlineSecondLine);
		await chatComposerPage.verifyStillOnDraft();

		await chatComposerPage.pressKey("Enter");
		await chatComposerPage.verifyAssistantReplyVisible(chatSendKeysData.newlineReply);
		await chatStubProviderPage.verifyCapturedPromptContains(
			chatSendKeysData.newlineMarker,
			`${chatSendKeysData.newlineFirstLine}\n${chatSendKeysData.newlineSecondLine}`,
		);
	});

	test("a draft of only spaces keeps Send disabled, and Enter starts nothing @smoke", async ({
		chatComposerPage,
	}) => {
		await chatComposerPage.typeMessage(chatSendKeysData.blankDraft);
		await chatComposerPage.verifySendDisabled();
		await chatComposerPage.pressKey("Enter");
		await chatComposerPage.appendMessageSequentially(chatSendKeysData.blankDraftFollowUp);

		await chatComposerPage.verifyComposerHoldsText(chatSendKeysData.blankDraftFollowUp);
		await chatComposerPage.verifyStillOnDraft();
	});
});
