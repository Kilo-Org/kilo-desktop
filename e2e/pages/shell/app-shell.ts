import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectPageToHaveTitle,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

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
