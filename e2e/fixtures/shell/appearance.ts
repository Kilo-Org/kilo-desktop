import { AppearancePage } from "../../pages/shell/appearance-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ appearancePage: AppearancePage }>({
	// Own profile: text size persists in renderer storage and is applied to the whole window.
	appIsolationKey: "appearance",
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	appearancePage: async ({}, use) => {
		await use(new AppearancePage());
	},
});
