import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication } from "playwright";

import { LocalPluginsPage } from "../../pages/shell/local-plugins-page.js";
import { PACKAGED_APP_POINTER_ARGS, packagedAppLaunchEnv } from "../../utils/app-launcher.js";
import { packagedExecutable, repoRoot } from "../../utils/paths.js";
import { removePathAfterAppStops, waitForMainWindow } from "../electron.js";
import { test as shellTest } from "../shell.js";

/** A profile of its own, with the example local plugin in its plugins folder, launched on demand. */
export interface LocalPluginsProfile {
	/** Launches the app on this profile (closing the previous launch) and makes it the page under test. */
	launch(): Promise<ElectronApplication>;
	/** Answers the host's native approval dialog with "Allow". */
	allowApprovals(app: ElectronApplication): Promise<void>;
}

export const EXAMPLE_PLUGIN_FOLDER = "local-plugin";

export const test = shellTest.extend<{
	localPluginsPage: LocalPluginsPage;
	localPluginsProfile: LocalPluginsProfile;
}>({
	appIsolationKey: "local-plugins",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	localPluginsPage: async ({}, use) => {
		await use(new LocalPluginsPage());
	},
	localPluginsProfile: async ({ electronApp }, use) => {
		const sharedPage = await waitForMainWindow(electronApp);
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-local-plugins-"));
		removePathAfterAppStops(userData);
		await Promise.all([
			writeFile(path.join(userData, ".gitconfig"), ""),
			writeFile(path.join(userData, ".gitconfig-system"), ""),
		]);
		const plugins = path.join(userData, "local-plugins");
		await mkdir(plugins, { recursive: true });
		await cp(
			path.join(repoRoot, "examples", EXAMPLE_PLUGIN_FOLDER),
			path.join(plugins, EXAMPLE_PLUGIN_FOLDER),
			{ recursive: true },
		);
		let current: ElectronApplication | undefined;
		try {
			await use({
				async launch() {
					await current?.close();
					current = await electron.launch({
						executablePath: packagedExecutable(),
						args: [`--user-data-dir=${userData}`, ...PACKAGED_APP_POINTER_ARGS],
						env: packagedAppLaunchEnv(userData),
					});
					setPage(await waitForMainWindow(current));
					return current;
				},
				async allowApprovals(app) {
					await app.evaluate(({ dialog }) => {
						(dialog as { showMessageBox: unknown }).showMessageBox = async () => ({
							response: 0,
							checkboxChecked: false,
						});
					});
				},
			});
		} finally {
			setPage(sharedPage);
			await current?.close();
		}
	},
});

export const { expect } = test;
