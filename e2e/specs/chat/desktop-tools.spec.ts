import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";
import { desktopToolsData } from "../../testdata/chat/desktop-tools.js";

test.describe("Desktop agent tools @packaged", () => {
	test("serves kilo.chat's tools to Kilo through kilo.core's gateway @smoke", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
		desktopToolsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await desktopToolsPage.verifyKiloConnectedToDesktopTools();
		await appShellPage.openSettings();
		await chatStubProviderPage.configureStubProvider();
		await appShellPage.leaveSettings();

		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
		await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);
		await chatComposerPage.send(desktopToolsData.prompt);

		await chatComposerPage.verifyAssistantReplyVisible(desktopToolsData.reply);
		await desktopToolsPage.verifyDesktopToolCallReachesTheApp(chatStubProviderPage);
	});
});
