import { test } from "../../fixtures/work-sessions/sidemenu-sessions.js";

/** The title an empty session is listed under, as the New Session page starts it. */
const SESSION = "New session";

/**
 * The side menu's per-row surfaces once it holds a session: the row menu, the
 * Pinned shelf and the Archived shelf.
 *
 * work-sessions.spec.ts covers the lifecycle end to end (start, rename,
 * archive, delete) in one pass; these assert the shelves and the row menu the
 * side menu grows around it, plus the Shift+Click pin shortcut that has no
 * other coverage.
 */
test.describe("Side menu with sessions @packaged", () => {
	test.beforeEach(async ({ sessionListPage }) => {
		await sessionListPage.startSessionFromNewSessionPage();
		await sessionListPage.verifyListed(SESSION);
	});

	// Sessions share the block's app and are all titled "New session", so a
	// leftover row would make the title ambiguous for the next test.
	test.afterEach(async ({ sessionListPage }) => {
		await sessionListPage.deleteAnywhere(SESSION);
	});

	test("offers the row actions for a listed session @smoke", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.openRowMenu(SESSION);
		await sessionListPage.verifyRowMenuOffersSessionActions();
		await sidemenuPage.closeWithEscape();
		await sessionListPage.verifyRowMenuClosed();
	});

	test("pinning a session adds the Pinned shelf and unpinning removes it", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sidemenuPage.verifyNoPinnedShelf();
		await sessionListPage.pin(SESSION);
		await sidemenuPage.verifyPinnedShelfVisible();
		await sessionListPage.unpin(SESSION);
		await sidemenuPage.verifyNoPinnedShelf();
	});

	// Shift+Click used to pin; it now selects the row for a bulk action, and
	// pinning is the row menu's job.
	test("selects a session with the row's Shift+Click shortcut", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.selectWithShiftClick(SESSION);
		await sessionListPage.verifySelected(SESSION);
		await sidemenuPage.verifyNoPinnedShelf();
	});

	test("archiving a session moves it onto the Archived shelf", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sidemenuPage.verifyNoArchivedShelf();
		await sessionListPage.archive(SESSION);
		await sidemenuPage.verifyArchivedShelfVisible();
		await sidemenuPage.expandArchivedShelf();
		await sessionListPage.verifyArchivedListed(SESSION);
	});

	test("abandons an inline rename on Escape, keeping the old title", async ({
		sessionListPage,
	}) => {
		await sessionListPage.startRename(SESSION);
		await sessionListPage.typeRenameTitle("Discarded name");
		await sessionListPage.cancelRename();

		await sessionListPage.verifyRenameClosed();
		await sessionListPage.verifyListed(SESSION);
		await sessionListPage.verifyNotListed("Discarded name");
	});

	test("keeps the old title when the new one is blank", async ({ sessionListPage }) => {
		await sessionListPage.startRename(SESSION);
		await sessionListPage.typeRenameTitle("   ");
		await sessionListPage.commitRename();

		await sessionListPage.verifyRenameClosed();
		await sessionListPage.verifyListed(SESSION);
	});

	test("says why the session search is empty, per query and scope", async ({ sidemenuPage }) => {
		await sidemenuPage.openSearch();
		await sidemenuPage.verifySearchDialogOpen();

		await sidemenuPage.typeSearchQuery("nothing matches this");
		await sidemenuPage.verifySearchMessage("No results.");

		await sidemenuPage.clearSearchQuery();
		await sidemenuPage.verifySearchMessageAbsent("No results.");

		await sidemenuPage.selectSearchScopeWorkspaces();
		await sidemenuPage.verifySearchMessage("No workspaces yet.");

		// Leave the dialog closed, or it covers the rows that teardown deletes.
		await sidemenuPage.closeWithEscape();
		await sidemenuPage.verifySearchDialogClosed();
	});

	// Both of these need the packaged app: the shelf preference is real
	// localStorage and pin/archive come back from main's store over IPC. The
	// harness clears localStorage around every test, so the reload has to
	// happen inside the test that set the preference.
	test("keeps the Archived shelf expanded across a window reload", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.archive(SESSION);

		// Remount first: the shelf's expanded state lives in the list's React
		// state, which outlives a test, so without this the shelf may already
		// be open and expanding it would write no preference to persist.
		await sessionListPage.reloadWindow();
		await sidemenuPage.verifyArchivedShelfCollapsed();
		await sidemenuPage.expandArchivedShelf();
		await sessionListPage.verifyArchivedListed(SESSION);

		await sessionListPage.reloadWindow();
		await sidemenuPage.verifyArchivedShelfExpanded();
		await sessionListPage.verifyArchivedListed(SESSION);
	});

	test("keeps a session pinned across a window reload", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.pin(SESSION);
		await sidemenuPage.verifyPinnedShelfVisible();

		await sessionListPage.reloadWindow();
		await sidemenuPage.verifyPinnedShelfVisible();
		await sessionListPage.verifyListed(SESSION);
	});
});
