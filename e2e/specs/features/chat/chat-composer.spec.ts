import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../../fixtures/features/chat.js";
import { removePathAfterAppStops } from "../../../fixtures/shell.js";

test.describe("Chat composer", () => {
	test("enables send once the composer has text @smoke", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifySendDisabled();
		await chatComposerPage.typeMessage("Composer smoke message");
		await chatComposerPage.verifySendEnabled();
	});

	test("starts the session's chat in its workspace on the first send @smoke @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		// kilo.workspaces stores folders by their realpath (macOS temp dirs are
		// /var → /private/var symlinks). Removal waits for the app to stop.
		const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-chat-workspace-"));
		const folderPath = await realpath(rawPath);
		removePathAfterAppStops(rawPath);
		removePathAfterAppStops(folderPath);

		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraftInWorkspace(folderPath, path.basename(folderPath));
		await chatComposerPage.send("Workspace first send");
		await chatComposerPage.verifyChatStarted("Workspace first send");
		await chatComposerPage.verifySessionInWorkspace(path.basename(folderPath));
	});

	test("starts an unscoped session's chat in its own folder @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.send("Unscoped first send");
		await chatComposerPage.verifyChatStarted("Unscoped first send");
	});
});
