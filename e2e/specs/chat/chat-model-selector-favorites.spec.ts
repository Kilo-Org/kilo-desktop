import { test } from "../../fixtures/chat.js";

/**
 * Favoriting Kilo Gateway models from the model selector. Split from
 * chat-model-selector.spec.ts so CI can run it on its own shard.
 */
// Favorites persist in kilo.core's storage under the app profile, which the
// fixture's localStorage reset does not clear. Its own app profile keeps them
// from reaching chat-model-selector.spec.ts's empty-favorites test.
test.use({ appIsolationKey: "chat-model-favorites" });

test.describe("Chat model selector", () => {
	test("favorites keep every favorited Kilo Gateway model listed together @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModelSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		const favoritedNames: string[] = [];
		for (const index of [0, 1]) {
			await chatModelSelectorPage.openModelSelector();
			await chatModelSelectorPage.selectKiloGateway();
			const modelId = await chatModelSelectorPage.getGatewayModelId(index);
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
});
