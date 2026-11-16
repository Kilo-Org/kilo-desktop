import { test } from "../../fixtures/chat.js";
import { chatModeSelectorData } from "../../testdata/chat/mode-selector.js";

/**
 * Mode selector coverage against the packaged app: CLI-backed mode options,
 * selection and dismissal behavior, per-chat state, and the agent recorded by
 * created sessions. Browser tests cover in-memory reconciliation separately.
 */
test.describe("Chat mode selector", () => {
	test("defaults to Code and lists the built-in modes in order @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.defaultMode],
		);
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.verifyMenuOpen();
		await chatModeSelectorPage.verifyBuiltInModesInOrder();
	});

	test("lists exactly the modes the Kilo CLI reports @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.verifyMenuOpen();
		await chatModeSelectorPage.verifyMenuMatchesCliCatalog();
	});

	test("selecting a mode updates the trigger label and its checked state", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.verifyMenuClosed();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.verifyModeIsSelected(chatModeSelectorData.selectedMode);
	});

	test("records the Plan mode as the created session agent @smoke", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.sendPrompt(chatModeSelectorData.prompts.plan);
		await chatModeSelectorPage.verifySentSessionAgent(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.cleanupSentSession();
	});

	test("records each mode as the created session agent", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		for (const mode of chatModeSelectorData.transmissionModes) {
			await chatComposerPage.openDraft();
			await chatModeSelectorPage.openModeSelector();
			await chatModeSelectorPage.selectMode(mode);
			await chatModeSelectorPage.sendPrompt(
				`${chatModeSelectorData.prompts.modePrefix}${mode}${chatModeSelectorData.prompts.modeSuffix}`,
			);
			await chatModeSelectorPage.verifySentSessionAgent(mode);
			await chatModeSelectorPage.cleanupSentSession();
		}
	});

	test("records the last selected mode when the mode changes before sending", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.lastSelectedMode);
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.lastSelectedMode],
		);
		await chatModeSelectorPage.sendPrompt(chatModeSelectorData.prompts.lastMode);
		await chatModeSelectorPage.verifySentSessionAgent(chatModeSelectorData.lastSelectedMode);
		await chatModeSelectorPage.cleanupSentSession();
	});

	test("Escape closes the menu without changing the selection", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.highlightNextMode();
		await chatModeSelectorPage.closeWithEscape();
		await chatModeSelectorPage.verifyMenuClosed();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
	});

	test("clicking outside closes the menu without changing the selection", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.closeByClickingOutside();
		await chatModeSelectorPage.verifyMenuClosed();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
	});

	test("every rendered mode updates the trigger label when selected", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		const modes = await chatModeSelectorPage.readModeEntries();
		await chatModeSelectorPage.closeWithEscape();
		for (const mode of modes) {
			await chatModeSelectorPage.openModeSelector();
			await chatModeSelectorPage.selectMode(mode.id);
			await chatModeSelectorPage.verifyTriggerLabel(mode.label);
		}
	});

	test("the mode is scoped to the chat", async ({
		appShellPage,
		chatComposerPage,
		chatModeSelectorPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.openModeSelector();
		await chatModeSelectorPage.selectMode(chatModeSelectorData.selectedMode);
		await chatModeSelectorPage.sendPrompt(chatModeSelectorData.prompts.perChat);
		await chatModeSelectorPage.verifySentSessionAgent(chatModeSelectorData.selectedMode);
		await chatComposerPage.openDraft();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.defaultMode],
		);
		await chatModeSelectorPage.switchToSentSession();
		await chatModeSelectorPage.verifyTriggerLabel(
			chatModeSelectorData.modeLabels[chatModeSelectorData.selectedMode],
		);
		await chatModeSelectorPage.cleanupSentSession();
	});
});
