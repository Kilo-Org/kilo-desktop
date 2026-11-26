import { test } from "../../fixtures/chat.js";

/**
 * Model selector coverage against the packaged app: the trigger, the menu,
 * the provider rail (Favorites + Local Model Server), the search box, the
 * two empty states, menu dismissal/rail switching and the Kilo Gateway info
 * tooltip. Favoriting lives in chat-model-selector-favorites.spec.ts, split out
 * so CI can run it on a different shard.
 *
 * No model selection or sending. The default model is out of scope.
 * Favorites persistence across reload/sessions is out of scope: the
 * fixture clears localStorage after every test. The signed-out variant
 * is not covered here: the packaged build always reports signed-in.
 */
test.describe("Chat model selector", () => {
	// Every test opens its own draft and the fixture clears localStorage after
	// each, so the tests are independent and can run on any worker.
	test.describe.configure({ mode: "parallel" });

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

	test("shows the provider rail with the Favorites button @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.verifyRailVisible();
		await chatModelSelectorPage.verifyFavoritesButtonVisible();
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
		await chatModelSelectorPage.selectKiloGateway();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.selectFavorites();
		await chatModelSelectorPage.verifySearchVisible();
		await chatModelSelectorPage.closeWithEscape();
		await chatModelSelectorPage.verifyMenuClosed();
	});

	test("opens a well-formed info tooltip for a Kilo Gateway model @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectKiloGateway();
		const modelId = await chatModelSelectorPage.getGatewayModelId();
		const modelName = await chatModelSelectorPage.getPublisherModelName(modelId);
		const groundTruth = await chatModelSelectorPage.fetchGatewayModelGroundTruth(modelId);

		await chatModelSelectorPage.openModelInfo(modelId);
		await chatModelSelectorPage.verifyModelInfoOpen(modelId);
		await chatModelSelectorPage.verifyModelInfoTitleAndDescription(modelId, modelName, groundTruth);
		await chatModelSelectorPage.verifyModelInfoFacts(modelId, groundTruth);
		await chatModelSelectorPage.verifyModelInfoOptionalCopySpelledCorrectly(modelId);
		await chatModelSelectorPage.verifyModelInfoSectionsDoNotOverlap(modelId);

		await chatModelSelectorPage.closeModelInfo(modelId);
		await chatModelSelectorPage.verifyModelInfoClosed(modelId);
		await chatModelSelectorPage.closeWithEscape();
		await chatModelSelectorPage.verifyMenuClosed();
	});
});
