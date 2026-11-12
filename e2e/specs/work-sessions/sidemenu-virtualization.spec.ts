import { test } from "../../fixtures/work-sessions/sidemenu-many.js";

/** Enough sessions that the window can only ever hold a fraction of them. */
const COUNT = 200;
const TITLES = Array.from({ length: COUNT }, (_, index) => `Seeded ${index}`);
/** The list orders by recency, so the last one seeded sits at the top. */
const NEWEST = TITLES[COUNT - 1]!;
const OLDEST = TITLES[0]!;
const STEPS = 40;
const STEPS_DOWN_FROM_NEWEST = TITLES[COUNT - 1 - STEPS]!;

/**
 * The side menu's virtualized history. The list only mounts the rows near the
 * viewport, so a long history stays cheap while every session stays reachable.
 *
 * Seeded through the work sessions domain object rather than the New Session
 * page: 200 sessions at a second each is not a viable setup through the UI.
 */
test.describe("Side menu with a long history @packaged", () => {
	test.beforeEach(async ({ sessionListPage }) => {
		await sessionListPage.seedSessions(TITLES);
		await sessionListPage.reloadWindow();
		await sessionListPage.verifyListed(NEWEST);
	});

	test("mounts only the rows near the viewport, and reaches the rest by scrolling @smoke", async ({
		sessionListPage,
	}) => {
		await sessionListPage.verifyFewerRowsMountedThan(COUNT);
		await sessionListPage.verifyNotListed(OLDEST);

		await sessionListPage.scrollToBottom();
		await sessionListPage.verifyListed(OLDEST);
	});

	test("keeps the row list as tall as the whole history", async ({ sessionListPage }) => {
		await sessionListPage.verifyRowListTallerThanViewport();
	});

	test("walks the arrow keys past the mounted window, scrolling rows in as it goes", async ({
		sessionListPage,
	}) => {
		await sessionListPage.focusRow(NEWEST);
		await sessionListPage.pressArrowDown(STEPS);

		await sessionListPage.verifyListed(STEPS_DOWN_FROM_NEWEST);
		await sessionListPage.verifyRowFocused(STEPS_DOWN_FROM_NEWEST);
	});
});
