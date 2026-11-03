import {
	expectElementToBeVisible,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

/** The kernel's own screen, shown in safe mode or when no plugin provides the interface. */
export class RecoveryPage {
	private readonly screen = () => getLocatorByTestId("kernel-recovery");
	private readonly restart = () => getLocatorByTestId("kernel-recovery-restart");
	private readonly quit = () => getLocatorByTestId("kernel-recovery-quit");
	private readonly status = () => getLocatorByTestId("kernel-recovery-status");
	private readonly safeMode = () => getLocatorByText("Kilo Desktop is running in safe mode");

	/** Started with --safe-mode: no plugins, the kernel's own screen, and a way back. */
	async verifyRunningInSafeMode(): Promise<void> {
		await expectElementToBeVisible(this.screen(), "The kernel's own screen should be visible");
		await expectElementToBeVisible(this.safeMode(), "The kernel should report safe mode");
		await expectElementToBeVisible(this.status(), "The kernel should summarise what started");
		await expectElementToBeVisible(this.restart(), "Safe mode should offer a normal restart");
		await expectElementToBeVisible(this.quit(), "The screen should offer to quit");
	}

	/** The renderer loads over the custom protocol and reaches main only through the kernel bridge. */
	async verifyIsolatedKernelBridge(): Promise<void> {
		const renderer = await getPage().evaluate(() => ({
			windowId: (globalThis as { kernelBridge?: { window?: { id?: unknown } } }).kernelBridge
				?.window?.id,
			hasRequire: typeof (globalThis as { require?: unknown }).require === "function",
			protocol: globalThis.location.protocol,
		}));
		if (renderer.windowId !== "main") {
			throw new Error("Expected the main window to identify itself through window.kernelBridge");
		}
		if (renderer.hasRequire) {
			throw new Error("The renderer must not have Node's require");
		}
		if (renderer.protocol !== "kilo-desktop:") {
			throw new Error(`Expected the kilo-desktop: protocol, got ${renderer.protocol}`);
		}
	}
}
