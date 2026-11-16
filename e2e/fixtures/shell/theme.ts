import { ThemePage } from "../../pages/shell/theme-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ themePage: ThemePage }>({
	appIsolationKey: "theme",

	themePage: async ({ electronApp }, use) => {
		await use(new ThemePage(electronApp));
	},
});

export const { expect } = test;
