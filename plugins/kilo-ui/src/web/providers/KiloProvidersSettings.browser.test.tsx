import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { kiloUiChatContract, type KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../account/KiloAuthContext.js";
import { ChatConnectionProvider } from "../chat/connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import { KiloProvidersSettings } from "./KiloProvidersSettings.js";

const providerList = vi.hoisted(() => vi.fn());
const configGet = vi.hoisted(() => vi.fn());
const configUpdate = vi.hoisted(() => vi.fn());
const dispose = vi.hoisted(() => vi.fn());
const authSet = vi.hoisted(() => vi.fn());
const authRemove = vi.hoisted(() => vi.fn());

vi.mock("../chat/runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		provider: { list: providerList },
		global: {
			dispose,
			config: { get: configGet, update: configUpdate },
		},
		auth: { set: authSet, remove: authRemove },
	})),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function mockCatalog() {
	providerList.mockResolvedValue({
		data: {
			all: [
				{ id: "kilo", name: "Kilo Gateway", source: "custom" },
				{ id: "anthropic", name: "Anthropic", source: "api" },
				{ id: "openai", name: "OpenAI", source: "api" },
			],
			connected: ["kilo"],
			default: {},
		},
	});
	configGet.mockResolvedValue({ data: {} });
	configUpdate.mockResolvedValue({ data: {} });
	dispose.mockResolvedValue(undefined);
	authSet.mockResolvedValue({ data: true });
	authRemove.mockResolvedValue({ data: true });
}

function mockCustomCatalog() {
	providerList.mockResolvedValue({
		data: {
			all: [
				{ id: "kilo", name: "Kilo Gateway", source: "custom" },
				{ id: "vllm", name: "Local vLLM", source: "custom" },
			],
			connected: ["kilo", "vllm"],
			default: {},
		},
	});
	configGet.mockResolvedValue({
		data: {
			provider: {
				vllm: {
					npm: "@ai-sdk/openai-compatible",
					name: "Local vLLM",
					options: { baseURL: "http://127.0.0.1:8000/v1" },
					models: { qwen: { name: "Qwen" } },
				},
			},
		},
	});
	configUpdate.mockResolvedValue({ data: {} });
	dispose.mockResolvedValue(undefined);
	authRemove.mockResolvedValue({ data: true });
}

function mockConnectedCatalog() {
	providerList.mockResolvedValue({
		data: {
			all: [
				{ id: "kilo", name: "Kilo Gateway", source: "custom" },
				{ id: "anthropic", name: "Anthropic", source: "api" },
				{ id: "openai", name: "OpenAI", source: "api" },
			],
			connected: ["kilo", "anthropic", "openai"],
			default: {},
		},
	});
	configGet.mockResolvedValue({ data: {} });
	configUpdate.mockResolvedValue({ data: {} });
	dispose.mockResolvedValue(undefined);
}

function mockAllPopularProvidersConnected() {
	providerList.mockResolvedValue({
		data: {
			all: [{ id: "kilo", name: "Kilo Gateway", source: "custom" }],
			connected: ["kilo", "anthropic", "deepseek", "openai", "google", "openrouter", "vercel"],
			default: {},
		},
	});
	configGet.mockResolvedValue({ data: {} });
	configUpdate.mockResolvedValue({ data: {} });
	dispose.mockResolvedValue(undefined);
}

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

function renderPage(
	status: {
		isPending: boolean;
		isError: boolean;
		connection?: KiloGlobalConnection;
	},
	auth: KiloAuthContextValue = idleAuth(),
) {
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
	const mount = (value: KiloAuthContextValue) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<ChatConnectionProvider
					status={{
						isPending: status.isPending,
						isError: status.isError,
						error: status.isError ? new Error("offline") : null,
						connection: status.connection,
						connectionPromise: Promise.resolve(connection),
					}}
				>
					<KiloAuthContext.Provider value={value}>
						<KiloProvidersSettings />
					</KiloAuthContext.Provider>
				</ChatConnectionProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
	render(mount(auth));
	return {
		screen: page,
		sdk,
		queryClient,
		auth,
	};
}

