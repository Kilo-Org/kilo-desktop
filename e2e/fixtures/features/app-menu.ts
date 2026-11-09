import { AppMenuPage } from "../../pages/shell/app-menu-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ appMenuPage: AppMenuPage }>({
	appMenuPage: async ({ electronApp }, use) => {
		await use(new AppMenuPage(electronApp));
	},
});

export const { expect } = test;
