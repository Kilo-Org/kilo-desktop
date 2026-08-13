import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { kiloUiChatContract } from "../../contracts/chat/schemas.js";
import { KiloAccountSettings } from "./KiloAccountSettings.js";
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
		login: vi.fn(),
		cancelLogin: vi.fn(),
		logout: vi.fn(),
		refreshProfile: vi.fn(),
		setOrganization: vi.fn(),
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
				<KiloAccountSettings />
			</KiloAuthContext.Provider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), auth };
}

describe("KiloAccountSettings", () => {
	it("shows desktop-unavailable copy when the connection is unavailable", async () => {
		const { screen } = renderSettings(idleAuth({ connectionUnavailable: true }));
		await expect.element(screen.getByTestId("kilo-account-settings")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-unavailable")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
	});

	it("shows the login button when signed out", async () => {
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

	it("renders signed-in profile, org, balance, and pass", async () => {
		const { screen, auth } = renderSettings(
			idleAuth({
				authenticated: true,
				profile: signedInProfile,
			}),
		);
		await expect.element(screen.getByTestId("kilo-account-name")).toHaveTextContent("Dev User");
		await expect
			.element(screen.getByTestId("kilo-account-email"))
			.toHaveTextContent("dev@anaconda.com");
		await expect.element(screen.getByTestId("kilo-account-org")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-account-balance-value"))
			.toHaveTextContent("$42.50");
		await expect.element(screen.getByTestId("kilo-account-pass-bar")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-logout")).toBeVisible();

		await screen.getByTestId("kilo-account-logout").click();
		expect(auth.logout).toHaveBeenCalledOnce();
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
});
