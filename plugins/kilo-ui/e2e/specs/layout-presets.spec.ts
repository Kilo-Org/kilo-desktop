import { test } from "../fixtures.js";

test.use({
	appIsolationKey: "kilo-ui",
});

test.describe("Chat layout presets @smoke", () => {
	test("persists a saved default through the desktop bridge for new chats", async ({
		layoutPresetsPage,
	}) => {
		await layoutPresetsPage.openDraft();
		await layoutPresetsPage.saveDefault("Layout persistence smoke");
		await layoutPresetsPage.reloadAndVerifyDefault("Layout persistence smoke");
	});
});
