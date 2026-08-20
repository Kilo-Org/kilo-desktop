import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { kiloUiChatContract, type KiloGlobalConnection } from "../../contracts/chat/schemas.js";
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

function renderPage(status: {
	isPending: boolean;
	isError: boolean;
	connection?: KiloGlobalConnection;
}) {
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
	render(
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
					<KiloProvidersSettings />
				</ChatConnectionProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page, sdk, queryClient };
}

describe("KiloProvidersSettings", () => {
	it("shows desktop-unavailable copy when the connection failed", async () => {
		const { screen } = renderPage({ isPending: false, isError: true });
		await expect.element(screen.getByTestId("kilo-providers-page")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-unavailable")).toBeVisible();
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
	});

	it("lists a connected gateway provider and popular add targets", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-manage-account")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-custom")).toBeVisible();
	});

	it("connects a catalog provider with an API key", async () => {
		mockCatalog();
		const { screen } = renderPage({ isPending: false, isError: false, connection });
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByTestId("kilo-providers-connect-dialog")).toBeVisible();
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
		await screen.getByTestId("kilo-providers-add-custom").click();
		await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
		await screen.getByTestId("kilo-providers-custom-id").fill("vllm");
		await screen.getByTestId("kilo-providers-custom-name").fill("Local vLLM");
		await screen.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:8000/v1");
		await screen.getByTestId("kilo-providers-model-id-0").fill("qwen");
		await screen.getByTestId("kilo-providers-model-name-0").fill("Qwen");
		await screen.getByTestId("kilo-providers-custom-save").click();
		await vi.waitFor(() => expect(configUpdate).toHaveBeenCalled());
		const payload = configUpdate.mock.calls[0]?.[0] as {
			config: { provider: Record<string, { options: { baseURL: string } }> };
		};
		expect(payload.config.provider.vllm?.options.baseURL).toBe("http://127.0.0.1:8000/v1");
		expect(JSON.stringify(payload)).not.toContain("apiKey");
		expect(dispose).toHaveBeenCalled();
	});
});
