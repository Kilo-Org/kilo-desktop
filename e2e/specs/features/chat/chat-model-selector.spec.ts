import { test } from "../../../fixtures/features/chat.js";

/**
 * Model selector visibility coverage against the packaged app: the trigger, the
 * menu, the provider rail (Favorites + Local Model Server), the search box, and
 * the two empty states, plus menu dismissal and rail switching.
 *
 * Visibility only — no model selection, favorites toggling, persistence, or
 * sending. The default model and the Kilo Gateway model list need a catalog
 * fixture and are covered by a follow-up PR. The signed-out variant is not
 * covered here: the packaged build always reports signed-in.
 */
test.describe("Chat model selector", () => {
	test("shows the model trigger and opens the menu @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.verifyTriggerVisible();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.verifyMenuOpen();
	});

	test("shows the provider rail with Favorites and Local Model Server buttons @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.verifyRailVisible();
		await chatModelSelectorPage.verifyFavoritesButtonVisible();
		await chatModelSelectorPage.verifyLocalServerButtonVisible();
	});

	test("shows the model search box with its placeholder @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.verifySearchPlaceholder();
	});

	test("shows only the favorites empty message in the list", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectFavorites();
		await chatModelSelectorPage.verifyFavoritesEmptyMessage();
	});

	test("shows the local model server empty state", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectLocalModelServer();
		await chatModelSelectorPage.verifyLocalServerEmptyState();
	});

	test("Escape closes the menu and switching rails keeps the search box visible", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectFavorites();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.selectLocalModelServer();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.selectFavorites();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.closeWithEscape();
		await chatModelSelectorPage.verifyMenuClosed();
	});
});
