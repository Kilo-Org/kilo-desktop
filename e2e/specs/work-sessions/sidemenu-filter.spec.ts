import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../fixtures/work-sessions/sidemenu-filter.js";
import { removePathAfterAppStops } from "../../fixtures/shell.js";
import type { SessionListPage } from "../../pages/work-sessions/session-list-page.js";
import { sessionListData } from "../../testdata/work-sessions/session-list.js";

/** A title with scripts, combining marks and an emoji, to prove the row survives it. */
const AWKWARD = sessionListData.awkwardTitle;

/**
 * Seeds one session inside a fresh workspace and one outside any, named for the
 * test that asked.
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
 * What the side menu's workspace filter shows: its unscoped and All choices,
 * and that the choice it was left on survives a window reload.
 */
test.describe("Side menu workspace filter choices @packaged", () => {
	test("narrows to the sessions outside a workspace, then All brings them all back @smoke", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const { inside, loose } = await seedPair(sessionListPage, "Narrowing");
		await sessionListPage.verifyListed(inside);
		await sessionListPage.verifyListed(loose);

		await sidemenuPage.focusUnscopedInFilter();
		await sessionListPage.verifyListed(loose);
		await sessionListPage.verifyNotListed(inside);

		await sidemenuPage.focusAllWorkspacesInFilter();
		await sessionListPage.verifyListed(inside);
		await sessionListPage.verifyListed(loose);
	});

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

test.describe("Side menu with an awkward title @packaged", () => {
	test("lists and opens a session whose title is long and not latin", async ({
		sessionListPage,
	}) => {
		await sessionListPage.seedSessions([AWKWARD]);
		await sessionListPage.reloadWindow();

		await sessionListPage.verifyListed(AWKWARD);
		await sessionListPage.switchTo(AWKWARD);
	});
});
