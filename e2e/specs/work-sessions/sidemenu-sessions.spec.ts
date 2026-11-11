import { test } from "../../fixtures/work-sessions/sidemenu-sessions.js";

/** The title an empty session is listed under, as the New Session page starts it. */
const SESSION = "New session";

/**
 * The side menu's per-row surfaces once it holds a session: the row menu, the
 * Pinned shelf and the Archived shelf.
 *
 * session-list.spec.ts covers the lifecycle end to end (start, rename, pin,
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
});
