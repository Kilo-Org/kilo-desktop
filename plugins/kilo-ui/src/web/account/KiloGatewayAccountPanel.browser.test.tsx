import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { kiloUiChatContract } from "../../contracts/chat/schemas.js";
import { KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel.js";
import { KiloAuthContext, type KiloAuthContextValue } from "./KiloAuthContext.js";
import type { DeviceAuthState, KiloProfileData } from "./kilo-auth.js";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const signedInProfile: KiloProfileData = {
	profile: {
		email: "dev@anaconda.com",
		name: "Dev User",
		organizations: [{ id: "org-1", name: "Anaconda", role: "admin" }],
		hasPersonalAccount: true,
	},
	balance: { balance: 42.5 },
	kiloPass: {
		currentPeriodBaseCreditsUsd: 100,
		currentPeriodUsageUsd: 25,
		currentPeriodBonusCreditsUsd: 5,
		nextBillingAt: null,
	},
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

function renderSettings(auth: KiloAuthContextValue) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: kiloUiChatContract,
		handlers: {
			"chat.getConnection": async () => {
				throw new Error("unused");
			},
			"chat.prepareSession": async () => ({ directory: "/tmp", workspaceFolders: [] }),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<KiloAuthContext.Provider value={auth}>
				<KiloGatewayAccountPanel />
			</KiloAuthContext.Provider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), auth };
}

describe("KiloGatewayAccountPanel", () => {
	it("shows desktop-unavailable copy when the connection is unavailable", async () => {
		const { screen } = renderSettings(idleAuth({ connectionUnavailable: true }));
		await expect.element(screen.getByTestId("kilo-account-settings")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-unavailable")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
	});

	it("shows the sign-in button when signed out", async () => {
		const { screen, auth } = renderSettings(idleAuth());
		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
		await screen.getByTestId("kilo-account-login").click();
		expect(auth.login).toHaveBeenCalledOnce();
	});

	it("shows device-auth waiting UI with the enterable code", async () => {
		const deviceAuth: DeviceAuthState = {
			status: "waiting",
			code: "ABCD-1234",
			verificationUrl: "https://app.kilo.ai/device",
			expiresIn: 900,
		};
		const { screen } = renderSettings(idleAuth({ deviceAuth }));
		await expect.element(screen.getByTestId("kilo-account-device-auth")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-device-code")).toBeVisible();
		await expect.element(screen.getByText("ABCD-1234")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
	});

	it("shows a sign-in error with retry when device auth fails while signed out", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				deviceAuth: {
					status: "error",
					error: "kilo server POST http://127.0.0.1:4096/provider/kilo/oauth/callback -> 401",
				},
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-device-auth")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-device-error")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-account-retry").click();
		expect(auth.login).toHaveBeenCalledOnce();
	});

	it("renders signed-in profile, org, balance, and pass", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: signedInProfile,
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-org")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-account-balance-value"))
			.toHaveTextContent("$42.50");
		await expect.element(screen.getByTestId("kilo-account-pass-bar")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-dashboard")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Sign Out" })).toBeVisible();

		const actions = document.querySelector("[data-qa-id=kilo-account-actions]");
		for (const qa of ["kilo-account-top-up", "kilo-account-dashboard", "kilo-account-logout"]) {
			expect(actions?.contains(document.querySelector(`[data-qa-id=${qa}]`))).toBe(true);
		}

		await screen.getByTestId("kilo-account-dashboard").click();
		expect(auth.openExternal).toHaveBeenCalledWith("https://app.kilo.ai/profile");

		await screen.getByTestId("kilo-account-logout").click();
		expect(auth.logout).toHaveBeenCalledOnce();
	});

	it("shows a profile-load error with retry instead of the signed-out hero", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: null,
				profileError: "profile unavailable",
			}),
		);
		await expect
			.element(screen.getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "profile-error");
		await expect.element(screen.getByTestId("kilo-account-profile-error")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-signed-out")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-account-logout")).toBeVisible();

		await screen.getByTestId("kilo-account-profile-retry").click();
		expect(auth.refreshProfile).toHaveBeenCalledOnce();
		expect(auth.login).not.toHaveBeenCalled();
	});

	it("keeps the signed-in view when org switch fails and retries the org, not login", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: signedInProfile,
				orgError: { message: "cannot switch", organizationId: "org-2" },
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-org")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-org-error")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-device-auth")).not.toBeInTheDocument();

		await screen.getByTestId("kilo-account-org-retry").click();
		expect(auth.setOrganization).toHaveBeenCalledWith("org-2");
		expect(auth.login).not.toHaveBeenCalled();

		await screen.getByTestId("kilo-account-org-dismiss").click();
		expect(auth.dismissOrgError).toHaveBeenCalledOnce();
	});

	it("offers Get Kilo Pass when the personal account has no pass", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: { ...signedInProfile, kiloPass: null },
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-get-pass")).toBeVisible();
		await screen.getByTestId("kilo-account-get-pass").click();
		expect(auth.openExternal).toHaveBeenCalledWith("https://kilo.ai/pricing/kilo-pass");
	});

	it("keeps top up, dashboard, and sign out on one row", async () => {
		const { screen } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: { ...signedInProfile, kiloPass: null },
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-balance")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-refresh")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-actions")).toBeVisible();

		const actions = document.querySelector("[data-qa-id=kilo-account-actions]");
		const topUp = document.querySelector("[data-qa-id=kilo-account-top-up]");
		const dashboard = document.querySelector("[data-qa-id=kilo-account-dashboard]");
		const logout = document.querySelector("[data-qa-id=kilo-account-logout]");
		expect(actions?.contains(topUp)).toBe(true);
		expect(actions?.contains(dashboard)).toBe(true);
		expect(actions?.contains(logout)).toBe(true);
		const row = topUp?.getBoundingClientRect().top;
		expect(dashboard?.getBoundingClientRect().top).toBe(row);
		expect(logout?.getBoundingClientRect().top).toBe(row);
	});
});
