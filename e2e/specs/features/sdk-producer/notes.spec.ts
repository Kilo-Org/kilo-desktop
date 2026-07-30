import { test } from "../../../fixtures/features/sdk-producer.js";

test.describe("SDK Producer notes @smoke", () => {
	test("adds a note through the SDK producer UI", async ({ appShellPage, notesPage }) => {
		await appShellPage.navigateToFeature("sdk-producer");
		await notesPage.addNote("Write e2e tests");
		await notesPage.verifyNoteIsListed("Write e2e tests");
	});
});
