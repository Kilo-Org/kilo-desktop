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
		await expectPageToHaveTitle(/Anaconda Agentic Desktop/, {
			message: "App shell should set the Anaconda Agentic Desktop page title",
		});
	}

	async navigateToFeature(featureId: string): Promise<void> {
		await click(this.navItem(featureId));
	}

	async openSettings(): Promise<void> {
		await click(getLocatorByTestId("nav-settings"));
	}

	async verifyCustomProtocolBoot(): Promise<void> {
		// Use the utils page singleton (not barrel getURL/waitForFunction) — those named
		// exports resolve as non-functions under Playwright's CJS interop on CI.
		// Shell `/` redirects to the kilo-ui chat page (plugins cannot own `/`).
		await getPage().waitForURL("anaconda-agentic-desktop://app/#/plugins/chat");

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

	async verifyColorSchemeApplied(): Promise<void> {
		await this.verifyShellIsLoaded();
		await getPage().waitForFunction(() => {
			const scheme = document.documentElement.style.colorScheme;
			return scheme === "light" || scheme === "dark";
		});
	}

	async verifyAppearanceSettings(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("settings-back"),
			"Settings should take over the siderail with a back-to-app control",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("settings-page"),
			"Settings page should be visible",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("appearance-settings"),
			"Appearance should be the first settings section",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("appearance-theme"),
			"Appearance should offer a theme picker",
		);
	}

	async openAboutSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-section-about"));
	}

	async verifyAboutSettings(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("about-settings"),
			"About settings should be visible in the packaged desktop app",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("update-status-message"),
			"About settings should report why updates are unavailable without a configured feed",
		);
	}

	async leaveSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-back"));
	}
}
