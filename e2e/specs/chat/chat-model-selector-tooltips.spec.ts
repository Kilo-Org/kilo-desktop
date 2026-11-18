import { test } from "../../fixtures/chat.js";
import { chatModelSelectorData } from "../../testdata/chat/model-selector.js";

/**
 * The Kilo Gateway info tooltip for every provider family: facts against the
 * gateway's own data, static copy spelling and section layout. Split from
 * chat-model-selector.spec.ts so CI can run it on its own shard.
 */
test.describe("Chat model selector", () => {
	// Every test opens its own draft and the fixture clears localStorage after
	// each, so the tests are independent and can run on any worker.
	test.describe.configure({ mode: "parallel" });

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
