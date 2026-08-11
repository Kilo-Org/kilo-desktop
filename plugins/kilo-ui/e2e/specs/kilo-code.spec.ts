import { test } from "../fixtures.js";

test.describe("Kilo Code @smoke", () => {
	test("starts the packaged CLI and exposes authenticated health and SSE", async ({
		kiloCodePage,
		workspaceFolder,
	}) => {
		await kiloCodePage.verifyNotebookSidecar();
		await kiloCodePage.createWorkspace(workspaceFolder.path, workspaceFolder.name);
		await kiloCodePage.verifyAuthenticatedServerTransport();
		await kiloCodePage.verifyWorkspaceFirstSend(workspaceFolder.name, workspaceFolder.path);
	});

	test("creates unique persistent sessions on unscoped first sends", async ({ kiloCodePage }) => {
		await kiloCodePage.verifyUnscopedFirstSends();
	});
});
