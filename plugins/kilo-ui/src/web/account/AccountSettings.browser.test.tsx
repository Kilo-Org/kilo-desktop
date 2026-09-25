import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { toast } from "@kilo-desktop/ui/components/sonner";
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

/**
 * Controllable `sdk.auth` fake: seeds a session, keeps `peek()` in sync with
 * subscriber notifications, and records login/logout calls.
 */
function makeAuthDelegate(session: AuthSession) {
	let current = session;
	const subscribers = new Set<(next: AuthSession) => void>();
	const emit = () => {
		for (const fn of [...subscribers]) fn(current);
	};
	const login = vi.fn(async () => {
		current = { status: "authenticated", user: { email: "dev@anaconda.com" } };
		emit();
		return current;
	});
	const logout = vi.fn(async () => {
		current = { status: "anonymous" };
		emit();
		return current;
	});
	const delegate = {
		subscribe(fn: (next: AuthSession) => void) {
			subscribers.add(fn);
			fn(current);
			return () => {
				subscribers.delete(fn);
			};
		},
		peek: () => current,
		getSession: async () => current,
		refresh: async () => current,
		login,
		logout,
	};
	return { delegate, login, logout };
}

function renderPage(
	input: {
		auth?: Partial<KiloAuthContextValue>;
		session?: AuthSession;
		shellAuth?: Partial<SDK["auth"]>;
	} = {},
) {
	const auth = idleAuth(input.auth);
	const track = vi.fn(async () => {});
	const anaconda = makeAuthDelegate(input.session ?? { status: "anonymous" });
	const sdk: FakeSdk = createFakeSdk({
		featureId: "kilo-ui",
		auth: { ...anaconda.delegate, ...input.shellAuth },
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
	return { screen: page, auth, anaconda, track };
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

	it("shows the Anaconda account email and signs out via the shell auth delegate", async () => {
		const { screen, anaconda, track } = renderPage({
			session: { status: "authenticated", user: { email: "dev@anaconda.com", username: "dev" } },
		});

		await expect
			.element(screen.getByTestId("account-anaconda-email"))
			.toHaveTextContent("Signed in as dev@anaconda.com");
		await screen.getByTestId("account-anaconda-sign-out").click();
		await vi.waitFor(() => expect(anaconda.logout).toHaveBeenCalledTimes(1));
		expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "LOGGED_OUT" }));
	});

	it("starts Anaconda sign-in in the browser without a dialog", async () => {
		const { screen, anaconda } = renderPage();

		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Not signed in.");
		await screen.getByTestId("account-anaconda-sign-in").click();
		await vi.waitFor(() => expect(anaconda.login).toHaveBeenCalledTimes(1));
		expect(screen.getByTestId("anaconda-sign-in-dialog").query()).toBeNull();
	});

	it("shows an Anaconda session error reason", async () => {
		const { screen } = renderPage({
			session: { status: "error", reason: "Keyring is unavailable." },
		});

		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Keyring is unavailable.");
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

	it("loads the Kilo row independently of a slow Anaconda session resolve", async () => {
		const { screen } = renderPage({
			shellAuth: { getSession: () => new Promise<AuthSession>(() => {}) },
		});

		await expect
			.element(screen.getByTestId("account-kilo-status"))
			.toHaveTextContent("Not signed in.");
		await expect
			.element(screen.getByTestId("account-anaconda-row"))
			.toHaveAttribute("data-state", "loading");
	});

	it("recovers when the Anaconda session cannot be resolved", async () => {
		const { screen } = renderPage({
			shellAuth: { getSession: async () => Promise.reject(new Error("ipc down")) },
		});

		await expect
			.element(screen.getByTestId("account-anaconda-status"))
			.toHaveTextContent("Not signed in.");
	});

	it("surfaces a thrown Anaconda sign-in failure instead of an unhandled rejection", async () => {
		const { screen } = renderPage({
			shellAuth: { login: async () => Promise.reject(new Error("ipc down")) },
		});

		await screen.getByTestId("account-anaconda-sign-in").click();

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Could not sign in",
				expect.objectContaining({ description: "ipc down" }),
			);
		});
	});
});
