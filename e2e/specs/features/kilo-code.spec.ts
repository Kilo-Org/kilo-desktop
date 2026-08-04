import { test } from "../../fixtures/features/kilo-code.js";

test.describe("Kilo Code @smoke", () => {
	test("starts the packaged CLI and exposes authenticated health and SSE", async ({
		kiloCodePage,
		workspacesPage,
		workspaceFolder,
	}) => {
		await workspacesPage.createWorkspaceFromFolder(workspaceFolder.name);
		await kiloCodePage.verifyAuthenticatedServerTransport();
	});
});
