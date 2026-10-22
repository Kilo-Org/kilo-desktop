import { ThemePage } from "../../pages/features/theme/theme-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ themePage: ThemePage }>({
	appIsolationKey: "theme",

	themePage: async ({ electronApp }, use) => {
		await use(new ThemePage(electronApp));
	},
});

export const { expect } = test;
