import {
	click,
	expectElementToBeVisible,
	expectPageToHaveTitle,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

export class AppShellPage {
	private readonly sidebar = () => getLocatorByTestId("app-sidebar");
	private readonly navItem = (id: string) => getLocatorByTestId(`nav-${id}`);

	async verifyShellIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.sidebar(), "App shell sidebar should be visible on boot");
		await expectPageToHaveTitle(/Todo List · Anaconda Desktop/, {
			message: "App shell should set the Anaconda Desktop page title",
		});
	}

	async navigateToFeature(featureId: string): Promise<void> {
		await click(this.navItem(featureId));
	}

	async verifyCustomProtocolBoot(): Promise<void> {
		// Use the utils page singleton (not barrel getURL/waitForFunction) — those named
		// exports resolve as non-functions under Playwright's CJS interop on CI.
		const href = getPage().url();
		if (href !== "anaconda-agentic-desktop://app/#/") {
			throw new Error(`Expected custom-protocol home URL, got "${href}"`);
		}

		const hasDesktopInvoke = await getPage().evaluate(
			() => typeof (globalThis as { desktopApi?: { invoke?: unknown } }).desktopApi?.invoke,
		);
		if (hasDesktopInvoke !== "function") {
			throw new Error("Expected window.desktopApi.invoke to be a function (preload bridge)");
		}

		const hasRequire = await getPage().evaluate(() => "require" in globalThis);
		if (hasRequire) {
			throw new Error("Expected renderer globalThis.require to be absent (contextIsolation)");
		}
	}

	async verifyThemeSyncApplied(): Promise<void> {
		await this.verifyShellIsLoaded();
		await getPage().waitForFunction(() => {
			const scheme = document.documentElement.style.colorScheme;
			return scheme === "light" || scheme === "dark";
		});
	}
}
