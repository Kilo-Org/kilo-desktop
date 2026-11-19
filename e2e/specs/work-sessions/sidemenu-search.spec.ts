import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../fixtures/work-sessions/sidemenu-search.js";
import { removePathAfterAppStops } from "../../fixtures/shell.js";
import type { SessionListPage } from "../../pages/work-sessions/session-list-page.js";

/**
 * Registers a workspace and two sessions — one in it, one outside — all named
 * from `prefix`.
 *
 * Every test here shares the block's app, so workspaces and sessions
 * accumulate: each test needs its own names, or a result locator matches the
 * leftovers of the test before it. The workspace's name deliberately appears
 * in no title, so a session matching it can only have matched on its
 * workspace.
 */
async function seedFor(sessionListPage: SessionListPage, prefix: string) {
	const workspace = `${prefix}space`;
	const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-search-"));
	const folder = await realpath(rawPath);
	removePathAfterAppStops(rawPath);
	removePathAfterAppStops(folder);
	const workspaceId = await sessionListPage.createWorkspaceAt(folder, workspace);
	const inside = `${prefix} held session`;
	const outside = `${prefix} loose session`;
	await sessionListPage.seedSessionInWorkspace(inside, workspaceId);
	await sessionListPage.seedSessions([outside]);
	await sessionListPage.reloadWindow();
	return { workspace, inside, outside };
}

/**
 * What the session search matches and shows. The dialog opening and its empty
 * messages are covered by sidemenu.spec.ts and sidemenu-sessions.spec.ts;
 * these are the results themselves: a session found by its workspace rather
 * than its title, the Sessions scope, and the query the dialog forgets.
 */
test.describe("Side menu session search @packaged", () => {
	test("finds a session by its workspace, not only by its title @smoke", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const { workspace, inside, outside } = await seedFor(sessionListPage, "Alfa");

		await sidemenuPage.openSearch();
		await sidemenuPage.typeSearchQuery(workspace);

		// Neither title contains the query: this session matched on the
		// workspace shown beside it.
		await sidemenuPage.verifySearchListsSession(inside);
		await sidemenuPage.verifySearchDoesNotListSession(outside);
		await sidemenuPage.verifySearchListsWorkspace(workspace);

		await sidemenuPage.closeWithEscape();
	});

	test("narrows to sessions alone, dropping the workspaces that match", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const { workspace, inside } = await seedFor(sessionListPage, "Bravo");

		await sidemenuPage.openSearch();
		await sidemenuPage.typeSearchQuery(workspace);
		await sidemenuPage.verifySearchListsWorkspace(workspace);

		await sidemenuPage.selectSearchScopeSessions();

		await sidemenuPage.verifySearchListsSession(inside);
		await sidemenuPage.verifySearchDoesNotListWorkspace(workspace);

		await sidemenuPage.closeWithEscape();
	});

	test("forgets the query and the scope once closed", async ({ sidemenuPage, sessionListPage }) => {
		const { workspace, inside } = await seedFor(sessionListPage, "Charlie");

		await sidemenuPage.openSearch();
		await sidemenuPage.typeSearchQuery(workspace);
		await sidemenuPage.selectSearchScopeWorkspaces();
		await sidemenuPage.verifySearchDoesNotListSession(inside);
		await sidemenuPage.closeWithEscape();

		await sidemenuPage.openSearch();

		await sidemenuPage.verifySearchQueryEmpty();
		// Back in the All scope with no query, so the sessions are listed again.
		await sidemenuPage.verifySearchListsSession(inside);
		await sidemenuPage.closeWithEscape();
	});
});
