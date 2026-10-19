import { test } from "../../../fixtures/features/chat.js";

/**
 * UI verification for the chat welcome screen — the empty state shown when Kilo
 * opens with no active session. Asserts only the static copy and controls
 * (headline, composer placeholder, toolbar labels, draft footer), not the
 * behaviours behind them; sending and workspace selection live in the composer
 * specs.
 */
test.describe("Chat welcome screen", () => {
	test("shows the welcome headline, composer, and draft footer before a workspace is selected @smoke", async ({
		appShellPage,
		chatWelcomePage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatWelcomePage.openWelcome();
		await chatWelcomePage.verifyWelcomeLogoVisible();
		await chatWelcomePage.verifyHeadlineText("What should we work on?");
		await chatWelcomePage.verifyComposerPlaceholderVisible();
		await chatWelcomePage.verifyMessageInputVisible();
		await chatWelcomePage.verifyAddAttachmentVisible();
		await chatWelcomePage.verifyAgentSelectorVisible();
		await chatWelcomePage.verifyModelSelectorVisible();
		await chatWelcomePage.verifyApprovalSelectorVisible();
		await chatWelcomePage.verifySendVisible();
		await chatWelcomePage.verifyDraftFooterVisible();
		await chatWelcomePage.verifyWorkspaceSelectorVisible();
	});
});
