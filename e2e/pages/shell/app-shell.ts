import {
	click,
	expectElementToBeVisible,
	getLocatorByTestId,
	getPage,
	getURL,
	waitForFunction,
} from "@anaconda/playwright-utils";

export class AppShellPage {
	private readonly sidebar = () => getLocatorByTestId("app-sidebar");
	private readonly navItem = (id: string) => getLocatorByTestId(`nav-${id}`);

	async verifyShellIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.sidebar(), "App shell sidebar should be visible on boot");
	}

	async navigateToFeature(featureId: string): Promise<void> {
		await click(this.navItem(featureId));
	}

	async verifyCustomProtocolBoot(): Promise<void> {
		const href = await getURL();
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
		await waitForFunction(() => {
			const scheme = document.documentElement.style.colorScheme;
			return scheme === "light" || scheme === "dark";
		});
	}
}
