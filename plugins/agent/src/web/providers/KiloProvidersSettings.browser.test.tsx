import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, type DomainProvider, type PluginEntry } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import {
	AGENT_DEFINITIONS,
	AgentConfig,
	AgentServer,
	ProviderPanel,
	type ServerConnection,
	type ServerStatus,
} from "../../contracts";
import { agentWebEntry } from "../index";
import { agentQueryClient } from "./AiProvidersPage";
import { createKiloDirectoryClient } from "./kilo-client";

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

vi.mock("./kilo-client", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		provider: { list: providerList },
		global: {
			dispose,
			config: { get: configGet, update: configUpdate },
		},
		auth: { set: authSet, remove: authRemove },
	})),
}));

const connection: ServerConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

afterEach(() => {
	agentQueryClient.clear();
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

/** Stands in for kilo.agent's main entry: a server and config the test controls. */
function fakeAgentMain(initial: { status: ServerStatus; connection?: ServerConnection }) {
	let server: DomainProvider<typeof AgentServer> | undefined;
	let current = initial.connection ?? connection;
	const entry: PluginEntry = {
		activate(sdk) {
			server = sdk.domains.provide(AgentServer, {
				initialState: initial.status,
				methods: {
					connect: () => {
						if (server?.state.status !== "ready") {
							throw new KernelError("UNAVAILABLE", "offline");
						}
						return current;
					},
					restart: () => {},
					disposeInstance: () => {},
				},
			});
			sdk.domains.provide(AgentConfig, {
				initialState: {},
				methods: {
					userConfigFile: () => ({ path: "/home/.config/kilo/kilo.jsonc", exists: false }),
					storedApiKey: ({ providerId }) => getApiKey({ providerID: providerId }),
					presentEnv: ({ names }) => presentEnv({ names }),
				},
			});
		},
	};
	return {
		entry,
		/** The server restarted, possibly at a new address. */
		reconnect(next: ServerConnection) {
			current = next;
			server?.setState({ status: "starting" });
			server?.setState({ status: "ready", version: next.version });
		},
	};
}

/** Kilo Gateway's row, as kilo.account contributes it. */
const gatewayPanel: GuestPlugin = {
	manifest: testManifest("acme.gateway", {
		contributes: {
			extensions: { "kilo.agent/provider-panel": [{ id: "kilo", providerId: "kilo" }] },
		},
	}),
	web: {
		activate: (sdk) => {
			sdk.extensions.implement(ProviderPanel, "kilo", () => (
				<div data-qa-id="kilo-providers-row-kilo">Kilo Gateway</div>
			));
		},
	},
};

async function renderPage(status: { isPending: boolean; isError: boolean }) {
	const agent = fakeAgentMain({
		status: status.isError
			? { status: "error", message: "offline" }
			: status.isPending
				? { status: "starting" }
				: { status: "ready", version: connection.version },
	});
	await renderShell(
		[
			{ manifest, definitions: AGENT_DEFINITIONS, main: agent.entry, web: agentWebEntry },
			gatewayPanel,
		],
		{ desktop: true },
	);
	window.location.hash = "#/settings/kilo-providers";
	return { screen: page, agent };
}

async function clickDeleteProvider(screen: typeof page, providerId: string) {
	await screen.getByTestId(`kilo-providers-delete-${providerId}`).click();
}

describe("KiloProvidersSettings", () => {
	it("shows desktop-unavailable copy when the connection failed", async () => {
		const { screen } = await renderPage({ isPending: false, isError: true });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-unavailable")).toBeVisible();
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
	});

	it("clears the provider error after a retry succeeds", async () => {
		providerList.mockRejectedValueOnce(new Error("catalog offline"));
		configGet.mockResolvedValue({ data: {} });
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
		await vi.waitFor(() => expect(providerList).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-row-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});

	it("shows the catalog error when the retried load also timed out", async () => {
		configGet.mockResolvedValue({ data: {} });
		providerList.mockRejectedValue(new DOMException("signal timed out", "TimeoutError"));
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-error")).toBeVisible();
		expect(screen.getByTestId("kilo-providers-error").element().textContent).toContain(
			"signal timed out",
		);
		expect(providerList).toHaveBeenCalledTimes(2);
	});

	it("does not keep a dropped-connection refetch as a catalog error", async () => {
		mockCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "ready");
		providerList.mockRejectedValue(new Error("Failed to fetch (127.0.0.1:52515)"));
		await agentQueryClient.invalidateQueries({ queryKey: ["kilo.agent", "providers.manage"] });
		await vi.waitFor(() => expect(providerList.mock.calls.length).toBeGreaterThan(1));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
	});

	it("does not keep a 503 during Kilo restart as a catalog error", async () => {
		mockCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "ready");
		providerList.mockRejectedValue(
			new Error(
				"kilo server GET http://127.0.0.1:55341/provider?directory=%2Fruntime → 503 Service Unavailable: (empty response body)",
			),
		);
		await agentQueryClient.invalidateQueries({ queryKey: ["kilo.agent", "providers.manage"] });
		await vi.waitFor(() => expect(providerList.mock.calls.length).toBeGreaterThan(1));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
	});

	it("keeps the provider catalog visible when the Kilo connection URL changes", async () => {
		mockCatalog();
		const { screen, agent } = await renderPage({ isPending: false, isError: false });
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "ready");
		providerList.mockImplementation(() => new Promise(() => undefined));
		agent.reconnect({ ...connection, baseUrl: "http://127.0.0.1:5096", version: "7.4.21" });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "ready");
	});

	it("keeps one dialog shell mounted across provider setup steps", async () => {
		mockCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect.element(screen.getByText("Kilo account", { exact: true })).not.toBeInTheDocument();
		await expect.element(screen.getByText("Recommended", { exact: true })).not.toBeInTheDocument();
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
		expect(screen.getByTestId("kilo-providers-add-progress-label").element().textContent).toContain(
			"1 of 2",
		);
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-custom")).toBeVisible();
	});

	it("opens custom provider configuration directly when every popular provider is added", async () => {
		mockAllPopularProvidersConnected();
		const { screen } = await renderPage({ isPending: false, isError: false });
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

	it("disables adding providers while the catalog is loading", async () => {
		const { screen } = await renderPage({ isPending: true, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
	});

	it("shows the inventory once the catalog is ready", async () => {
		let resolveCatalog!: (value: unknown) => void;
		providerList.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCatalog = resolve;
				}),
		);
		configGet.mockResolvedValue({ data: {} });
		const { screen } = await renderPage({ isPending: false, isError: false });

		await expect.element(screen.getByTestId("kilo-providers-loading-provider")).toBeVisible();
		await vi.waitFor(() => expect(providerList).toHaveBeenCalled());

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

		await vi.waitFor(() => expect(agentQueryClient.isFetching()).toBe(0));
		await expect.element(screen.getByTestId("kilo-providers-loading")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-loading-provider"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-anthropic")).toBeVisible();
	});

	it("connects a catalog provider with an API key", async () => {
		mockCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });

		await screen.getByTestId("kilo-providers-toggle-openai").click();

		await expect.element(screen.getByTestId("kilo-providers-edit-api-key-loading")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-edit-save")).toBeDisabled();
	});

	it("edits a custom provider inline and collapses after saving", async () => {
		mockCustomCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });

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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
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
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-row-kilo-desktop-model-server"))
			.not.toBeInTheDocument();
	});

	it("disables provider actions while a mutation is pending", async () => {
		mockConnectedCatalog();
		authRemove.mockImplementation(() => new Promise(() => undefined));
		const { screen } = await renderPage({ isPending: false, isError: false });
		await clickDeleteProvider(screen, "openai");
		await expect.element(screen.getByTestId("kilo-providers-delete-anthropic")).toBeDisabled();
	});

	it("shows the delete button for added providers without hovering the row", async () => {
		mockConnectedCatalog();
		const { screen } = await renderPage({ isPending: false, isError: false });
		await expect.element(screen.getByTestId("kilo-providers-row-openai")).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Delete OpenAI" })).toBeVisible();
	});

	it("clears an earlier mutation error when a later provider action succeeds", async () => {
		mockConnectedCatalog();
		authRemove.mockRejectedValueOnce(new Error("credential store unavailable"));
		const { screen } = await renderPage({ isPending: false, isError: false });
		await clickDeleteProvider(screen, "openai");
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("credential store unavailable");

		await clickDeleteProvider(screen, "anthropic");
		await vi.waitFor(() => expect(authRemove).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
	});
});
