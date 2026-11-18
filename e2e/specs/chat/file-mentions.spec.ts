import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat/file-mentions.js";
import { chatFileMentionData } from "../../testdata/chat/file-mentions.js";

/**
 * A real `@` file mention from the New Session page: kilo.files lists the
 * selected workspace's files, the chosen one becomes a chip in the composer,
 * and the first send resolves it to the file's `@/path` before the model
 * request leaves — proven against the mock chat-completions stub's captured
 * prompt, not just the UI.
 */
test.describe("Chat welcome file mentions", () => {
	test("mentions a workspace file and sends its resolved path in the first message @smoke @packaged", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
		fileMentionWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await chatStubProviderPage.configureStubProvider();
		await appShellPage.leaveSettings();

		await chatComposerPage.openDraftInWorkspace(
			fileMentionWorkspace.path,
			fileMentionWorkspace.name,
		);
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
		await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);

		await chatComposerPage.typeMessageSequentially(`${chatFileMentionData.promptMarker} `);
		await chatComposerPage.mentionFile("welcome-mention", fileMentionWorkspace.fileName);
		await chatComposerPage.verifyComposerMention(fileMentionWorkspace.fileName);
		await chatComposerPage.sendComposer();

		await chatComposerPage.verifyAssistantReplyVisible(chatFileMentionData.reply);
		await chatStubProviderPage.verifyCapturedPromptContains(
			chatFileMentionData.promptMarker,
			chatFileMentionData.resolvedMention,
		);
		await chatStubProviderPage.verifyCapturedPromptOmits(
			chatFileMentionData.promptMarker,
			":m_kilo_files",
		);
	});
});
