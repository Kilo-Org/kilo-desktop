import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { SidebarKiloAccount } from "./SidebarKiloAccount.js";
import { KiloAuthContext, type KiloAuthContextValue } from "./KiloAuthContext.js";
import type { DeviceAuthState, KiloProfileData } from "./kilo-auth.js";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const profile: KiloProfileData = {
	profile: {
		email: "dev@anaconda.com",
		name: "Dev User",
		hasPersonalAccount: true,
	},
	balance: null,
	kiloPass: null,
	currentOrgId: null,
};

function idleAuth(overrides: Partial<KiloAuthContextValue> = {}): KiloAuthContextValue {
	return {
		isLoading: false,
		connectionUnavailable: false,
		authenticated: false,
		profile: null,
		deviceAuth: { status: "idle" },
		isRefreshing: false,
		isSwitchingOrg: false,
		profileError: null,
		orgError: null,
		login: vi.fn(),
		cancelLogin: vi.fn(),
		logout: vi.fn(),
		refreshProfile: vi.fn(),
		setOrganization: vi.fn(),
		dismissOrgError: vi.fn(),
		openExternal: vi.fn(),
		...overrides,
	};
}

function renderDock(auth: KiloAuthContextValue) {
	const navigate = vi.fn();
	const sdk = createFakeSdk({ featureId: "kilo-ui", navigation: { navigate } });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<SidebarProvider>
				<KiloAuthContext.Provider value={auth}>
					<SidebarKiloAccount />
				</KiloAuthContext.Provider>
			</SidebarProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), auth, navigate };
}

describe("SidebarKiloAccount", () => {
	it("starts device sign-in and opens the AI Providers page when signed out", async () => {
		const { screen, auth, navigate } = renderDock(idleAuth());

		await expect.element(screen.getByTestId("sidebar-kilo-login")).toBeVisible();
		await screen.getByTestId("sidebar-kilo-login").click();

		expect(auth.login).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/kilo-providers", undefined);
	});

	it("links to the AI Providers page while device auth is in flight", async () => {
		const deviceAuth: DeviceAuthState = {
			status: "waiting",
			code: "ABCD-1234",
			verificationUrl: "https://app.kilo.ai/device",
			expiresIn: 900,
		};
		const { screen, auth, navigate } = renderDock(idleAuth({ deviceAuth }));

		await expect.element(screen.getByTestId("sidebar-kilo-signing-in")).toBeVisible();
		await expect.element(screen.getByTestId("sidebar-kilo-login")).not.toBeInTheDocument();

		await screen.getByTestId("sidebar-kilo-signing-in").click();
		expect(auth.login).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith("/settings/kilo-providers", undefined);
	});

	it("renders an account-row skeleton while auth status is pending", async () => {
		const { screen } = renderDock(idleAuth({ isLoading: true, authenticated: null }));

		await expect.element(screen.getByTestId("sidebar-kilo-account-loading")).toBeVisible();
		await expect
			.element(screen.getByLabelText("Loading account"))
			.toHaveAttribute("aria-busy", "true");
		expect(screen.getByTestId("sidebar-kilo-login").query()).toBeNull();
	});

	it("renders nothing when the Kilo connection is unavailable", () => {
		const { screen } = renderDock(idleAuth({ connectionUnavailable: true }));

		expect(screen.getByTestId("sidebar-kilo-login").query()).toBeNull();
	});

	it("falls back to the Sign In button when device auth fails while signed out", async () => {
		const { screen, auth, navigate } = renderDock(
			idleAuth({
				deviceAuth: {
					status: "error",
					error: "kilo server POST http://127.0.0.1:4096/provider/kilo/oauth/callback -> 401",
				},
			}),
		);

		await expect.element(screen.getByTestId("sidebar-kilo-login")).toBeVisible();
		await expect.element(screen.getByTestId("sidebar-kilo-signing-in")).not.toBeInTheDocument();

		await screen.getByTestId("sidebar-kilo-login").click();
		expect(auth.login).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/kilo-providers", undefined);
	});

	it("keeps the signed-in menu when device auth fails for an authenticated user", async () => {
		const { screen } = renderDock(
			idleAuth({
				authenticated: true,
				profile,
				deviceAuth: { status: "error", error: "refresh failed" },
			}),
		);

		await expect.element(screen.getByTestId("sidebar-kilo-account")).toBeVisible();
		await expect.element(screen.getByTestId("sidebar-kilo-signing-in")).not.toBeInTheDocument();
	});

	it("renders an account-row skeleton when authenticated but the profile is still loading", async () => {
		const { screen } = renderDock(idleAuth({ authenticated: true, profile: null }));

		await expect.element(screen.getByTestId("sidebar-kilo-account-loading")).toBeVisible();
		expect(screen.getByTestId("sidebar-kilo-account").query()).toBeNull();
	});

	it("links to the AI Providers page when the profile fails to load", async () => {
		const { screen, navigate } = renderDock(
			idleAuth({
				authenticated: true,
				profile: null,
				profileError: "profile unavailable",
			}),
		);

		await expect.element(screen.getByTestId("sidebar-kilo-profile-error")).toBeVisible();
		await screen.getByTestId("sidebar-kilo-profile-error").click();
		expect(navigate).toHaveBeenCalledWith("/settings/kilo-providers", undefined);
	});

	it("opens the account menu with settings and sign out actions", async () => {
		const { screen, auth, navigate } = renderDock(
			idleAuth({
				authenticated: true,
				profile,
			}),
		);

		await expect.element(screen.getByTestId("sidebar-kilo-account")).toBeVisible();
		await screen.getByTestId("sidebar-kilo-account").click();

		const menu = page.getByRole("menu");
		await expect.element(menu.getByText("dev@anaconda.com")).toBeVisible();
		await screen.getByTestId("sidebar-kilo-settings").click();
		expect(navigate).toHaveBeenCalledWith("/settings", undefined);

		await screen.getByTestId("sidebar-kilo-account").click();

		await screen.getByTestId("sidebar-kilo-logout").click();
		expect(auth.logout).toHaveBeenCalledOnce();
	});
});
