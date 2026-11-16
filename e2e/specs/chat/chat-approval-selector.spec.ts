import { test } from "../../fixtures/chat.js";

test.use({ appIsolationKey: "chat-approval" });

/**
 * Coverage for the chat composer approval selector: default and selected modes,
 * persistence, app-wide scope, and dismissal behavior.
 */
test.describe("Chat approval selector", () => {
	test("defaults to Manual and opens the approval menu @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalMenuOpen();
	});

	test("selecting Auto updates the label and checked state and persists across reload @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.selectAutoApproval();
		await chatApprovalSelectorPage.verifyApprovalMenuClosed();
		await chatApprovalSelectorPage.verifyApprovalLabel("Auto");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("auto");
		await chatApprovalSelectorPage.reloadApp();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.verifyApprovalLabel("Auto");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("auto");
	});

	test("selecting Manual again persists across reload", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.selectAutoApproval();
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.selectManualApproval();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.reloadApp();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("manual");
	});

	test("Manual and Auto labels always match the selected radio item", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("manual");
		await chatApprovalSelectorPage.selectAutoApproval();
		await chatApprovalSelectorPage.verifyApprovalLabel("Auto");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("auto");
		await chatApprovalSelectorPage.selectManualApproval();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("manual");
	});

	test("the approval choice applies across persisted chats", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		try {
			await chatApprovalSelectorPage.reloadApp();
			await appShellPage.verifyShellIsLoaded();
			await chatComposerPage.openDraft();
			await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
			await chatApprovalSelectorPage.createPersistedChat(
				"Distinct first chat message for app-wide approval preference verification.",
			);

			await chatApprovalSelectorPage.switchToNewChat();
			await chatApprovalSelectorPage.createPersistedChat(
				"Distinct second chat message for app-wide approval preference verification.",
			);

			await chatApprovalSelectorPage.switchToPersistedChat(0);
			await chatApprovalSelectorPage.openApprovalSelector();
			await chatApprovalSelectorPage.selectAutoApproval();
			await chatApprovalSelectorPage.verifyApprovalLabel("Auto");
			// A radio choice leaves the menu open. Close it before leaving: the work
			// session stays mounted but hidden, and React's Activity doesn't hide a
			// portaled popup, so one left mid-close would linger in the page.
			await chatApprovalSelectorPage.closeWithEscape();
			await chatApprovalSelectorPage.verifyApprovalMenuClosed();

			await chatApprovalSelectorPage.switchToPersistedChat(1);
			await chatApprovalSelectorPage.verifyApprovalLabel("Auto");
			await chatApprovalSelectorPage.openApprovalSelector();
			await chatApprovalSelectorPage.verifyApprovalModeIsSelected("auto");
		} finally {
			await chatApprovalSelectorPage.cleanupCreatedChats();
		}
	});

	test("Escape closes the menu without changing the approval mode", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.selectManualApproval();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("manual");
		await chatApprovalSelectorPage.closeWithEscape();
		await chatApprovalSelectorPage.verifyApprovalMenuClosed();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
	});

	test("clicking outside closes the menu without changing the approval mode", async ({
		appShellPage,
		chatComposerPage,
		chatApprovalSelectorPage,
	}) => {
		await chatApprovalSelectorPage.reloadApp();
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.selectManualApproval();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
		await chatApprovalSelectorPage.openApprovalSelector();
		await chatApprovalSelectorPage.verifyApprovalModeIsSelected("manual");
		await chatApprovalSelectorPage.closeByClickingOutside();
		await chatApprovalSelectorPage.verifyApprovalMenuClosed();
		await chatApprovalSelectorPage.verifyApprovalLabel("Manual");
	});
});
