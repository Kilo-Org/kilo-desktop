import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test as noModelTest } from "../../fixtures/chat/no-model.js";
import { test } from "../../fixtures/chat.js";
import { chatFirstSendFailuresData } from "../../testdata/chat/first-send-failures.js";

noModelTest(
	"sending without a selected model opens the session and shows why @smoke @packaged",
	async ({ appShellPage, chatComposerPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyNoModelSelected();
		await chatComposerPage.send(chatFirstSendFailuresData.noModelPrompt);

		await chatComposerPage.verifyChatStarted(chatFirstSendFailuresData.noModelPrompt);
		await chatComposerPage.verifyNoModelMessageOutcome(chatFirstSendFailuresData.noModelPrompt);
	},
);

test("shows a rejected first prompt in the opened chat without retrying into success @packaged", async ({
	appShellPage,
	chatStubProviderPage,
	chatComposerPage,
	chatModelSelectorPage,
}, testInfo) => {
	const marker = `${chatFirstSendFailuresData.serverFailureMarker}-ATTEMPT-${testInfo.retry}`;
	const prompt = `${marker} rejected first message`;
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
