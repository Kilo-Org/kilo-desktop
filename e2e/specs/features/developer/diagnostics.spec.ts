import { test } from "../../../fixtures/features/developer.js";

test.describe("Diagnostics @smoke", () => {
	test("lists the kernel, the running plugins and the services under Developer", async ({
		appShellPage,
		diagnosticsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await diagnosticsPage.open();
		await diagnosticsPage.verifyKernelShown();
		await diagnosticsPage.verifyPluginActive("kilo.shell");
		await diagnosticsPage.verifyPluginActive("kilo.developer");
		await diagnosticsPage.openServices();
	});
});
