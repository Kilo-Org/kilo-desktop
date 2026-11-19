import { test } from "../../fixtures/work-sessions/sidemenu-view.js";

/** Seeded oldest first, so recency and title disagree about which comes first. */
const OLDER = "Alpha ordering case";
const NEWER = "Zulu ordering case";

/**
 * The side menu's view options, which the list keeps in origin's localStorage
 * key so a window comes back in the order it was left.
 *
 * What each option does to the sections is covered far more cheaply by
 * `session-list-view.test.ts` and `list.browser.test.tsx`; this is the
 * packaged app's part — a real window writing a real key and reading it again
 * on the next load. The harness clears localStorage around every test, so the
 * reload has to happen inside the test that chose the ordering.
 */
test.describe("Side menu view options @packaged", () => {
	test("keeps the list ordered by title across a window reload", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		await sessionListPage.seedSessions([OLDER, NEWER]);
		await sessionListPage.reloadWindow();
		// The list opens on recency, so the session seeded last is on top.
		await sessionListPage.verifyRowOrder([NEWER, OLDER]);

		await sidemenuPage.chooseFromViewMenu("Ordering", "Title");
		await sessionListPage.verifyRowOrder([OLDER, NEWER]);

		await sessionListPage.reloadWindow();
		await sessionListPage.verifyRowOrder([OLDER, NEWER]);
	});
});
