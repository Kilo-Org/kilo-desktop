import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";
import { chatSmokeData } from "../../testdata/chat/smoke.js";

/**
 * kilo.chat end to end: a prompt typed into the New Session page's starter
 * creates the work session, its Kilo chat and its Agent pane; the packaged
 * Kilo CLI asks the mock chat-completions stub for the reply (and the chat's
 * title), the transcript streams the reply in, and the session list names
 * the work session after its chat.
 */
test.describe("kilo.chat @smoke", () => {
	test("starts a work session from the New Session page with a prompt, shows the reply and titles the session", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await chatStubProviderPage.configureStubProvider();
		await appShellPage.leaveSettings();

		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
		await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);
		await chatComposerPage.send(chatSmokeData.prompt);

		await chatComposerPage.verifyChatStarted(chatSmokeData.prompt);
		await chatComposerPage.verifyAssistantReplyVisible(chatSmokeData.reply);
		await chatComposerPage.verifySessionTitled(chatSmokeData.title);
	});
});
