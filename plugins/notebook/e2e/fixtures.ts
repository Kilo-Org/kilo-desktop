import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	packagedAppLaunchEnv,
	packagedExecutable,
	waitForMainWindow,
} from "@anaconda-agentic-desktop/e2e";
import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";
import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication } from "playwright";

import { NotebookPage } from "./pages/notebook-page.js";

type RestartableNotebookApp = {
	app(): ElectronApplication;
	restart(): Promise<void>;
};

export const test = shellTest.extend<{
	notebookPage: NotebookPage;
	restartableNotebookApp: RestartableNotebookApp;
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	notebookPage: async ({}, use) => {
		await use(new NotebookPage());
	},
	restartableNotebookApp: async ({ electronApp: _workerApp }, use) => {
		const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "aad-notebook-restart-"));
		let app!: ElectronApplication;
		const launch = async () => {
			// Playwright's process().spawnfile is cmd.exe on Windows, not Electron.
			app = await electron.launch({
				executablePath: packagedExecutable(),
				args: [`--user-data-dir=${userDataDirectory}`],
				env: packagedAppLaunchEnv(),
			});
			setPage(await waitForMainWindow(app, 60_000));
		};
		await launch();
		await use({
			app: () => app,
			async restart() {
				await app.close();
				// Windows can keep the previous user-data-dir locked after close.
				if (process.platform === "win32") {
					await new Promise((resolve) => setTimeout(resolve, 1_000));
				}
				await launch();
			},
		});
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
	},
});

export const { expect } = test;
