import { test } from "../../../fixtures/features/agent.js";

test.describe("Desktop agent tools @packaged", () => {
	test("serves the plugins' tools to Kilo through kilo.agent's gateway @smoke", async ({
		appShellPage,
		agentToolsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await agentToolsPage.verifyKiloConnectedToDesktopTools();
		await agentToolsPage.verifyDesktopToolCallReachesTheApp();
	});
});
