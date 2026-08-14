import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { kiloUiChatContract, type KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { ChatConnectionProvider } from "../chat/connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import { KiloAccountSettings } from "./KiloAccountSettings.js";
import { KiloAuthProvider } from "./KiloAuthProvider.js";
import type { KiloProfileData } from "./kilo-auth.js";

const authRemove = vi.hoisted(() => vi.fn());
const dispose = vi.hoisted(() => vi.fn());
const authStatus = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => vi.fn());
const organizationSet = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
const oauthCallback = vi.hoisted(() => vi.fn());
const latestClient = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("../chat/runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => {
		latestClient.current = {
			kilo: {
				authStatus,
				profile,
				organization: { set: organizationSet },
			},
			auth: { remove: authRemove },
			global: { dispose },
			provider: {
				oauth: { authorize, callback: oauthCallback },
				list: vi.fn(),
			},
			app: { agents: vi.fn() },
		};
		return latestClient.current;
	}),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

const signedInProfile: KiloProfileData = {
	profile: {
		email: "mchilvers@anaconda.com",
		name: "mchilvers",
		organizations: [{ id: "org-1", name: "Anaconda", role: "admin" }],
		hasPersonalAccount: true,
	},
	balance: { balance: 897.61 },
	kiloPass: null,
	currentOrgId: "org-1",
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderAccount({
	authenticated = true,
	profileOk = true,
}: { authenticated?: boolean; profileOk?: boolean } = {}) {
	authStatus.mockResolvedValue({
		data: authenticated ? { authenticated: true, type: "oauth" } : { authenticated: false },
	});
	if (profileOk) {
		profile.mockResolvedValue({ data: signedInProfile });
	} else {
		profile.mockRejectedValue(new Error("profile unavailable"));
	}
	dispose.mockResolvedValue(undefined);
	organizationSet.mockResolvedValue({ data: true });

	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: kiloUiChatContract,
		handlers: {
			"chat.getConnection": async () => connection,
			"chat.prepareSession": async () => ({ directory: "/tmp", workspaceFolders: [] }),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<ChatConnectionProvider
					status={{
						isPending: false,
						isError: false,
						error: null,
						connection,
						connectionPromise: Promise.resolve(connection),
					}}
				>
					<KiloAuthProvider>
						<KiloAccountSettings />
					</KiloAuthProvider>
				</ChatConnectionProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement) };
}

describe("KiloAuthProvider login", () => {
	it("holds the finishing state until the profile loads — no success interstitial", async () => {
		const { screen } = renderAccount({ authenticated: false });

		authorize.mockResolvedValue({
			data: {
				instructions: "Go to https://kilo.ai/device and enter code: ABCD-1234",
				url: "https://kilo.ai/device",
			},
		});
		let resolveCallback!: (value: { data: unknown }) => void;
		oauthCallback.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCallback = resolve;
				}),
		);
		let resolveProfile!: (value: { data: KiloProfileData }) => void;
		profile.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveProfile = resolve;
				}),
		);

		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
		await screen.getByTestId("kilo-account-login").click();

		const panel = screen.getByTestId("kilo-account-device-auth");
		await expect.element(panel).toHaveAttribute("data-state", "waiting");
		await expect
			.element(screen.getByTestId("kilo-account-device-code"))
			.toHaveTextContent("ABCD-1234");

		// The in-flight login closure captured the client from before approval;
		// flip auth on that same instance so its refetches see the credentials.
		const loginClient = latestClient.current as {
			kilo: { authStatus: ReturnType<typeof vi.fn> };
		} | null;
		loginClient?.kilo.authStatus.mockImplementation(async () => ({
			data: { authenticated: true, type: "oauth" },
		}));
		resolveCallback({ data: true });

		// While the profile is still in flight the panel shows the finishing
		// spinner — never a "Signed in to Kilo" success card.
		await expect.element(panel).toHaveAttribute("data-state", "finishing");
		await expect.element(page.getByText("Finishing sign-in…")).toBeVisible();
		expect(page.getByText("Signed in to Kilo").elements()).toHaveLength(0);
		await expect.element(screen.getByTestId("kilo-account-name")).not.toBeInTheDocument();

		resolveProfile({ data: signedInProfile });

		await expect.element(screen.getByTestId("kilo-account-name")).toHaveTextContent("mchilvers");
		await expect.element(panel).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "signed-in");
	});
});

describe("KiloAuthProvider logout", () => {
	it("returns to the signed-out view even when auth.remove fails with 401", async () => {
		authRemove.mockRejectedValue(
			new Error(
				"kilo server DELETE http://127.0.0.1:4096/auth/kilo -> 401 Unauthorized: (empty response body)",
			),
		);
		const { screen } = renderAccount();

		await expect.element(screen.getByTestId("kilo-account-logout")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-name")).toHaveTextContent("mchilvers");

		await screen.getByTestId("kilo-account-logout").click();

		await expect.element(screen.getByTestId("kilo-account-signed-out")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-device-auth")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-account-logout")).not.toBeInTheDocument();
		expect(authRemove).toHaveBeenCalledWith({ providerID: "kilo" });
		expect(dispose).toHaveBeenCalledOnce();
		expect(createKiloDirectoryClient).toHaveBeenCalledWith(connection, connection.globalDirectory);
	});

	it("returns to the signed-out view after a successful logout", async () => {
		authRemove.mockResolvedValue({ data: true });
		const { screen } = renderAccount();

		await expect.element(screen.getByTestId("kilo-account-logout")).toBeVisible();
		await screen.getByTestId("kilo-account-logout").click();

		await expect.element(screen.getByTestId("kilo-account-signed-out")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
	});
});

describe("KiloAuthProvider profile errors", () => {
	it("shows a retryable profile error instead of the signed-out hero", async () => {
		const { screen } = renderAccount({ profileOk: false });

		await expect.element(screen.getByTestId("kilo-account-profile-error")).toBeVisible();
		await expect.element(screen.getByText("profile unavailable")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-signed-out")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-account-device-auth")).not.toBeInTheDocument();

		profile.mockResolvedValue({ data: signedInProfile });
		await screen.getByTestId("kilo-account-profile-retry").click();

		await expect.element(screen.getByTestId("kilo-account-name")).toHaveTextContent("mchilvers");
		await expect.element(screen.getByTestId("kilo-account-profile-error")).not.toBeInTheDocument();
	});
});

describe("KiloAuthProvider org switch", () => {
	it("keeps the signed-in view and does not open the login error panel", async () => {
		const { screen } = renderAccount();

		await expect.element(screen.getByTestId("kilo-account-name")).toBeVisible();
		organizationSet.mockRejectedValue(new Error("cannot switch"));
		await screen.getByTestId("kilo-account-org").click();
		const personal = page.getByRole("option", { name: "Personal" });
		await expect.element(personal).toBeVisible();
		await personal.click();

		await expect.element(screen.getByTestId("kilo-account-org-error")).toBeVisible();
		await expect.element(screen.getByText("cannot switch")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-name")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-device-auth")).not.toBeInTheDocument();
		expect(authorize).not.toHaveBeenCalled();

		organizationSet.mockResolvedValue({ data: true });
		await screen.getByTestId("kilo-account-org-retry").click();
		expect(organizationSet).toHaveBeenLastCalledWith(
			{ organizationId: null, directory: connection.globalDirectory },
			{ throwOnError: true },
		);
	});
});
