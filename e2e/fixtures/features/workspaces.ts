import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspacesPage } from "../../pages/features/workspaces/workspaces-page.js";
import { test as shellTest } from "../shell.js";

type WorkspacesFixtures = {
	workspacesPage: WorkspacesPage;
	workspaceFolder: { path: string; name: string };
};

export const test = shellTest.extend<WorkspacesFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workspaceFolder: async ({}, use) => {
		const folderPath = await mkdtemp(path.join(os.tmpdir(), "aad-workspace-"));
		await use({ path: folderPath, name: path.basename(folderPath) });
		await rm(folderPath, { recursive: true, force: true });
	},
	workspacesPage: async ({ electronApp, workspaceFolder }, use) => {
		await electronApp.evaluate(({ dialog }, selectedPath) => {
			type MutableDialog = {
				showOpenDialog: typeof dialog.showOpenDialog;
			};
			type WorkspaceGlobals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as WorkspaceGlobals;
			globals.__workspaceOriginalShowOpenDialog ??= dialog.showOpenDialog;
			(dialog as MutableDialog).showOpenDialog = async () => ({
				canceled: false,
				filePaths: [selectedPath],
				bookmarks: [],
			});
		}, workspaceFolder.path);

		await use(new WorkspacesPage());

		await electronApp.evaluate(({ dialog }) => {
			type WorkspaceGlobals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as WorkspaceGlobals;
			if (globals.__workspaceOriginalShowOpenDialog) {
				(dialog as { showOpenDialog: typeof dialog.showOpenDialog }).showOpenDialog =
					globals.__workspaceOriginalShowOpenDialog;
				delete globals.__workspaceOriginalShowOpenDialog;
			}
		});
	},
});
