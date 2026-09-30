import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { kiloUiChatContract, type KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { kiloUiProvidersContract } from "../../contracts/providers/schemas.js";
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
const getApiKey = vi.hoisted(() =>
	vi.fn(async ({ providerID }: { providerID: string }) => ({
		key: providerID === "openai" ? "sk-openai-stored" : null,
	})),
);
const presentEnv = vi.hoisted(() => vi.fn(async ({ names }: { names: string[] }) => ({ names })));

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
	presentEnv.mockImplementation(async ({ names }: { names: string[] }) => ({ names }));
	getApiKey.mockImplementation(async ({ providerID }: { providerID: string }) => ({
		key: providerID === "openai" ? "sk-openai-stored" : null,
	}));
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

function mockLocalCatalog() {
	providerList.mockResolvedValue({
		data: {
			all: [
				{ id: "kilo", name: "Kilo Gateway", source: "custom" },
				{ id: "kilo-desktop-model-server", name: "Local", source: "config" },
			],
			connected: ["kilo", "kilo-desktop-model-server"],
			default: {},
		},
	});
	configGet.mockResolvedValue({
		data: {
			provider: {
				"kilo-desktop-model-server": {
					npm: "@ai-sdk/openai-compatible",
					name: "Anaconda Local",
				},
			},
		},
	});
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
	options: { localInference?: boolean } = {},
) {
	const navigate = vi.fn();
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		navigation: { navigate },
		channels: { ...kiloUiChatContract, ...kiloUiProvidersContract },
		handlers: {
			"chat.getConnection": async () => connection,
			"chat.prepareSession": async () => ({ directory: "/tmp", workspaceFolders: [] }),
			"providers.getApiKey": getApiKey,
			"providers.presentEnv": presentEnv,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	if (options.localInference) {
		system.getSdk("local-inference").plugins.expose("localInference", {
			prepareModel: async () => undefined,
			connect: async () => undefined,
		});
	}
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	let currentStatus = status;
	let currentAuth = auth;
	const mount = () => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<ChatConnectionProvider
					status={{
						isPending: currentStatus.isPending,
						isError: currentStatus.isError,
						error: currentStatus.isError ? new Error("offline") : null,
						connection: currentStatus.connection,
						connectionPromise: Promise.resolve(currentStatus.connection ?? connection),
					}}
				>
					<KiloAuthContext.Provider value={currentAuth}>
						<KiloProvidersSettings />
					</KiloAuthContext.Provider>
				</ChatConnectionProvider>
			</QueryClientProvider>
		</SdkProvider>
	);
	const view = render(mount());
	return {
		screen: page,
		sdk,
		queryClient,
		auth,
		navigate,
		rerenderAuth: (value: KiloAuthContextValue) => {
			currentAuth = value;
			view.rerender(mount());
		},
		rerenderStatus: (next: typeof status) => {
			currentStatus = next;
			view.rerender(mount());
		},
	};
}

async function clickDeleteProvider(screen: typeof page, providerId: string) {
	await screen.getByTestId(`kilo-providers-delete-${providerId}`).click();
}

describe("KiloProvidersSettings", () => {
	it("shows desktop-unavailable copy when the connection failed", async () => {
		const { screen } = renderPage({ isPending: false, isError: true });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-unavailable")).toBeVisible();
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
	});

	it("clears the provider error after a retry succeeds", async () => {
		providerList.mockRejectedValueOnce(new Error("catalog offline"));
		configGet.mockResolvedValue({ data: {} });
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-error")).toBeVisible();
		expect(screen.getByTestId("kilo-providers-error").element().textContent).toContain(
			"catalog offline",
		);
		await expect.element(screen.getByTestId("kilo-providers-popular")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-retry")).toBeVisible();
		mockCatalog();
		await screen.getByTestId("kilo-providers-retry").click();
		await vi.waitFor(() => expect(providerList).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});

	it("retries a catalog load that timed out while Kilo was still starting", async () => {
		mockConnectedCatalog();
		providerList.mockRejectedValueOnce(new DOMException("signal timed out", "TimeoutError"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await vi.waitFor(() => expect(providerList).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-row-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});

	it("shows the catalog error when the retried load also timed out", async () => {
		configGet.mockResolvedValue({ data: {} });
		providerList.mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-error")).toBeVisible();
		expect(screen.getByTestId("kilo-providers-error").element().textContent).toContain(
			"signal timed out",
		);
		expect(providerList).toHaveBeenCalledTimes(2);
	});

	it("does not keep a dropped-connection refetch as a catalog error", async () => {
		mockCatalog();
		const { screen, queryClient } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		providerList.mockRejectedValue(new Error("Failed to fetch (127.0.0.1:52515)"));
		await queryClient.invalidateQueries({ queryKey: ["kilo-ui", "providers.manage"] });
		await vi.waitFor(() => expect(providerList.mock.calls.length).toBeGreaterThan(1));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
	});

	it("does not keep a 503 during Kilo restart as a catalog error", async () => {
		mockCatalog();
		const { screen, queryClient } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		providerList.mockRejectedValue(
			new Error(
				"kilo server GET http://127.0.0.1:55341/provider?directory=%2Fruntime → 503 Service Unavailable: (empty response body)",
			),
		);
		await queryClient.invalidateQueries({ queryKey: ["kilo-ui", "providers.manage"] });
		await vi.waitFor(() => expect(providerList.mock.calls.length).toBeGreaterThan(1));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
	});

	it("keeps the provider catalog visible when the Kilo connection URL changes", async () => {
		mockCatalog();
		const { screen, rerenderStatus } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		providerList.mockImplementation(() => new Promise(() => undefined));
		rerenderStatus({
			isPending: false,
			isError: false,
			connection: { ...connection, baseUrl: "http://127.0.0.1:5096", version: "7.4.21" },
		});
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "ready");
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
		await expect.element(screen.getByText("Kilo account", { exact: true })).not.toBeInTheDocument();
		await expect.element(screen.getByText("Recommended", { exact: true })).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo"))
			.toHaveAttribute("data-state", "summary");
		await expect.element(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-popular")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-add-provider"))
			.toHaveTextContent("Add AI Provider");
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-dialog")).toBeVisible();
		await expect
			.element(
				screen
					.getByTestId("kilo-providers-add-dialog")
					.getByRole("heading", { name: "Add AI Provider" }),
			)
			.toBeVisible();
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
			.element(screen.getByRole("heading", { name: "Add custom AI provider" }))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Back" })).not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
	});

	it("links to the local model server when local inference is available", async () => {
		mockCatalog();
		const { screen, navigate } = renderPage(
			{ isPending: false, isError: false, connection },
			idleAuth(),
			{ localInference: true },
		);

		const link = screen.getByTestId("kilo-providers-local-model-server-link");
		await expect.element(link).toBeVisible();
		await expect.element(link).toHaveTextContent("Manage");
		await expect.element(screen.getByText("Run AI models locally on your device.")).toBeVisible();
		expect(
			screen
				.getByTestId("kilo-providers-row-kilo")
				.element()
				.compareDocumentPosition(link.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		await link.click();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});

	it("hides the local model server link when local inference is unavailable", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-local-model-server-link"))
			.not.toBeInTheDocument();
	});

	it("disables adding providers while the catalog is loading", async () => {
		const { screen } = renderPage({ isPending: true, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
	});

	it("shows the inventory once the catalog is ready while account data continues loading", async () => {
		let resolveCatalog!: (value: unknown) => void;
		providerList.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCatalog = resolve;
				}),
		);
		configGet.mockResolvedValue({ data: {} });
		const loadingAuth = idleAuth({ isLoading: true });
		const { screen, queryClient } = renderPage(
			{ isPending: false, isError: false, connection },
			loadingAuth,
		);

		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo"))
			.toHaveAttribute("data-state", "loading");
		await expect.element(screen.getByTestId("kilo-providers-loading-provider")).toBeVisible();

		resolveCatalog({
			data: {
				all: [
					{ id: "kilo", name: "Kilo Gateway", source: "custom" },
					{ id: "anthropic", name: "Anthropic", source: "api" },
				],
				connected: ["kilo", "anthropic"],
				default: {},
			},
		});

		await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
		await expect.element(screen.getByTestId("kilo-providers-loading")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-loading-provider"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-anthropic")).toBeVisible();
	});

	it("keeps the local model server link in place while the catalog loads", async () => {
		mockCatalog();
		const { screen, rerenderStatus } = renderPage({ isPending: true, isError: false }, idleAuth(), {
			localInference: true,
		});

		await expect.element(screen.getByTestId("kilo-providers-loading")).toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-loading-provider")).toBeVisible();
		const link = screen.getByTestId("kilo-providers-local-model-server-link");
		await expect.element(link).toBeVisible();
		const linkElement = link.element();

		rerenderStatus({ isPending: false, isError: false, connection });

		await expect
			.element(screen.getByTestId("kilo-providers-loading-provider"))
			.not.toBeInTheDocument();
		expect(screen.getByTestId("kilo-providers-local-model-server-link").element()).toBe(
			linkElement,
		);
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
		await expect.element(screen.getByText("Manage", { exact: true })).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-account-balance-value"))
			.toHaveTextContent("$1.00");
		await expect.element(screen.getByTestId("kilo-account-org")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-pass-bar")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
		const signOut = document.querySelector("[data-qa-id=kilo-account-logout]");
		expect(
			document.querySelector("[data-qa-id=kilo-provider-header-actions]")?.contains(signOut),
		).toBe(true);
		expect(document.querySelector("[data-qa-id=kilo-account-actions]")?.contains(signOut)).toBe(
			false,
		);
		await expect.element(screen.getByTestId("kilo-account-login")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-provider-toggle")).not.toBeInTheDocument();
	});

	it("connects a catalog provider with an API key", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByTestId("kilo-providers-connect-dialog")).toBeVisible();
		await expect.element(screen.getByRole("heading", { name: "Add Anthropic" })).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-connect"))
			.toHaveTextContent("Add AI Provider");
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

	it("labels an optimistic catalog connection as an API key while Kilo reloads", async () => {
		mockCatalog();
		providerList.mockResolvedValue({
			data: {
				all: [
					{ id: "kilo", name: "Kilo Gateway", source: "custom" },
					{ id: "anthropic", name: "Anthropic", source: "custom" },
				],
				connected: ["kilo"],
				default: {},
			},
		});
		let finishDispose: () => void = () => undefined;
		dispose.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishDispose = resolve;
				}),
		);
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		try {
			await screen.getByTestId("kilo-providers-add-provider").click();
			await screen.getByTestId("kilo-providers-add-anthropic").click();
			await screen.getByTestId("kilo-providers-api-key").fill("sk-ant");
			await screen.getByTestId("kilo-providers-connect").click();
			await vi.waitFor(() => expect(authSet).toHaveBeenCalled());

			await expect
				.element(screen.getByTestId("kilo-providers-row-anthropic").getByText("API key"))
				.toBeVisible();
		} finally {
			finishDispose();
		}
	});

	it("replaces the API key for a connected catalog provider", async () => {
		mockConnectedCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "summary");
		await screen.getByTestId("kilo-providers-toggle-openai").click();
		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "expanded");
		const editor = screen.getByTestId("kilo-providers-editor-openai");
		await expect.element(editor).toBeVisible();
		const input = editor.getByTestId("kilo-providers-edit-api-key");
		await expect.element(input).toHaveValue("sk-openai-stored");
		await expect.element(input).toHaveAttribute("type", "password");
		await screen.getByTestId("kilo-providers-edit-api-key-visibility").click();
		await expect.element(input).toHaveAttribute("type", "text");
		await expect.element(input).toHaveValue("sk-openai-stored");
		await input.fill("sk-new");
		await screen.getByTestId("kilo-providers-edit-save").click();

		await vi.waitFor(() =>
			expect(authSet).toHaveBeenCalledWith(
				{ providerID: "openai", auth: { type: "api", key: "sk-new" } },
				{ throwOnError: true },
			),
		);
		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "summary");
		await expect
			.element(screen.getByTestId("kilo-providers-editor-openai"))
			.not.toBeInTheDocument();
	});

	it("keeps an API key save error inside the expanded provider editor", async () => {
		mockConnectedCatalog();
		authSet.mockRejectedValueOnce(new Error("credential store unavailable"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await screen.getByTestId("kilo-providers-row-trigger-openai").click();
		const editor = screen.getByTestId("kilo-providers-editor-openai");
		await expect.element(editor.getByTestId("kilo-providers-edit-api-key")).toBeVisible();
		await editor.getByTestId("kilo-providers-edit-api-key").fill("sk-new");
		await editor.getByTestId("kilo-providers-edit-save").click();

		await expect.element(editor.getByText("credential store unavailable")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "expanded");
	});

	it("does not surface an earlier provider's editor error after another provider fails", async () => {
		mockCustomCatalog();
		providerList.mockResolvedValue({
			data: {
				all: [
					{ id: "kilo", name: "Kilo Gateway", source: "custom" },
					{ id: "openai", name: "OpenAI", source: "api" },
					{ id: "vllm", name: "Local vLLM", source: "custom" },
				],
				connected: ["kilo", "openai", "vllm"],
				default: {},
			},
		});
		authSet.mockRejectedValueOnce(new Error("credential store unavailable"));
		configUpdate.mockRejectedValueOnce(new Error("config write failed"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await screen.getByTestId("kilo-providers-toggle-openai").click();
		const apiEditor = screen.getByTestId("kilo-providers-editor-openai");
		await apiEditor.getByTestId("kilo-providers-edit-api-key").fill("sk-bad");
		await apiEditor.getByTestId("kilo-providers-edit-save").click();
		await expect.element(apiEditor.getByText("credential store unavailable")).toBeVisible();

		await screen.getByTestId("kilo-providers-toggle-vllm").click();
		const customEditor = screen.getByTestId("kilo-providers-editor-vllm");
		await customEditor.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:9000/v1");
		await customEditor.getByTestId("kilo-providers-custom-save").click();

		await expect.element(customEditor.getByText("config write failed")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});

	it("shows a loading placeholder in the API key editor while the stored key loads", async () => {
		mockConnectedCatalog();
		getApiKey.mockImplementation(() => new Promise(() => undefined));
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await screen.getByTestId("kilo-providers-toggle-openai").click();

		await expect.element(screen.getByTestId("kilo-providers-edit-api-key-loading")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-edit-save")).toBeDisabled();
	});

	it("edits a custom provider inline and collapses after saving", async () => {
		mockCustomCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await screen.getByTestId("kilo-providers-toggle-vllm").click();
		const editor = screen.getByTestId("kilo-providers-editor-vllm");
		await expect
			.element(editor.getByTestId("kilo-providers-custom-name"))
			.toHaveValue("Local vLLM");
		await expect
			.element(editor.getByTestId("kilo-providers-custom-url"))
			.toHaveValue("http://127.0.0.1:8000/v1");
		await expect
			.element(editor.getByTestId("kilo-providers-model-row-0"))
			.toHaveTextContent("qwen");
		await editor.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:9000/v1");
		await editor.getByTestId("kilo-providers-custom-save").click();

		await vi.waitFor(() => expect(configUpdate).toHaveBeenCalled());
		const payload = configUpdate.mock.calls[0]?.[0] as {
			config: { provider: Record<string, { options: { baseURL: string } }> };
		};
		expect(payload.config.provider.vllm?.options.baseURL).toBe("http://127.0.0.1:9000/v1");
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm"))
			.toHaveAttribute("data-state", "summary");
	});

	it("discards unsaved custom provider edits on cancel", async () => {
		mockCustomCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });

		await screen.getByTestId("kilo-providers-toggle-vllm").click();
		const editor = screen.getByTestId("kilo-providers-editor-vllm");
		await editor.getByTestId("kilo-providers-custom-name").fill("Renamed");
		await editor.getByRole("button", { name: "Cancel" }).click();
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm"))
			.toHaveAttribute("data-state", "summary");

		await screen.getByTestId("kilo-providers-toggle-vllm").click();
		await expect
			.element(
				screen.getByTestId("kilo-providers-editor-vllm").getByTestId("kilo-providers-custom-name"),
			)
			.toHaveValue("Local vLLM");
		expect(configUpdate).not.toHaveBeenCalled();
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
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm").getByText("Custom"))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Delete Local vLLM" })).toBeVisible();
		await clickDeleteProvider(screen, "vllm");
		await expect.element(screen.getByTestId("kilo-providers-remove-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-remove-confirm"))
			.toHaveTextContent("Delete AI provider");
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
					{
						id: "amazon-bedrock",
						name: "Amazon Bedrock",
						source: "env",
						env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
					},
					{ id: "anthropic", name: "Anthropic", source: "api" },
				],
				connected: ["kilo", "amazon-bedrock", "anthropic"],
				default: {},
			},
		});
		configGet.mockResolvedValue({ data: {} });
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-amazon-bedrock")).toBeVisible();
		await expect
			.element(
				screen.getByTestId("kilo-providers-row-amazon-bedrock").getByText("Environment Variables"),
			)
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-row-anthropic").getByText("API key"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-delete-amazon-bedrock"))
			.not.toBeInTheDocument();
		await expect
			.element(
				screen
					.getByTestId("kilo-providers-inventory")
					.getByTestId("kilo-providers-row-amazon-bedrock"),
			)
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-row-amazon-bedrock"))
			.toHaveAttribute("data-state", "summary");
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-env-dialog")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-providers-toggle-amazon-bedrock").click();
		await expect
			.element(screen.getByTestId("kilo-providers-row-amazon-bedrock"))
			.toHaveAttribute("data-state", "expanded");
		await expect
			.element(screen.getByTestId("kilo-providers-env-details-amazon-bedrock"))
			.toBeVisible();
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).toBeVisible();
		await expect.element(screen.getByText("AWS_SECRET_ACCESS_KEY")).toBeVisible();
		await expect.element(screen.getByText("AWS_REGION")).toBeVisible();
		await screen.getByTestId("kilo-providers-row-trigger-amazon-bedrock").click();
		await expect
			.element(screen.getByTestId("kilo-providers-row-amazon-bedrock"))
			.toHaveAttribute("data-state", "summary");
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).not.toBeInTheDocument();
	});

	it("does not treat autoloaded Amazon Bedrock as a stored API key", async () => {
		providerList.mockResolvedValue({
			data: {
				all: [
					{ id: "kilo", name: "Kilo Gateway", source: "custom" },
					{
						id: "amazon-bedrock",
						name: "Amazon Bedrock",
						source: "custom",
						env: [
							"AWS_ACCESS_KEY_ID",
							"AWS_SECRET_ACCESS_KEY",
							"AWS_REGION",
							"AWS_BEARER_TOKEN_BEDROCK",
						],
					},
				],
				connected: ["kilo", "amazon-bedrock"],
				default: {},
			},
		});
		configGet.mockResolvedValue({ data: {} });
		presentEnv.mockResolvedValue({
			names: ["AWS_PROFILE", "AWS_SSO_START_URL"],
		});
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-amazon-bedrock")).toBeVisible();
		await expect
			.element(
				screen.getByTestId("kilo-providers-row-amazon-bedrock").getByText("System credentials"),
			)
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-delete-amazon-bedrock"))
			.not.toBeInTheDocument();
		await screen.getByTestId("kilo-providers-toggle-amazon-bedrock").click();
		await expect
			.element(
				screen.getByText(
					"Amazon Bedrock is connected using credentials already available on this machine, not a stored API key.",
				),
			)
			.toBeVisible();
		await expect.element(screen.getByText("AWS_PROFILE")).toBeVisible();
		await expect.element(screen.getByText("AWS_SSO_START_URL")).toBeVisible();
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).not.toBeInTheDocument();
		await expect.element(screen.getByText("AWS_SECRET_ACCESS_KEY")).not.toBeInTheDocument();
		await expect.element(screen.getByText("AWS_BEARER_TOKEN_BEDROCK")).not.toBeInTheDocument();
	});

	it("does not list the local model server under Connected", async () => {
		mockLocalCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo-desktop-model-server"))
			.not.toBeInTheDocument();
	});

	it("disables provider actions while a mutation is pending", async () => {
		mockConnectedCatalog();
		authRemove.mockImplementation(() => new Promise(() => undefined));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await clickDeleteProvider(screen, "openai");
		await expect.element(screen.getByTestId("kilo-providers-delete-anthropic")).toBeDisabled();
	});

	it("shows the delete button for added providers without hovering the row", async () => {
		mockConnectedCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-openai")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Delete OpenAI" })).toBeVisible();
	});

	it("clears an earlier mutation error when a later provider action succeeds", async () => {
		mockConnectedCatalog();
		authRemove.mockRejectedValueOnce(new Error("credential store unavailable"));
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await clickDeleteProvider(screen, "openai");
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("credential store unavailable");

		await clickDeleteProvider(screen, "anthropic");
		await vi.waitFor(() => expect(authRemove).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});
});
