import { test } from "../../fixtures/kernel.js";

test.describe("Kernel boot @smoke @packaged", () => {
	test("starts the bundled plugins over an isolated kernel bridge, without its own screen", async ({
		recoveryPage,
	}) => {
		await recoveryPage.verifyNotShown();
		await recoveryPage.verifyIsolatedKernelBridge();
	});

	test("starts with no plugins in safe mode and offers a normal restart", async ({
		safeModeApp: _safeModeApp,
		recoveryPage,
	}) => {
		await recoveryPage.verifyRunningInSafeMode();
		await recoveryPage.verifyIsolatedKernelBridge();
	});
});
