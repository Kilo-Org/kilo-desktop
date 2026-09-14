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
		const userData = await mkdtemp(path.join(os.tmpdir(), "aad-e2e-theme-"));
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
			await expectElementToContainText(getLocatorByTestId("appearance-color-theme"), "Kilo", {
				message: "A fresh profile should use Kilo",
			});
			await click(getLocatorByTestId("appearance-theme-dark"));
			await click(getLocatorByTestId("appearance-color-theme"));
			await click(getLocatorByTestId("appearance-color-theme-anaconda"));
			await app.close();
			app = undefined;

			app = await launch();
			const relaunchedApp = app;
			setPage(await waitForMainWindow(relaunchedApp));
			await click(getLocatorByTestId("nav-settings"));
			await expectElementToContainText(getLocatorByTestId("appearance-color-theme"), "Anaconda", {
				message: "The theme picker should restore Anaconda after relaunch",
			});
			const window = await relaunchedApp.browserWindow(getPage());
			try {
				await expect
					.poll(() => window.evaluate((window) => window.getBackgroundColor().toLowerCase()), {
						message: "Native window should restore Anaconda, or retain macOS transparency",
					})
					.toBe(process.platform === "darwin" ? "#000000" : "#101314");
				await expect
					.poll(() => relaunchedApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource), {
						message: "Native menus and dialogs should restore the dark appearance",
					})
					.toBe("dark");
				await click(getLocatorByTestId("appearance-color-theme"));
				await click(getLocatorByTestId("appearance-color-theme-kilo"));
				await expect
					.poll(() => window.evaluate((window) => window.getBackgroundColor().toLowerCase()), {
						message: "Native window should switch to Kilo, or retain macOS transparency",
					})
					.toBe(process.platform === "darwin" ? "#000000" : "#111111");
			} finally {
				await window.dispose();
			}
		} finally {
			setPage(sharedPage);
			await app?.close();
		}
	}
}
