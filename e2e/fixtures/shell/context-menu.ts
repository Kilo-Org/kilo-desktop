import { ContextMenuPage } from "../../pages/shell/context-menu-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ contextMenuPage: ContextMenuPage }>({
	contextMenuPage: async ({ electronApp }, use) => {
		await use(new ContextMenuPage(electronApp));
	},
});

export const { expect } = test;
