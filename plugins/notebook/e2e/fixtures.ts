import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { packagedAppLaunchEnv } from "@anaconda-agentic-desktop/e2e";
import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";
import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { NotebookPage } from "./pages/notebook-page.js";

const DESKTOP_URL_PREFIX = "anaconda-agentic-desktop://";

async function mainWindow(app: ElectronApplication): Promise<Page> {
	const existing = app.windows().find((page) => page.url().startsWith(DESKTOP_URL_PREFIX));
	if (existing) return existing;
	const opened = await app.waitForEvent("window", {
		predicate: (page) => page.url().startsWith(DESKTOP_URL_PREFIX),
		timeout: 30_000,
	});
	return opened;
}

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
	restartableNotebookApp: async ({ electronApp }, use) => {
		const executablePath = electronApp.process().spawnfile;
		const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "aad-notebook-restart-"));
		let app!: ElectronApplication;
		const launch = async () => {
			app = await electron.launch({
				executablePath,
				args: [`--user-data-dir=${userDataDirectory}`],
				env: packagedAppLaunchEnv(),
			});
			setPage(await mainWindow(app));
		};
		await launch();
		await use({
			app: () => app,
			async restart() {
				await app.close();
				await launch();
			},
		});
		await app.close();
		await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
	},
});

export const { expect } = test;
