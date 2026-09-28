import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk, type FakeSdk } from "@kilo-desktop/testing";

import { KiloAuthContext, type KiloAuthContextValue } from "./KiloAuthContext.js";
import type { KiloProfileData } from "./kilo-auth.js";
import { AccountSettings } from "./AccountSettings.js";

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	Toaster: () => null,
	toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function idleAuth(overrides: Partial<KiloAuthContextValue> = {}): KiloAuthContextValue {
	return {
		isLoading: false,
		connectionUnavailable: false,
		authenticated: false,
		profile: null,
		profileError: null,
		deviceAuth: { status: "idle" },
		orgError: null,
		isRefreshing: false,
		isSwitchingOrg: false,
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

const signedInProfile: KiloProfileData = {
	profile: { email: "dev@kilo.ai" },
	balance: { balance: 12.5 },
	kiloPass: null,
	currentOrgId: null,
};

function renderPage(
	input: {
		auth?: Partial<KiloAuthContextValue>;
	} = {},
) {
	const auth = idleAuth(input.auth);
	const track = vi.fn(async () => {});
	const sdk: FakeSdk = createFakeSdk({
		featureId: "kilo-ui",
		telemetry: { track },
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<KiloAuthContext.Provider value={auth}>
					<AccountSettings />
				</KiloAuthContext.Provider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page, auth, track };
}

describe("AccountSettings", () => {
	it("shows the signed-in Kilo account email", async () => {
		const { screen } = renderPage({
			auth: { authenticated: true, profile: signedInProfile },
		});

		await expect
			.element(screen.getByTestId("account-kilo-email"))
			.toHaveTextContent("Signed in as dev@kilo.ai");
	});

	it("shows Kilo as signed out and offers sign-in", async () => {
		const { screen, auth } = renderPage();

		await expect
			.element(screen.getByTestId("account-kilo-status"))
			.toHaveTextContent("Not signed in.");
		await screen.getByTestId("account-kilo-sign-in").click();
		expect(auth.login).toHaveBeenCalledTimes(1);
	});

	it("signs out of Kilo from the account page", async () => {
		const { screen, auth } = renderPage({
			auth: { authenticated: true, profile: signedInProfile },
		});

		await screen.getByTestId("account-kilo-sign-out").click();
		expect(auth.logout).toHaveBeenCalledTimes(1);
	});

	it("shows the Kilo account details inline without a toggle", async () => {
		const { screen } = renderPage({
			auth: { authenticated: true, profile: signedInProfile },
		});

		await expect.element(screen.getByTestId("kilo-account-balance")).toBeVisible();
		expect(screen.getByTestId("account-kilo-toggle").query()).toBeNull();
		expect(screen.getByTestId("account-kilo-details-trigger").query()).toBeNull();
	});

	it("shows the Kilo unavailable state when the gateway connection is missing", async () => {
		const { screen } = renderPage({ auth: { connectionUnavailable: true } });

		await expect
			.element(screen.getByTestId("account-kilo-status"))
			.toHaveTextContent("Available in the desktop app.");
	});

	it("shows the Kilo connecting state during device auth", async () => {
		const { screen } = renderPage({
			auth: { deviceAuth: { status: "waiting", code: "KILO-1234" } },
		});

		await expect
			.element(screen.getByTestId("account-kilo-status"))
			.toHaveTextContent("Finish connecting your Kilo account.");
	});

	it("offers Kilo sign-out when the profile fails to load", async () => {
		const { screen, auth } = renderPage({
			auth: { authenticated: true, profile: null, profileError: "Gateway unreachable" },
		});

		const signOut = screen.getByTestId("account-kilo-sign-out");
		await expect.element(signOut).toBeVisible();
		await signOut.click();
		expect(auth.logout).toHaveBeenCalledTimes(1);
	});

	it("reserves the Kilo account details while a signed-in profile is loading", async () => {
		const { screen } = renderPage({
			auth: { isLoading: true, authenticated: true, profile: null },
		});

		await expect
			.element(screen.getByTestId("account-kilo-row"))
			.toHaveAttribute("data-state", "loading");
		await expect
			.element(screen.getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "loading");
	});

	it("does not reserve Kilo account details before the auth status is known", async () => {
		const { screen } = renderPage({
			auth: { isLoading: true, authenticated: null, profile: null },
		});

		await expect
			.element(screen.getByTestId("account-kilo-row"))
			.toHaveAttribute("data-state", "loading");
		expect(screen.getByTestId("kilo-account-settings").query()).toBeNull();
	});
});
