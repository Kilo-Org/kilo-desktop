import { test } from "../../fixtures/chat.js";
import { chatModelSelectorData } from "../../testdata/chat/model-selector.js";

/**
 * Favoriting Kilo Gateway models from the model selector, one test per
 * provider family. Split from chat-model-selector.spec.ts so CI can run it on
 * its own shard.
 */
// Favorites persist in kilo.core's storage under the app profile, which the
// fixture's localStorage reset does not clear. Its own app profile keeps them
// from reaching chat-model-selector.spec.ts's empty-favorites test.
test.use({ appIsolationKey: "chat-model-favorites" });

test.describe("Chat model selector", () => {
	// Every test opens its own draft; favoriting different models in any order
	// leaves each test's own favorites listed, so they can run on any worker.
	test.describe.configure({ mode: "parallel" });

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

				await chatModelSelectorPage.favorite(modelId);
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
});
