import {
	CUSTOM_MODEL_OPTION_ID,
	CUSTOM_PROVIDER_ID,
} from "../../pages/chat/chat-stub-provider-page.js";
import { test } from "../../fixtures/chat.js";

/**
 * Keyboard handling of the welcome composer's `/` and `@` menus against the
 * packaged app. The menu parser, grouping and search are covered by component
 * tests; this proves which keys reach the open menu and that plain text never
 * becomes one.
 *
 * `/in` narrows the catalog to a single row, so the ArrowDown movement is
 * asserted on a query with several rows and `/in` keeps the Escape/Enter flow.
 * A leading `/name` stays an open menu even when nothing matches, so the
 * unknown-command case has to be typed to see that (an empty) menu at all.
 */
test.describe("Chat welcome menu keyboard", () => {
	test("Escape closes the / menu and leaves /in unsent in the composer @smoke @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeSlashQuery("in");
		await chatComposerPage.verifyTriggerMenuOpen();
		await chatComposerPage.verifyHighlightedMenuItem("init");
		await chatComposerPage.pressKey("Escape");

		await chatComposerPage.verifyTriggerMenuClosed();
		await chatComposerPage.verifyComposerHoldsText("/in");
		await chatComposerPage.verifyComposerHasNoChip();
	});

	test("ArrowDown moves the / menu highlight off the first row @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeSlashQuery("i");
		await chatComposerPage.verifyHighlightedMenuItem("init");
		await chatComposerPage.pressKey("ArrowDown");

		await chatComposerPage.verifyMenuItemNotHighlighted("init");
		await chatComposerPage.verifyOneMenuItemHighlighted();
	});

	test("Enter on /in picks the highlighted command as a chip without sending @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeSlashQuery("in");
		await chatComposerPage.verifyHighlightedMenuItem("init");
		await chatComposerPage.pressKey("Enter");

		await chatComposerPage.verifyComposerCommand("init");
		await chatComposerPage.verifyTriggerMenuClosed();
		await chatComposerPage.verifyStillOnDraft();
	});

	test("Escape closes the @ menu and leaves the typed mention text unsent @smoke @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeMessageSequentially("@welcome-mention");
		await chatComposerPage.verifyTriggerMenuOpen();
		await chatComposerPage.pressKey("Escape");

		await chatComposerPage.verifyTriggerMenuClosed();
		await chatComposerPage.verifyComposerHoldsText("@welcome-mention");
		await chatComposerPage.verifyComposerHasNoChip();
	});

	test("a mid-sentence / opens no menu", async ({ appShellPage, chatComposerPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeMessageSequentially(`see /tmp`);

		await chatComposerPage.verifyTriggerMenuClosed();
	});

	test("an unknown /command opens an empty menu and sends as plain text once closed @packaged", async ({
		appShellPage,
		chatStubProviderPage,
		chatComposerPage,
		chatModelSelectorPage,
	}, testInfo) => {
		const marker = `MENU-LITERAL-${testInfo.repeatEachIndex}-${testInfo.retry}`;
		const prompt = `/nosuchcommand ${marker}`;

		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await chatStubProviderPage.configureStubProvider();
		await appShellPage.leaveSettings();

		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectCustomProviderRail(CUSTOM_PROVIDER_ID);
		await chatModelSelectorPage.selectModel(CUSTOM_MODEL_OPTION_ID);

		await chatComposerPage.typeMessageSequentially("/nosuchcommand");
		await chatComposerPage.verifyTriggerMenuOpen();
		await chatComposerPage.verifyTriggerMenuHasNoRows();

		await chatComposerPage.typeMessageSequentially(` ${marker}`);
		await chatComposerPage.verifyTriggerMenuClosed();
		await chatComposerPage.pressKey("Enter");

		await chatComposerPage.verifyChatStarted(prompt);
		await chatStubProviderPage.verifyCapturedPromptContains(marker, prompt);
	});
});
