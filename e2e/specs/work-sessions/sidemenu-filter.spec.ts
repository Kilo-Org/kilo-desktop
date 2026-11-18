import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../fixtures/work-sessions/sidemenu-filter.js";
import { removePathAfterAppStops } from "../../fixtures/shell.js";
import type { SessionListPage } from "../../pages/work-sessions/session-list-page.js";

/**
 * Seeds one session inside a fresh workspace and one outside any, named for the
 * reload-persistence test.
 *
 * Every test here shares the block's app, so seeded sessions accumulate, and
 * row locators match titles by case-insensitive substring: each test needs its
 * own names, and no name may contain another.
 */
async function seedPair(sessionListPage: SessionListPage, prefix: string) {
	const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-filter-"));
	const folder = await realpath(rawPath);
	removePathAfterAppStops(rawPath);
	removePathAfterAppStops(folder);
	const workspaceId = await sessionListPage.createWorkspaceAt(folder, path.basename(folder));
	const inside = `${prefix} held by a workspace`;
	const loose = `${prefix} on its own`;
	await sessionListPage.seedSessionInWorkspace(inside, workspaceId);
	await sessionListPage.seedSessions([loose]);
	await sessionListPage.reloadWindow();
	return { inside, loose };
}

/**
 * The workspace filter choices are covered at the component tier; this
 * verifies that its selection survives a window reload.
 */
test.describe("Side menu workspace filter persistence @packaged", () => {
	test("keeps the filter's choice across a window reload", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const { inside, loose } = await seedPair(sessionListPage, "Reloading");

		await sidemenuPage.focusUnscopedInFilter();
		await sessionListPage.verifyNotListed(inside);

		await sessionListPage.reloadWindow();
		await sessionListPage.verifyListed(loose);
		await sessionListPage.verifyNotListed(inside);

		// Leave the filter as the next test expects to find it.
		await sidemenuPage.focusAllWorkspacesInFilter();
	});
});
