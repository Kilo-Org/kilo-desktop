import { test } from "../fixtures.js";

test.use({ appIsolationKey: "kilo-code" });

test.describe("Desktop agent tools @packaged", () => {
	test("serves the app's tools to Kilo from the main process @smoke", async ({
		agentToolsPage,
	}) => {
		await agentToolsPage.verifyKiloConnectedToDesktopTools();
		await agentToolsPage.verifyDesktopToolCallReachesTheApp();
	});
});
