import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { click, expectElementToContainText, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage, setPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

import { removePathAfterAppStops, waitForMainWindow } from "../../../fixtures/electron.js";
import { packagedAppLaunchEnv } from "../../../utils/app-launcher.js";
import { packagedExecutable } from "../../../utils/paths.js";

export class ThemePage {
	async verifyThemeSurvivesRestart(): Promise<void> {
		// Keep the worker's shared app alive; restart only this disposable profile.
		const sharedPage = getPage();
		const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-theme-"));
		removePathAfterAppStops(userData);
		await Promise.all([
			writeFile(path.join(userData, ".gitconfig"), ""),
			writeFile(path.join(userData, ".gitconfig-system"), ""),
		]);
		const launch = () =>
			electron.launch({
				executablePath: packagedExecutable(),
				args: [`--user-data-dir=${userData}`],
				env: packagedAppLaunchEnv(userData),
			});
		let app: ElectronApplication | undefined;
		try {
			app = await launch();
			setPage(await waitForMainWindow(app));
			await click(getLocatorByTestId("nav-settings"));
			await click(getLocatorByTestId("settings-section-appearance"));
			await click(getLocatorByTestId("appearance-theme-dark"));
			await click(getLocatorByTestId("appearance-color-theme"));
			await click(getLocatorByTestId("appearance-color-theme-dracula"));
			await app.close();
			app = undefined;

			app = await launch();
			const relaunchedApp = app;
			setPage(await waitForMainWindow(relaunchedApp));
			await click(getLocatorByTestId("nav-settings"));
			await click(getLocatorByTestId("settings-section-appearance"));
			await expectElementToContainText(getLocatorByTestId("appearance-color-theme"), "Dracula", {
				message: "The theme picker should restore Dracula after relaunch",
			});
			const window = await relaunchedApp.browserWindow(getPage());
			try {
				// Electron 41 reports transparent vibrancy as #000000, not #00000000.
				const nativeBackground = process.platform === "darwin" ? /^#000000(00)?$/ : /^#282a36$/;
				await expect
					.poll(() => window.evaluate((window) => window.getBackgroundColor().toLowerCase()), {
						message: "Native window should restore Dracula, or retain macOS transparency",
					})
					.toMatch(nativeBackground);
				await expect
					.poll(() => relaunchedApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource), {
						message: "Native menus and dialogs should restore the dark appearance",
					})
					.toBe("dark");
			} finally {
				await window.dispose();
			}
		} finally {
			setPage(sharedPage);
			await app?.close();
		}
	}
}
