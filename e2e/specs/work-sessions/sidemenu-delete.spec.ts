import { test } from "../../fixtures/work-sessions/sidemenu-delete.js";

/**
 * The delete confirmation, which is the last thing between a stray click and a
 * permanently deleted session: it has to name the row it was opened from, and
 * Cancel has to leave that session alone.
 */
test.describe("Side menu delete confirmation @packaged", () => {
	const KEPT = "Session to keep";
	const DOOMED = "Session to delete";

	let seeded: string[] = [];

	// The delete inside the test only runs when the test gets that far, so
	// cleanup cannot live there: a failure above it would leave both rows for
	// the retry. Deleting by id covers whatever is left, deleted or not.
	test.afterEach(async ({ sessionListPage }) => {
		await sessionListPage.removeSessions(seeded.splice(0));
	});

	test("names the session it would delete, and Cancel keeps it @smoke", async ({
		sessionListPage,
	}) => {
		seeded = await sessionListPage.seedSessions([KEPT, DOOMED]);
		await sessionListPage.reloadWindow();
		// Opened from the list, so the dialog has an open session to confuse
		// with the row it was asked about.
		await sessionListPage.switchTo(KEPT);

		await sessionListPage.openDeleteDialog(DOOMED);
		await sessionListPage.verifyDeleteDialogNames(DOOMED);

		await sessionListPage.cancelDelete();
		await sessionListPage.verifyListed(DOOMED);
		await sessionListPage.verifyListed(KEPT);

		// Deleting for real leaves only the other one.
		await sessionListPage.deleteAnywhere(DOOMED);
		await sessionListPage.verifyListed(KEPT);
	});
});
