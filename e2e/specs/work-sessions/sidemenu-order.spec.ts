import { test } from "../../fixtures/work-sessions/sidemenu-order.js";
import { runFromCommandPalette } from "../../pages/shell/command-palette.js";
import type { SessionListPage } from "../../pages/work-sessions/session-list-page.js";

const NEXT_SESSION = "kilo.work-sessions/next-work-session";

/**
 * The session list publishes the rows it is showing, in their on-screen order,
 * and Next session walks that order, wrapping at the end. So the command
 * follows whatever the list currently shows: its ordering, its shelves, and
 * only its active rows.
 *
 * `window.browser.test.tsx` sets that order by hand to test the command
 * itself; what these cover is the list feeding it, which only shows up with
 * the real list on screen.
 *
 * Each test seeds its own titles and deletes them again: they share the
 * block's app, so a leftover row would sit in the next test's order.
 */
test.describe("Side menu session order @packaged", () => {
	const seeded: string[] = [];

	async function seed(sessionListPage: SessionListPage, titles: readonly string[]): Promise<void> {
		seeded.push(...titles);
		await sessionListPage.seedSessions(titles);
		await sessionListPage.reloadWindow();
	}

	test.afterEach(async ({ sessionListPage }) => {
		for (const title of seeded.splice(0)) {
			await sessionListPage.deleteAnywhere(title);
		}
	});

	test("walks the list's own order, so a reorder changes where Next goes @smoke", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		// Seeded oldest first, so recency and title disagree about the order.
		const [first, second, third] = ["Alpha order", "Bravo order", "Charlie order"];
		await seed(sessionListPage, [first, second, third]);
		await sessionListPage.verifyRowOrder([third, second, first]);

		// Bottom row under recency: Next wraps to the top, which is the newest.
		await sessionListPage.switchTo(first);
		await runFromCommandPalette(NEXT_SESSION);
		await sessionListPage.verifyOpen(third);

		await sidemenuPage.chooseFromViewMenu("Ordering", "Title");
		await sessionListPage.verifyRowOrder([first, second, third]);

		// Same row, same command: by title it is the top row, so Next steps
		// down to the second instead of wrapping.
		await sessionListPage.switchTo(first);
		await runFromCommandPalette(NEXT_SESSION);
		await sessionListPage.verifyOpen(second);
	});

	test("skips the archived sessions the Archived shelf is showing", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const archived = "Delta archived";
		const [first, second] = ["Echo active", "Foxtrot active"];
		await seed(sessionListPage, [archived, first, second]);
		await sessionListPage.archive(archived);
		await sidemenuPage.expandArchivedShelf();
		await sessionListPage.verifyArchivedListed(archived);

		// The archived row is on screen, below both active ones. Next wraps
		// past it rather than opening it.
		await sessionListPage.switchTo(first);
		await runFromCommandPalette(NEXT_SESSION);
		await sessionListPage.verifyOpen(second);
	});

	test("counts a pinned session first, as the Pinned shelf shows it", async ({
		sessionListPage,
	}) => {
		const [older, pinned, newer] = ["Golf older", "Hotel pinned", "India newer"];
		await seed(sessionListPage, [older, pinned, newer]);
		await sessionListPage.verifyRowOrder([newer, pinned, older]);
		await sessionListPage.pin(pinned);
		await sessionListPage.verifyRowOrder([pinned, newer, older]);

		// From the newer row, Next follows the pin-first order to the older row.
		await sessionListPage.switchTo(newer);
		await runFromCommandPalette(NEXT_SESSION);
		await sessionListPage.verifyOpen(older);

		await sessionListPage.unpin(pinned);
	});
});