describe("KiloProvidersSettings", () => {
	it("shows desktop-unavailable copy when the connection failed", async () => {
		const { screen } = renderPage({ isPending: false, isError: true });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-unavailable")).toBeVisible();
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
	});

	it("shows a retry state instead of an empty success state when providers fail to load", async () => {
		providerList.mockRejectedValue(new Error("catalog offline"));
		configGet.mockResolvedValue({ data: {} });
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("catalog offline");
		await expect.element(screen.getByTestId("kilo-providers-popular")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-retry")).toBeVisible();
		await screen.getByTestId("kilo-providers-retry").click();
		await vi.waitFor(() => expect(providerList).toHaveBeenCalledTimes(2));
	});

	it("keeps one dialog shell mounted across provider setup steps", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-dialog")).toBeVisible();
		const dialog = document.querySelector('[data-slot="dialog-content"]');
		expect(dialog).not.toBeNull();
		const dialogWidth = dialog!.getBoundingClientRect().width;

		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByTestId("kilo-providers-connect-dialog")).toBeVisible();
		expect(document.querySelector('[data-slot="dialog-content"]')).toBe(dialog);
		expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);

		await screen.getByRole("button", { name: "Back" }).click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
		expect(document.querySelector('[data-slot="dialog-content"]')).toBe(dialog);
		expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
		expect(dialog!.getBoundingClientRect().width).toBe(dialogWidth);
		expect(
			dialog!.getAnimations().filter((animation) => {
				const effect = animation.effect;
				return effect instanceof KeyframeEffect && effect.target === dialog;
			}),
		).toHaveLength(0);
	});

	it("presents Kilo Gateway as the primary connection and lists provider choices", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect.element(screen.getByText("Recommended", { exact: true })).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo"))
			.toHaveAttribute("data-state", "summary");
		await expect.element(screen.getByRole("button", { name: "Sign In" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-popular")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.toHaveTextContent("1 of 2");
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-custom")).toBeVisible();
	});

	it("opens custom provider configuration directly when every popular provider is added", async () => {
		mockAllPopularProvidersConnected();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
		await expect
			.element(screen.getByRole("heading", { name: "Add custom provider" }))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Back" })).not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
	});

	it("disables adding providers while the catalog is loading", async () => {
		const { screen } = renderPage({ isPending: true, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
	});

	it("shows the connected Kilo account details inside the gateway card", async () => {
		mockCatalog();
		const { screen } = renderPage(
			{ isPending: false, isError: false, connection },
			idleAuth({
				authenticated: true,
				profile: {
					profile: {
						email: "dev@anaconda.com",
						name: "Dev User",
						organizations: [{ id: "org-1", name: "Anaconda", role: "admin" }],
						hasPersonalAccount: true,
					},
					balance: { balance: 1 },
					kiloPass: {
						currentPeriodBaseCreditsUsd: 100,
						currentPeriodUsageUsd: 25,
						currentPeriodBonusCreditsUsd: 0,
						nextBillingAt: null,
					},
					currentOrgId: null,
				},
			}),
		);
		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo"))
			.toHaveAttribute("data-state", "expanded");
		await expect
			.element(screen.getByTestId("kilo-account-email"))
			.toHaveTextContent("dev@anaconda.com");
		await expect.element(screen.getByText("Connected", { exact: true })).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-account-balance-value"))
			.toHaveTextContent("$1.00");
		await expect.element(screen.getByTestId("kilo-account-org")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-pass-bar")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Log Out" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
	});

	it("connects a catalog provider with an API key", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByTestId("kilo-providers-connect-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.toHaveTextContent("2 of 2");
		await screen.getByTestId("kilo-providers-api-key").fill("sk-ant");
		await screen.getByTestId("kilo-providers-connect").click();
		await vi.waitFor(() => expect(authSet).toHaveBeenCalled());
		expect(authSet).toHaveBeenCalledWith(
			{ providerID: "anthropic", auth: { type: "api", key: "sk-ant" } },
			{ throwOnError: true },
		);
		expect(dispose).toHaveBeenCalled();
		expect(providerList.mock.calls.length).toBeGreaterThan(1);
	});

	it("saves a custom provider after validation", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
		await screen.getByTestId("kilo-providers-custom-name").fill("Local vLLM");
		await screen.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:8000/v1");
		await screen.getByTestId("kilo-providers-model-id-input").fill("qwen");
		await screen.getByTestId("kilo-providers-custom-save").click();
		await vi.waitFor(() => expect(configUpdate).toHaveBeenCalled());
		const payload = configUpdate.mock.calls[0]?.[0] as {
			config: {
				provider: Record<string, { options: { baseURL: string }; models: Record<string, unknown> }>;
			};
		};
		expect(payload.config.provider["local-vllm"]?.options.baseURL).toBe("http://127.0.0.1:8000/v1");
		expect(payload.config.provider["local-vllm"]?.models).toEqual({ qwen: { name: "qwen" } });
		expect(JSON.stringify(payload)).not.toContain("apiKey");
		expect(dispose).toHaveBeenCalled();
	});

	it("generates a unique provider id when the provider name is already in use", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await screen.getByTestId("kilo-providers-custom-name").fill("Anthropic");
		await screen.getByTestId("kilo-providers-custom-url").fill("https://example.com/v1");
		await screen.getByTestId("kilo-providers-model-id-input").fill("model");
		await screen.getByTestId("kilo-providers-custom-save").click();
		await vi.waitFor(() => expect(configUpdate).toHaveBeenCalled());
		const payload = configUpdate.mock.calls[0]?.[0] as {
			config: { provider: Record<string, unknown> };
		};
		expect(payload.config.provider["anthropic-2"]).toBeDefined();
		expect(payload.config.provider.anthropic).toBeUndefined();
	});

	it("rejects a half-filled custom header row", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await screen.getByTestId("kilo-providers-custom-name").fill("Local vLLM");
		await screen.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:8000/v1");
		await screen.getByTestId("kilo-providers-model-id-input").fill("qwen");
		await screen.getByTestId("kilo-providers-custom-advanced").click();
		await screen.getByTestId("kilo-providers-header-key-input").fill("Authorization");
		await screen.getByTestId("kilo-providers-custom-save").click();
		await expect.element(screen.getByText("Header name and value are both required")).toBeVisible();
		expect(configUpdate).not.toHaveBeenCalled();
	});

	it("rejects a duplicated model id from the add row", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await screen.getByTestId("kilo-providers-model-id-input").fill("duplicate");
		await screen.getByTestId("kilo-providers-add-model").click();
		await expect.element(screen.getByTestId("kilo-providers-model-row-0")).toBeVisible();
		await screen.getByTestId("kilo-providers-model-id-input").fill("duplicate");
		await screen.getByTestId("kilo-providers-add-model").click();
		await expect
			.element(screen.getByTestId("kilo-providers-model-id-input"))
			.toHaveAttribute("aria-invalid", "true");
		await expect.element(screen.getByText('Model ID "duplicate" is already added')).toBeVisible();
	});

	it("confirms before removing a custom provider definition", async () => {
		mockCustomCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-remove-vllm")).toBeVisible();
		await screen.getByTestId("kilo-providers-remove-vllm").click();
		await expect.element(screen.getByTestId("kilo-providers-remove-dialog")).toBeVisible();
		expect(authRemove).not.toHaveBeenCalled();

		await screen.getByTestId("kilo-providers-remove-confirm").click();
		await vi.waitFor(() =>
			expect(authRemove).toHaveBeenCalledWith({ providerID: "vllm" }, { throwOnError: true }),
		);
		expect(configUpdate).toHaveBeenCalled();
	});

	it("includes environment-sourced credentials in the unified provider list", async () => {
		providerList.mockResolvedValue({
			data: {
				all: [
					{ id: "kilo", name: "Kilo Gateway", source: "custom" },
					{ id: "amazon-bedrock", name: "Amazon Bedrock", source: "env" },
					{ id: "anthropic", name: "Anthropic", source: "api" },
				],
				connected: ["kilo", "amazon-bedrock", "anthropic"],
				default: {},
			},
		});
		configGet.mockResolvedValue({ data: {} });
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect
			.element(screen.getByRole("heading", { name: "Connected providers" }))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-row-amazon-bedrock")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-disconnect-amazon-bedrock"))
			.not.toBeInTheDocument();
		await expect
			.element(
				screen
					.getByTestId("kilo-providers-connected")
					.getByTestId("kilo-providers-row-amazon-bedrock"),
			)
			.toBeVisible();
	});

	it("disables provider actions while a mutation is pending", async () => {
		mockConnectedCatalog();
		authRemove.mockImplementation(() => new Promise(() => undefined));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-disconnect-openai")).toBeVisible();
		await screen.getByTestId("kilo-providers-disconnect-openai").click();
		await expect.element(screen.getByTestId("kilo-providers-disconnect-anthropic")).toBeDisabled();
	});

	it("clears an earlier mutation error when a later provider action succeeds", async () => {
		mockConnectedCatalog();
		authRemove.mockRejectedValueOnce(new Error("credential store unavailable"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-disconnect-openai").click();
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("credential store unavailable");

		await screen.getByTestId("kilo-providers-disconnect-anthropic").click();
		await vi.waitFor(() => expect(authRemove).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});
});
