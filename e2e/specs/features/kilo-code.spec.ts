import { test } from "../../fixtures/features/kilo-code.js";

test.describe("Kilo Code @smoke", () => {
	test("starts the packaged CLI and exposes authenticated health and SSE", async ({
		kiloCodePage,
		workspaceFolder,
	}) => {
		await kiloCodePage.createWorkspace(workspaceFolder.path, workspaceFolder.name);
		await kiloCodePage.verifyAuthenticatedServerTransport(workspaceFolder.name);
	});
});
