import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { KiloAccountPage } from "./pages/kilo-account-page.js";
import { KiloCodePage } from "./pages/kilo-code-page.js";
import { OnboardingPage } from "./pages/onboarding-page.js";
import { WorkspacesPage } from "./pages/workspaces-page.js";

type KiloUiFixtures = {
	kiloCodePage: KiloCodePage;
	kiloAccountPage: KiloAccountPage;
	onboardingPage: OnboardingPage;
	workspacesPage: WorkspacesPage;
	workspaceFolder: { path: string; name: string };
};

export const test = shellTest.extend<KiloUiFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workspaceFolder: async ({}, use) => {
		const folderPath = await mkdtemp(path.join(os.tmpdir(), "aad-kilo-ui-workspace-"));
		await use({ path: folderPath, name: path.basename(folderPath) });
		await rm(folderPath, { recursive: true, force: true });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloCodePage: async ({}, use) => {
		await use(new KiloCodePage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloAccountPage: async ({}, use) => {
		await use(new KiloAccountPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	onboardingPage: async ({}, use) => {
		await use(new OnboardingPage());
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

export const { expect } = test;
