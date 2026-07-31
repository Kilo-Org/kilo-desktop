import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as baseTest, type TestInfo } from "@playwright/test";
import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication } from "playwright";

import { buildPackagedApp, killStrayProcesses } from "../utils/app-launcher.js";
import { ConsoleLogCollector } from "../utils/console-log-collector.js";
import { packagedExecutable } from "../utils/paths.js";

type ElectronFixtures = {
	electronApp: ElectronApplication;
	diagnostics: void;
};

type ElectronWorkerFixtures = {
	sharedApp: ElectronApplication;
};

async function launchApp(): Promise<{ app: ElectronApplication; userDataDir: string }> {
	const userDataDir = await mkdtemp(path.join(os.tmpdir(), "aad-e2e-"));
	const app = await electron.launch({
		executablePath: packagedExecutable(),
		args: [`--user-data-dir=${userDataDir}`],
	});
	return { app, userDataDir };
}

/**
 * Worker-scoped packaged Electron app. Every test in the worker reuses one launch;
 * `electronApp` rebinds the page singleton and resets the hash between tests.
 */
export const electronFixture = baseTest.extend<ElectronFixtures, ElectronWorkerFixtures>({
	sharedApp: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
		async ({}, use, workerInfo) => {
			await killStrayProcesses();
			if (workerInfo.workerIndex === 0 && process.env.SKIP_BUILD !== "true") {
				await buildPackagedApp();
			}
			const { app, userDataDir } = await launchApp();
			await use(app);
			await app.close();
			await rm(userDataDir, { recursive: true, force: true });
		},
		{ scope: "worker" },
	],

	electronApp: async ({ sharedApp }, use) => {
		const page = await sharedApp.firstWindow();
		setPage(page);
		await page.evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await use(sharedApp);
	},

	diagnostics: [
		async ({ electronApp }, use, testInfo: TestInfo) => {
			const page = await electronApp.firstWindow();
			const logs = new ConsoleLogCollector(page);
			logs.start();
			await use();
			if (testInfo.status === "failed") {
				await testInfo.attach("screenshot", {
					body: await page.screenshot(),
					contentType: "image/png",
				});
				await testInfo.attach("page.html", {
					body: await page.content(),
					contentType: "text/html",
				});
				await logs.attach(testInfo);
			}
			logs.stop();
		},
		{ scope: "test", auto: true },
	],
});
