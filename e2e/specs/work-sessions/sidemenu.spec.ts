import { test } from "../../fixtures/work-sessions/sidemenu.js";

/**
 * The side menu as a newly created account lands on it — the shell sidebar
 * plus the chrome around kilo.work-sessions' session list, with no sessions
 * and therefore no Pinned or Archived shelf.
 *
 * Row behaviour lives in sidemenu-sessions.spec.ts, and the session lifecycle
 * itself in session-list.spec.ts. Session list *logic* (grouping, ordering,
 * filters) is covered far more cheaply by session-list.browser.test.tsx.
 */
test.describe("Side menu on a new account @packaged", () => {
	test("shows the chat actions, session list, and footer controls @smoke", async ({
		appShellPage,
		sidemenuPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await sidemenuPage.verifySidemenuIsVisible();
		await sidemenuPage.verifyChatActionsVisible();
		await sidemenuPage.verifySessionListVisible();
		await sidemenuPage.verifyGroupingControlsVisible();
		await sidemenuPage.verifySettingsEntryVisible();
	});

	test("starts with no sessions, and so no Pinned or Archived shelf", async ({ sidemenuPage }) => {
		await sidemenuPage.verifySessionListVisible();
		await sidemenuPage.verifyNoSessionsYet();
	});

	test("offers Sign in while no account is signed in", async ({ sidemenuPage }) => {
		await sidemenuPage.verifySignedOutAccountVisible();
	});

	test("opens the session search dialog and dismisses it with Escape", async ({ sidemenuPage }) => {
		await sidemenuPage.openSearch();
		await sidemenuPage.verifySearchDialogOpen();
		await sidemenuPage.closeWithEscape();
		await sidemenuPage.verifySearchDialogClosed();
	});

	test("opens the session list options menu from the grouping header", async ({ sidemenuPage }) => {
		await sidemenuPage.openViewMenu();
		await sidemenuPage.verifyViewMenuOpen();
	});
});
