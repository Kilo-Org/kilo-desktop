import { test } from "../../../fixtures/features/agent.js";

test.describe("Kilo server @packaged", () => {
	test("starts the packaged CLI after the window and lists it in Diagnostics @smoke", async ({
		appShellPage,
		agentServerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await agentServerPage.openDiagnostics();
		await agentServerPage.verifyServerReadyInDiagnostics();
	});

	test("serves authenticated health and event-stream requests", async ({ agentServerPage }) => {
		await agentServerPage.verifyAuthenticatedServerTransport();
	});
});
