import { test } from "../../fixtures/chat.js";

/**
 * The welcome composer's `/` menu against the packaged Kilo CLI: the menu
 * lists the CLI's own commands (its catalog request over the real
 * connection), and choosing one leaves its chip in the draft. Menu grouping,
 * searching, running client commands and sending a typed command already have
 * component coverage; this only proves the welcome screen's wiring to the
 * server catalog.
 */
test.describe("Chat welcome slash commands", () => {
	test("lists the Kilo CLI's commands and keeps the chosen one in the draft @smoke @packaged", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		await chatComposerPage.typeSlashQuery("in");
		await chatComposerPage.verifySlashCommandListed("init", "guided AGENTS.md setup");
		await chatComposerPage.chooseSlashCommand("init");
		await chatComposerPage.verifyComposerCommand("init");
	});
});
