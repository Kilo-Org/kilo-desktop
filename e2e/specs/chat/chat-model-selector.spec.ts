import { test } from "../../fixtures/chat.js";
import { chatModelSelectorData } from "../../testdata/chat/model-selector.js";

/**
 * Model selector coverage against the packaged app: the trigger, the menu,
 * the provider rail (Favorites + Local Model Server), the search box, the
 * two empty states, menu dismissal/rail switching, the Kilo Gateway info
 * tooltip, and favoriting a model from the Kilo Gateway rail.
 *
 * No model selection or sending. The default model is out of scope.
 * Favorites persistence across reload/sessions is out of scope: the
 * fixture clears localStorage after every test. The signed-out variant
 * is not covered here: the packaged build always reports signed-in.
 */
test.describe("Chat model selector", () => {
	// The slowest spec file (~4 min serially). Every test opens its own draft
	// and the fixture clears localStorage after each, so they are independent
	// and can run on any worker.
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
		const { query, publisherPrefix } = chatModelSelectorData.gatewayInfoSmokeSearchTerm;
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModelSelectorPage.openModelSelector();
		await chatModelSelectorPage.selectKiloGateway();
		await chatModelSelectorPage.searchModels(query);
		const modelId = await chatModelSelectorPage.getPublisherModelId(publisherPrefix);
		const modelName = await chatModelSelectorPage.getPublisherModelName(modelId);
		const groundTruth = await chatModelSelectorPage.fetchGatewayModelGroundTruth(modelId);

		await chatModelSelectorPage.openModelInfo(modelId);
		await chatModelSelectorPage.verifyModelInfoOpen(modelId);
		await chatModelSelectorPage.verifyModelInfoTitleAndDescription(modelId, modelName, groundTruth);

		await chatModelSelectorPage.closeModelInfo(modelId);
		await chatModelSelectorPage.verifyModelInfoClosed(modelId);
		await chatModelSelectorPage.closeWithEscape();
		await chatModelSelectorPage.verifyMenuClosed();
	});

	// One test per provider family (rather than one loop over all of them) so
	// Playwright can spread them across workers and shards.
	const favoritingTerms = [
		...chatModelSelectorData.gatewayInfoSearchTerms.map((term) => ({
			name: `favoriting a Kilo Gateway model (${term.label}) turns its star active and lists it under Favorites @smoke`,
			terms: [term],
		})),
		{
			name: "favorites keep every favorited Kilo Gateway model listed together @smoke",
			terms: chatModelSelectorData.gatewayInfoSearchTerms.slice(0, 2),
		},
	];
	for (const { name, terms } of favoritingTerms) {
		test(name, async ({ appShellPage, chatComposerPage, chatModelSelectorPage }) => {
			await appShellPage.verifyShellIsLoaded();
			await chatComposerPage.openDraft();
			const favoritedNames: string[] = [];
			for (const { query, publisherPrefix } of terms) {
				await chatModelSelectorPage.openModelSelector();
				await chatModelSelectorPage.selectKiloGateway();
				await chatModelSelectorPage.searchModels(query);
				const modelId = await chatModelSelectorPage.getPublisherModelId(publisherPrefix);
				const modelName = await chatModelSelectorPage.getPublisherModelName(modelId);

				await chatModelSelectorPage.toggleFavorite(modelId);
				await chatModelSelectorPage.verifyModelFavorited(modelId);
				favoritedNames.push(modelName);
				await chatModelSelectorPage.closeWithEscape();
				await chatModelSelectorPage.verifyMenuClosed();
			}

			await chatModelSelectorPage.openModelSelector();
			await chatModelSelectorPage.selectFavorites();
			for (const modelName of favoritedNames) {
				await chatModelSelectorPage.verifyModelInFavoritesList(modelName);
			}
			await chatModelSelectorPage.closeWithEscape();
			await chatModelSelectorPage.verifyMenuClosed();
		});
	}

	for (const { label, query, publisherPrefix } of chatModelSelectorData.gatewayInfoSearchTerms) {
		test(`shows a well-formed, non-overlapping info tooltip for a Kilo Gateway model (${label}) @reg`, async ({
			appShellPage,
			chatComposerPage,
			chatModelSelectorPage,
		}) => {
			await appShellPage.verifyShellIsLoaded();
			await chatComposerPage.openDraft();
			await chatModelSelectorPage.openModelSelector();
			await chatModelSelectorPage.selectKiloGateway();
			await chatModelSelectorPage.searchModels(query);
			const modelId = await chatModelSelectorPage.getPublisherModelId(publisherPrefix);
			const modelName = await chatModelSelectorPage.getPublisherModelName(modelId);
			const groundTruth = await chatModelSelectorPage.fetchGatewayModelGroundTruth(modelId);

			await chatModelSelectorPage.openModelInfo(modelId);
			await chatModelSelectorPage.verifyModelInfoOpen(modelId);
			await chatModelSelectorPage.verifyModelInfoTitleAndDescription(
				modelId,
				modelName,
				groundTruth,
			);
			await chatModelSelectorPage.verifyModelInfoFacts(modelId, groundTruth);
			await chatModelSelectorPage.verifyModelInfoOptionalCopySpelledCorrectly(modelId);
			await chatModelSelectorPage.verifyModelInfoSectionsDoNotOverlap(modelId);

			await chatModelSelectorPage.closeModelInfo(modelId);
			await chatModelSelectorPage.verifyModelInfoClosed(modelId);
			await chatModelSelectorPage.closeWithEscape();
			await chatModelSelectorPage.verifyMenuClosed();
		});
	}
});
