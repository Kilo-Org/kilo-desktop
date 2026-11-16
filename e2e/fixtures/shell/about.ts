import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { reloadPage } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { AboutPage } from "../../pages/shell/about-page.js";
import { aboutData } from "../../testdata/about.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ aboutPage: AboutPage; globalKiloConfigPath: string }>({
	// A fresh profile keeps the Kilo config row deterministic: specs sharing the default worker
	// may run Kilo flows that create the global config file this page reports on.
	appIsolationKey: "about",

	aboutPage: async ({ electronApp }, use) => {
		const aboutPage = new AboutPage(electronApp);
		await aboutPage.stubFileManager();
		try {
			await use(aboutPage);
		} finally {
			await aboutPage.restoreFileManager();
		}
	},

	// The renderer caches the config lookup and nothing watches the file, so
	// both setup and teardown reload to keep neighbouring tests deterministic.
	globalKiloConfigPath: async ({ electronApp }, use) => {
		const xdgConfigHome = await electronApp.evaluate(() => process.env.XDG_CONFIG_HOME);
		if (!xdgConfigHome) throw new Error("Packaged app should launch with XDG_CONFIG_HOME set");
		const configPath = path.join(xdgConfigHome, "kilo", aboutData.kiloConfigFileName);
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(configPath, aboutData.kiloConfigFileContents);
		await reloadAtHome();
		try {
			await use(configPath);
		} finally {
			// Windows may briefly hold the file open (Defender, the Kilo CLI reading config).
			await rm(configPath, { force: true, maxRetries: 8, retryDelay: 200 });
			await reloadAtHome();
		}
	},
});

async function reloadAtHome(): Promise<void> {
	await getPage().evaluate(() => {
		globalThis.location.hash = "#/";
	});
	await reloadPage();
}
