import { test } from "../fixtures.js";

test.use({ appIsolationKey: "kilo-code" });

test.describe("Kilo Code @packaged", () => {
	test("starts the packaged CLI and exposes authenticated health and SSE @smoke", async ({
		kiloCodePage,
		workspaceFolder,
	}) => {
		await kiloCodePage.createWorkspace(workspaceFolder.path, workspaceFolder.name);
		await kiloCodePage.verifyAuthenticatedServerTransport();
		await kiloCodePage.verifyWorkspaceFirstSend(workspaceFolder.name, workspaceFolder.path);
	});

	test("creates unique persistent sessions on unscoped first sends", async ({ kiloCodePage }) => {
		await kiloCodePage.verifyUnscopedFirstSends();
	});
});
