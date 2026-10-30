import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../../pages/features/chat/chat-attachment-provider-page.js";
import { test } from "../../../fixtures/features/chat.js";
import {
	chatAttachmentData,
	chatAttachmentStubReplies,
} from "../../../testdata/chat-attachments.js";

/**
 * Infra proof for chat attachments: upload an image via the composer's "+"
 * button, send it alongside a typed message, and confirm the reply that
 * comes back is the one the mock chat-completions stub sent for this
 * message's marker — end to end through the packaged Kilo CLI, not just a
 * UI-only check. The full positive/negative/edge matrix (other file types,
 * remove-before-send, unsupported files, error paths) lands in a follow-up
 * once this path is proven.
 */
test.describe("Chat attachments", () => {
	test("uploads an image, sends it, and renders the mock model's reply @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
		chatAttachmentProviderPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await chatAttachmentProviderPage.configureStubProvider();
		// A second call in the same app session must skip re-adding — proves
		// the idempotency guard, not just that the first add worked.
		await chatAttachmentProviderPage.configureStubProvider();
		await appShellPage.leaveSettings();

		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
		await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);

		await chatComposerPage.addAttachment(chatAttachmentData.image.path);
		await chatComposerPage.verifyAttachmentVisible();
		await chatComposerPage.verifyAttachmentCount(1);
		await chatComposerPage.removeAttachment();
		await chatComposerPage.verifyAttachmentCount(0);

		await chatComposerPage.addAttachment(chatAttachmentData.image.path);
		await chatComposerPage.verifyAttachmentCount(1);
		await chatComposerPage.typeMessage(chatAttachmentData.image.promptMarker);
		await chatComposerPage.send();

		await chatComposerPage.verifyAssistantReplyVisible(
			chatAttachmentStubReplies[chatAttachmentData.image.promptMarker]!,
		);
		await chatAttachmentProviderPage.verifyCapturedImageByteLength(
			chatAttachmentData.image.promptMarker,
			chatAttachmentData.image.expectedByteLength,
		);

		// Proves the composer-scoped locator fix: the sent message now renders
		// its own attachment tile (UserMessageAttachments), which must not leak
		// into the composer's own (now-empty) attachment count.
		await chatComposerPage.verifyAttachmentCount(0);
	});
});
