import { test } from "../../fixtures/kernel.js";

test.describe("Kernel boot @smoke @packaged", () => {
	test("starts with no plugins in safe mode and offers a normal restart", async ({
		safeModeApp: _safeModeApp,
		recoveryPage,
	}) => {
		await recoveryPage.verifyRunningInSafeMode();
		await recoveryPage.verifyIsolatedKernelBridge();
	});
});
