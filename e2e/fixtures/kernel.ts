import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication } from "playwright";

import { RecoveryPage } from "../pages/kernel/recovery-page.js";
import { packagedAppLaunchEnv } from "../utils/app-launcher.js";
import { packagedExecutable } from "../utils/paths.js";

import { electronFixture, removePathAfterAppStops, waitForMainWindow } from "./electron.js";

/** Kernel-level fixtures: the packaged app with no product assumptions. */
export const test = electronFixture.extend<{
	recoveryPage: RecoveryPage;
	safeModeApp: ElectronApplication;
}>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	recoveryPage: async ({}, use) => {
		await use(new RecoveryPage());
	},
	// A disposable app started with --safe-mode (no plugins); the worker's shared app is restored afterwards.
	safeModeApp: async ({ electronApp }, use) => {
		const sharedPage = await waitForMainWindow(electronApp);
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-safe-mode-"));
		removePathAfterAppStops(userData);
		await Promise.all([
			writeFile(path.join(userData, ".gitconfig"), ""),
			writeFile(path.join(userData, ".gitconfig-system"), ""),
		]);
		const app = await electron.launch({
			executablePath: packagedExecutable(),
			args: [`--user-data-dir=${userData}`, "--safe-mode"],
			env: packagedAppLaunchEnv(userData),
		});
		try {
			setPage(await waitForMainWindow(app));
			await use(app);
		} finally {
			setPage(sharedPage);
			await app.close();
		}
	},
});

export const { expect } = test;
