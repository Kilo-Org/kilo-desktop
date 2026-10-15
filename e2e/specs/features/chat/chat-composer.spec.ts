import { test } from "../../../fixtures/features/chat.js";

test.describe("Chat composer draft footer", () => {
	test("renders the draft footer, offers workspace options, and enables send after typing @smoke", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyDraftFooterVisible();
		await chatComposerPage.verifyWorkspaceSelectorVisible();
		await chatComposerPage.openWorkspaceSelector();
		await chatComposerPage.verifyUnscopedOptionVisible();
		await chatComposerPage.selectUnscopedWorkspace();
		await chatComposerPage.verifyWorkspaceSelectorLabel("Select workspace");
		await chatComposerPage.typeMessage("Composer smoke message");
		await chatComposerPage.verifySendEnabled();
	});

	test("disables send while the composer is empty", async ({ appShellPage, chatComposerPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyDraftFooterVisible();
		await chatComposerPage.verifySendDisabled();
	});
});
