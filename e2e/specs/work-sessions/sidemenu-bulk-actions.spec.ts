import { test } from "../../fixtures/work-sessions/sidemenu-bulk.js";

const FIRST = "Archived one";
const SECOND = "Archived two";

/**
 * Restoring a selection of archived sessions from the list's bulk menu.
 *
 * Its own file, with no session started and none open: Meta-click adds the
 * open session to the selection, which would make the bulk menu act on a third
 * session this has nothing to say about.
 */
test.describe("Side menu bulk actions @packaged", () => {
	test("restores an archived selection, and offers no Archive for it", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.seedSessions([FIRST, SECOND]);
		await sessionListPage.reloadWindow();

		await sessionListPage.archive(FIRST);
		await sessionListPage.archive(SECOND);
		await sidemenuPage.expandArchivedShelf();

		await sessionListPage.selectWithMetaClick(FIRST);
		await sessionListPage.selectWithMetaClick(SECOND);
		await sessionListPage.openSelectionMenu(SECOND);
		await sessionListPage.verifySelectionCount(2);
		// Archiving is meaningless for a selection that is already archived.
		await sessionListPage.verifyBulkArchiveAbsent();

		await sessionListPage.restoreSelection();
		await sessionListPage.verifyActiveListed(FIRST);
		await sessionListPage.verifyActiveListed(SECOND);
	});
});
