import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication } from "playwright";

import { SettingsPage } from "../../pages/shell/settings-page.js";
import { SIGNED_OUT_LAUNCH_ENV } from "../../testdata/account.js";
import { PACKAGED_APP_POINTER_ARGS, packagedAppLaunchEnv } from "../../utils/app-launcher.js";
import { packagedExecutable } from "../../utils/paths.js";
import { removePathAfterAppStops, waitForMainWindow } from "../electron.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{
	settingsPage: SettingsPage;
	signedOutApp: ElectronApplication;
}>({
	// Its own worker: the signed-out disposable app and the account the sections read stay
	// out of the shared app's specs.
	appIsolationKey: "settings",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	settingsPage: async ({}, use) => {
		await use(new SettingsPage());
	},
	// A disposable signed-out app for one test; the worker's shared signed-in app stays alive
	// and is restored as the page under test afterwards.
	signedOutApp: async ({ electronApp }, use) => {
		const sharedPage = await waitForMainWindow(electronApp);
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-signed-out-"));
		removePathAfterAppStops(userData);
		await Promise.all([
			writeFile(path.join(userData, ".gitconfig"), ""),
			writeFile(path.join(userData, ".gitconfig-system"), ""),
		]);
		const app = await electron.launch({
			executablePath: packagedExecutable(),
			args: [`--user-data-dir=${userData}`, ...PACKAGED_APP_POINTER_ARGS],
			env: packagedAppLaunchEnv(userData, { ...process.env, ...SIGNED_OUT_LAUNCH_ENV }),
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
