import { test } from "../../fixtures/developer.js";

test.describe("Diagnostics @smoke", () => {
	test("lists the kernel, the running plugins and the developer flag under Developer", async ({
		appShellPage,
		diagnosticsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await diagnosticsPage.open();
		await diagnosticsPage.verifyKernelShown();
		await diagnosticsPage.verifyPluginActive("kilo.core");
		await diagnosticsPage.verifyPluginActive("kilo.shell");
		await diagnosticsPage.verifyPluginActive("kilo.developer");
		await diagnosticsPage.openFlags();
		await diagnosticsPage.verifyFlagOrigin("developer", "override");
		await diagnosticsPage.openServices();
		await diagnosticsPage.verifyServiceListed("kilo.core/server");
	});
});
