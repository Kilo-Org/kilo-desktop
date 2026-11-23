import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";
import { chatFirstSendFailuresData } from "../../testdata/chat/first-send-failures.js";

test("shows a rejected first prompt in the opened chat without retrying into success @smoke @packaged", async ({
	appShellPage,
	chatStubProviderPage,
	chatComposerPage,
	chatModelSelectorPage,
}, testInfo) => {
	const marker = `${chatFirstSendFailuresData.serverFailureMarker}-RUN-${testInfo.repeatEachIndex}-ATTEMPT-${testInfo.retry}`;
	const prompt = chatFirstSendFailuresData.serverFailurePrompt.replace(
		chatFirstSendFailuresData.serverFailureMarker,
		marker,
	);
	await appShellPage.verifyShellIsLoaded();
	await appShellPage.openSettings();
	await chatStubProviderPage.configureStubProvider();
	await appShellPage.leaveSettings();

	await chatComposerPage.openDraft();
	await chatModelSelectorPage.openModelSelector();
	await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
	await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);
	await chatComposerPage.send(prompt);

	await chatComposerPage.verifyChatStarted(prompt);
	await chatComposerPage.verifySendFailureVisible(chatFirstSendFailuresData.serverFailureMessage);
	await chatStubProviderPage.verifyCapturedErrorResponse(
		marker,
		400,
		chatFirstSendFailuresData.serverFailureMessage,
	);
});
