import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectPageToHaveTitle,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

export class AppShellPage {
	private readonly sidebar = () => getLocatorByTestId("app-sidebar");
	private readonly navItem = (id: string) => getLocatorByTestId(`nav-${id}`);

	async verifyShellIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.sidebar(), "App shell sidebar should be visible on boot");
		await expectPageToHaveTitle(/^Kilo/, {
			message: "App shell should set the Kilo page title",
		});
	}

	/** Packaged e2e sets KILO_SKIP_ONBOARDING, so first-run onboarding never covers a fresh profile. */
	async verifyOnboardingHidden(): Promise<void> {
		await expectElementToBeHidden(getLocatorByTestId("onboarding-overlay"), {
			message: "First-run onboarding should not cover the shell in packaged e2e profiles",
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
		await getPage().waitForURL(/^kilo-desktop:\/\/app\/#\/$/);

		const hasKernelBridge = await getPage().evaluate(
			() => typeof (globalThis as { kernelBridge?: { request?: unknown } }).kernelBridge?.request,
		);
		if (hasKernelBridge !== "function") {
			throw new Error("Expected window.kernelBridge.request to be a function (preload bridge)");
		}

		const hasRequire = await getPage().evaluate(() => "require" in globalThis);
		if (hasRequire) {
			throw new Error("Expected renderer globalThis.require to be absent (contextIsolation)");
		}
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
		await click(getLocatorByTestId("settings-section-appearance"));
		await expectElementToBeVisible(
			getLocatorByTestId("appearance-settings"),
			"Appearance settings should open from the settings siderail",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("appearance-theme"),
			"Appearance should offer a theme picker",
		);
	}

	async openAboutSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-section-about"));
	}

	async openAccountSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-section-account"));
	}

	async verifyAccountSettings(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("account-page"),
			"Account settings should be visible in the packaged desktop app",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("account-kilo-row"),
			"Account settings should show the Kilo account row",
		);
		await expectElementToBeVisible(
			getLocatorByTestId("account-anaconda-row"),
			"Account settings should show the Anaconda account row",
		);
	}

	/** The top bar is part of the layout: the same height with the sidebar docked or collapsed. */
	async verifyTopBarKeepsItsHeight(): Promise<void> {
		const header = getLocatorByTestId("shell-page-header");
		const docked = await header.boundingBox();
		await click(getLocatorByTestId("sidebar-nav-toggle"));
		await expectElementToHaveAttribute(
			getLocatorByTestId("sidebar-nav-toggle"),
			"aria-pressed",
			"false",
			{
				message: "The sidebar should collapse",
			},
		);
		const collapsed = await header.boundingBox();
		await click(getLocatorByTestId("sidebar-nav-toggle"));
		if (
			!docked ||
			!collapsed ||
			docked.height < 40 ||
			Math.abs(docked.height - collapsed.height) > 1
		) {
			throw new Error(
				`Expected a full-height top bar in both states, got docked ${docked?.height}px and collapsed ${collapsed?.height}px`,
			);
		}
	}

	async leaveSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-back"));
	}
}
