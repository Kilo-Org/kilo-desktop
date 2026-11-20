import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";
import { chatSmokeData } from "../../testdata/chat/smoke.js";

/**
 * Reading Mode end to end: a reply from the mock chat-completions stub is
 * read in Focus (the full-window take-over) and left with Esc, then saved
 * from a selection; the toast opens the Saved page, which lists it and goes
 * back to the chat. Reading presets are saved, switched, updated and starred
 * from the transcript's Aa control; opening with the default preset is
 * covered by kilo.shell's main tests (it needs a restart).
 */
test.describe("Reading Mode @smoke", () => {
	test("reads a reply in Focus, saves text from it and goes back to it from Saved", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
		readingPage,
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
		await chatComposerPage.verifyAssistantReplyVisible(chatSmokeData.reply);

		await readingPage.focusFrom(chatSmokeData.reply);
		await readingPage.exitFocusWithEscape();

		await readingPage.saveParagraph(chatSmokeData.reply);
		await readingPage.viewSavedFromToast();
		await readingPage.verifySavedRow(chatSmokeData.reply);
		await readingPage.openSavedRow(chatSmokeData.reply);
	});

	test("saves, switches, updates and stars reading presets from the Aa control", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
		readingPage,
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
		await chatComposerPage.verifyAssistantReplyVisible(chatSmokeData.reply);

		await readingPage.openReadingPanel();
		await readingPage.pickReadingTheme("Gruvbox");
		await readingPage.savePreset("Late night");
		await readingPage.pickReadingTheme("Nord");
		await readingPage.savePreset("Daytime", { fromMenu: true });

		await readingPage.applyPreset("Late night");
		await readingPage.makeTextLarger();
		await readingPage.updateActivePreset("Late night");
		await readingPage.setDefaultPreset("Late night");
	});
});
