import { KiloCodePage } from "../../pages/features/kilo-code/kilo-code-page.js";
import { test as workspacesTest } from "./workspaces.js";

export const test = workspacesTest.extend<{ kiloCodePage: KiloCodePage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloCodePage: async ({}, use) => {
		await use(new KiloCodePage());
	},
});
