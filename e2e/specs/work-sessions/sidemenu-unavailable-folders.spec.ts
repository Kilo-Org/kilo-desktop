import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../fixtures/work-sessions/sidemenu-folders.js";

/**
 * The workspace filter warns when the focused workspace points at a folder the
 * app can no longer reach, and the warning is the way in to fixing it.
 *
 * Its own file: the folder has to exist when the workspace is created and be
 * gone by the time the check runs, which no other spec wants to live with.
 */
test.describe("Side menu workspace filter @packaged", () => {
	test("warns about folders it cannot reach, and opens the workspace's settings", async ({
		sidemenuPage,
		sessionListPage,
	}) => {
		const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-gone-")));
		const name = path.basename(folder);

		await sessionListPage.createWorkspaceAt(folder, name);
		await sidemenuPage.focusWorkspaceInFilter(name);
		await sidemenuPage.verifyNoUnavailableFoldersWarning();

		// Take the folder away behind the app's back, then ask it to look again.
		await rm(folder, { recursive: true, force: true });
		await sessionListPage.recheckWorkspaceFolders();

		await sidemenuPage.verifyUnavailableFoldersWarning(name);
		await sidemenuPage.openUnavailableFoldersWarning();
		await sidemenuPage.verifyWorkspaceSettingsOpen();
	});
});
