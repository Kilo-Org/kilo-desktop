import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectPageToHaveTitle,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

/** kilo.core reads the account through the Kilo server, whose cold start on CI can take over a minute. */
const SIDEBAR_ACCOUNT_TIMEOUT_MS = 120_000;

export class AppShellPage {
	private readonly sidebar = () => getLocatorByTestId("app-sidebar");

	async verifyShellIsLoaded(): Promise<void> {
		await expectElementToBeVisible(this.sidebar(), "App shell sidebar should be visible on boot");
		await expectPageToHaveTitle(/^Kilo/, {
			message: "App shell should set the Kilo page title",
		});
	}

	/** Packaged e2e sets KILO_SKIP_ONBOARDING unless a spec opts in, so onboarding never covers a fresh profile. */
	async verifyOnboardingHidden(): Promise<void> {
		await expectElementToBeHidden(getLocatorByTestId("onboarding-overlay"), {
			message: "First-run onboarding should not cover the shell in packaged e2e profiles",
		});
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

	/**
	 * On a page with nothing in the top bar (the New Session page), the bar
	 * collapses while the sidebar is docked and carries the traffic lights,
	 * and takes its full height back to clear the toggle once the sidebar
	 * collapses. Collapsed, it keeps the window-controls overlay's height
	 * (`env(titlebar-area-height)`, about 47px on Windows), so it is checked
	 * by its `data-collapsed` state rather than a height.
	 */
	async verifyEmptyTopBarShrinksWhileDocked(): Promise<void> {
		const topBar = getLocatorByTestId("shell-top-bar");
		await expect(
			topBar,
			"The empty top bar should collapse while the sidebar is docked",
		).toHaveAttribute("data-collapsed");
		await click(getLocatorByTestId("sidebar-nav-toggle"));
		await expectElementToHaveAttribute(
			getLocatorByTestId("sidebar-nav-toggle"),
			"aria-pressed",
			"false",
			{
				message: "The sidebar should collapse",
			},
		);
		await expect(
			topBar,
			"The top bar should open to clear the toggle while the sidebar is collapsed",
		).not.toHaveAttribute("data-collapsed");
		await expect
			.poll(async () => (await topBar.boundingBox())?.height ?? 0, {
				message: "The top bar should clear the toggle while the sidebar is collapsed",
			})
			.toBeGreaterThanOrEqual(40);
		await click(getLocatorByTestId("sidebar-nav-toggle"));
	}

	/** The account entry at the foot of the sidebar, once kilo.core has read the account. */
	async verifySidebarAccountSignedIn(): Promise<void> {
		await expectElementToBeVisible(getLocatorByTestId("sidebar-kilo-account"), {
			message: "The sidebar should show the signed-in Kilo account",
			timeout: SIDEBAR_ACCOUNT_TIMEOUT_MS,
		});
	}

	async leaveSettings(): Promise<void> {
		await click(getLocatorByTestId("settings-back"));
	}
}
