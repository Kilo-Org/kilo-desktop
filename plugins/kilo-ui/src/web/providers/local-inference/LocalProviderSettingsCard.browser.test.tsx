import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { LLAMA_SERVER_DOCS_URL } from "./constants.js";
import { localInferenceContract, type LocalInferenceServiceContract } from "./contract.js";
import { LocalProviderSettingsCard } from "./LocalProviderSettingsCard.js";

const CONNECTION = {
	port: 44123,
	baseUrl: "http://127.0.0.1:44123/v1",
	apiKey: "secret",
};

function renderCard(
	overrides: Partial<LocalInferenceServiceContract> = {},
	shell: Partial<SDK["shell"]> = {},
) {
	const handlers: LocalInferenceServiceContract = {
		"models.list": async () => [],
		"models.add": async ({ path }) => ({
			id: "tiny-a1b2c3d4",
			name: "Tiny",
			path,
			available: true,
			addedAt: 1,
		}),
		"models.remove": async () => ({ ok: true }),
		"models.update": async ({ id, settings }) => ({
			id,
			name: "Tiny",
			path: "/models/tiny.gguf",
			available: true,
			addedAt: 1,
			...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
		}),
		"models.prepare": async () => ({ ok: true }),
		"runtime.retry": async () => ({ ok: true }),
		"runtime.disconnect": async () => ({ ok: true }),
		"runtime.connect": async () => ({ ok: true }),
		"settings.get": async () => ({}),
		"settings.update": async (settings) => settings,
		"status.get": async () => ({ status: "idle" }),
		...overrides,
	};
	const sdk = createFakeSdk({
		featureId: "local-inference",
		channels: localInferenceContract,
		handlers,
		shell,
	});
	const system = createFakeFeatureSystem({ sdks: { "local-inference": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<LocalProviderSettingsCard />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(cleanup);

describe("LocalProviderSettingsCard", () => {
	it("shows the empty GGUF state and add action", async () => {
		const { baseElement } = renderCard();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Local Model Server")).toBeVisible();
		await expect.element(screen.getByText("Local", { exact: true })).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("local-provider-dropzone")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("local-provider-connection")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("local-provider-card"))
			.toHaveAttribute("data-state", "summary");
		await screen.getByTestId("local-provider-row-trigger").click();
		await expect.element(screen.getByText("Drop a GGUF model here")).toBeVisible();
		await expect.element(screen.getByText("or click to choose a file")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-dropzone")).toBeVisible();
	});

	it("opens the file picker from the empty dropzone keyboard", async () => {
		const { baseElement } = renderCard();
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("local-provider-row-trigger").click();
		const picker = baseElement.querySelector<HTMLInputElement>(
			"[data-qa-id='local-provider-file']",
		);
		expect(picker).not.toBeNull();
		const click = vi.spyOn(picker!, "click");
		const zone = baseElement.querySelector<HTMLElement>("[aria-label='Choose a GGUF model']");
		expect(zone).not.toBeNull();
		zone!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		zone!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		zone!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
		expect(click).toHaveBeenCalledTimes(2);
	});

	it("adds a dropped GGUF model", async () => {
		const add = vi.fn(async ({ path }: { path: string }) => ({
			id: "tiny-a1b2c3d4",
			name: "Tiny",
			path,
			available: true,
			addedAt: 1,
		}));
		const { baseElement } = renderCard(
			{ "models.add": add },
			{ getPathForFile: (file) => `/models/${file.name}` },
		);
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("local-provider-row-trigger").click();
		await expect.element(screen.getByTestId("local-provider-dropzone")).toBeVisible();
		const dropZone = baseElement.querySelector<HTMLElement>(
			"[data-qa-id='local-provider-dropzone']",
		);
		expect(dropZone).not.toBeNull();
		const event = new Event("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", {
			value: { files: [new File([], "tiny.gguf")] },
		});

		dropZone!.dispatchEvent(event);

		await vi.waitFor(() => {
			expect(add).toHaveBeenCalledWith({ path: "/models/tiny.gguf" });
		});
	});

	it("renders registered models and removes one", async () => {
		const remove = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
				{
					id: "tiny-bbbb",
					name: "Llama",
					path: "/models/llama.gguf",
					available: true,
					addedAt: 2,
				},
			],
			"models.remove": remove,
			"status.get": async () => ({
				status: "ready",
				loadedModelId: "tiny-bbbb",
				loadedModelIds: ["tiny-bbbb"],
				connection: CONNECTION,
			}),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Local Model Server")).toBeVisible();
		await expect.element(screen.getByText("Running (2 models)")).toBeVisible();
		await expect.element(screen.getByText("Manage", { exact: true })).not.toBeInTheDocument();
		await screen.getByRole("button", { name: "Manage local models" }).click();
		await expect.element(screen.getByTestId("local-provider-stop")).toBeVisible();
		await expect.element(screen.getByText("Llama")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-provider-heat-tiny-bbbb"))
			.toHaveAttribute("data-heat", "warm");
		await expect
			.element(screen.getByTestId("local-provider-heat-tiny-aaaa"))
			.toHaveAttribute("data-heat", "cold");
		await screen.getByTestId("local-provider-heat-tiny-bbbb").hover();
		await expect
			.element(screen.getByTestId("local-provider-heat-tooltip"))
			.toHaveTextContent("Loaded in memory");
		await screen.getByRole("button", { name: "Eject Llama" }).hover();
		await expect
			.element(screen.getByTestId("local-provider-eject-tooltip"))
			.toHaveTextContent("Eject the model from the local server.");
		await expect.element(screen.getByRole("button", { name: "Add GGUF model" })).toBeVisible();
		await screen.getByRole("button", { name: "Eject Llama" }).click();
		expect(remove).toHaveBeenCalledWith({ id: "tiny-bbbb" });
	});

	it("stops the running local server", async () => {
		const stop = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"runtime.disconnect": stop,
			"status.get": async () => ({
				status: "ready",
				loadedModelId: "tiny-aaaa",
				loadedModelIds: ["tiny-aaaa"],
				connection: CONNECTION,
			}),
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await expect.element(screen.getByTestId("local-provider-stop")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-connect")).not.toBeInTheDocument();
		await expect.element(screen.getByText("Running (1 model)")).toBeVisible();
		await screen.getByRole("button", { name: "Stop the local server" }).hover();
		await expect
			.element(screen.getByTestId("local-provider-stop-tooltip"))
			.toHaveTextContent("Stop the local server and all loaded models.");
		await screen.getByTestId("local-provider-stop").click();
		expect(stop).toHaveBeenCalled();
	});

	it("reveals server actions when the collapsed row is hovered", async () => {
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"status.get": async () => ({
				status: "ready",
				loadedModelId: "tiny-aaaa",
				loadedModelIds: ["tiny-aaaa"],
				connection: CONNECTION,
			}),
		});
		const screen = page.elementLocator(baseElement);
		const actions = screen.getByTestId("local-provider-actions");

		await expect
			.element(screen.getByTestId("local-provider-card"))
			.toHaveAttribute("data-state", "summary");
		await vi.waitFor(() => expect(getComputedStyle(actions.element()).opacity).toBe("0"));
		await screen.getByTestId("local-provider-row-trigger").hover();
		await vi.waitFor(() => expect(getComputedStyle(actions.element()).opacity).toBe("1"));
		await expect.element(screen.getByTestId("local-provider-stop")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-server-settings")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-connection")).toBeVisible();
	});

	it("keeps server actions visible while the section is expanded", async () => {
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"status.get": async () => ({
				status: "ready",
				loadedModelId: "tiny-aaaa",
				loadedModelIds: ["tiny-aaaa"],
				connection: CONNECTION,
			}),
		});
		const screen = page.elementLocator(baseElement);
		const actions = screen.getByTestId("local-provider-actions");

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await expect.element(screen.getByText("Gemma")).toBeVisible();
		await screen.getByText("Gemma").hover();
		await vi.waitFor(() => expect(getComputedStyle(actions.element()).opacity).toBe("1"));
		await expect.element(screen.getByTestId("local-provider-stop")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-server-settings")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-connection")).toBeVisible();
	});

	it("reconnects a disconnected local server", async () => {
		const connect = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"runtime.connect": connect,
			"status.get": async () => ({ status: "disconnected" }),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Stopped (1 model available)")).toBeVisible();
		await screen.getByTestId("local-provider-row-trigger").hover();
		await expect.element(screen.getByTestId("local-provider-connect")).toBeVisible();
		await expect.element(screen.getByTestId("local-provider-stop")).not.toBeInTheDocument();
		await screen.getByRole("button", { name: "Start the local server" }).hover();
		await expect
			.element(screen.getByTestId("local-provider-start-tooltip"))
			.toHaveTextContent("Start the local server.");
		await screen.getByTestId("local-provider-connect").click();
		expect(connect).toHaveBeenCalled();
	});

	it("shows stopping while the local server is shutting down", async () => {
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"status.get": async () => ({ status: "stopping" }),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Stopping…")).toBeVisible();
		await screen.getByTestId("local-provider-row-trigger").hover();
		await expect.element(screen.getByTestId("local-provider-connect")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("local-provider-stop")).toBeDisabled();
	});

	it("shows copyable connection details from the connection control", async () => {
		const copyText = vi.fn(async () => undefined);
		const { baseElement } = renderCard(
			{
				"models.list": async () => [
					{
						id: "tiny-aaaa",
						name: "Gemma",
						path: "/models/gemma.gguf",
						available: true,
						addedAt: 1,
					},
				],
				"status.get": async () => ({
					status: "ready",
					loadedModelId: "tiny-aaaa",
					loadedModelIds: ["tiny-aaaa"],
					connection: CONNECTION,
				}),
			},
			{ copyText },
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("local-provider-card"))
			.toHaveAttribute("data-state", "summary");
		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByRole("button", { name: "Connection information" }).hover();
		await expect
			.element(screen.getByTestId("local-provider-connection-tooltip"))
			.toHaveTextContent("Connection information");
		await screen.getByTestId("local-provider-connection").click();
		await expect.element(screen.getByTestId("local-provider-connection-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-provider-card"))
			.toHaveAttribute("data-state", "summary");
		const dialog = baseElement.querySelector<HTMLElement>(
			"[data-qa-id='local-provider-connection-dialog']",
		);
		expect(dialog).not.toBeNull();
		expect(dialog!.scrollWidth).toBeLessThanOrEqual(dialog!.clientWidth);
		await expect.element(screen.getByText("Base URL")).toBeVisible();
		await expect.element(screen.getByText("Chat completions")).toBeVisible();
		await expect.element(screen.getByText("Streaming completions")).toBeVisible();
		await expect.element(screen.getByText("List models")).toBeVisible();
		await expect.element(screen.getByText("API key")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-provider-connection-base-url"))
			.toHaveValue(CONNECTION.baseUrl);
		await expect
			.element(screen.getByTestId("local-provider-connection-api-key"))
			.toHaveValue("••••••••");
		await expect
			.element(screen.getByTestId("local-provider-connection-models-curl"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("local-provider-connection-chat-curl"))
			.not.toBeInTheDocument();
		await screen.getByTestId("local-provider-connection-endpoint-models").click();
		await expect
			.element(screen.getByTestId("local-provider-connection-models-curl"))
			.toHaveValue(
				"curl -sS 'http://127.0.0.1:44123/v1/models' -H 'Authorization: Bearer ••••••••'",
			);
		await screen.getByTestId("local-provider-connection-endpoint-chat").click();
		await expect.element(screen.getByTestId("local-provider-connection-chat-curl")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-provider-connection-models-curl"))
			.not.toBeInTheDocument();
		await screen.getByTestId("local-provider-connection-endpoint-models").click();
		await expect
			.element(screen.getByTestId("local-provider-connection-models-curl"))
			.toHaveValue(
				"curl -sS 'http://127.0.0.1:44123/v1/models' -H 'Authorization: Bearer ••••••••'",
			);
		expect(dialog!.scrollWidth).toBeLessThanOrEqual(dialog!.clientWidth);
		await screen.getByTestId("local-provider-connection-copy-base-url").click();
		expect(copyText).toHaveBeenCalledWith(CONNECTION.baseUrl);
		await screen.getByTestId("local-provider-connection-copy-models-curl").click();
		expect(copyText).toHaveBeenCalledWith(
			"curl -sS 'http://127.0.0.1:44123/v1/models' -H 'Authorization: Bearer secret'",
		);
		await screen.getByTestId("local-provider-connection-copy-api-key").click();
		expect(copyText).toHaveBeenCalledWith(CONNECTION.apiKey);
	});

	it("saves per-model settings and advanced llama.cpp flags", async () => {
		const update = vi.fn(async ({ id, settings }: { id: string; settings: object }) => ({
			id,
			name: "Gemma",
			path: "/models/gemma.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"models.update": update,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		await expect.element(screen.getByTestId("local-provider-settings-dialog")).toBeVisible();
		await expect.element(screen.getByText("Model settings")).toBeVisible();
		await screen.getByTestId("local-provider-settings-temperature-override").click();
		const decideHint = [...baseElement.querySelectorAll("p")].find(
			(node) => node.textContent === "Leave blank to let the model decide.",
		);
		expect(decideHint).toBeTruthy();
		expect(decideHint!.getClientRects().length).toBe(1);
		await screen.getByTestId("local-provider-settings-temperature").fill("0.2");
		await screen.getByTestId("local-provider-settings-context").fill("8192");
		await screen.getByTestId("local-provider-settings-max-tokens").fill("2048");
		await screen.getByTestId("local-provider-settings-advanced").click();
		await expect
			.element(screen.getByTestId("local-provider-settings-flag-docs"))
			.toHaveAttribute("href", LLAMA_SERVER_DOCS_URL);
		await screen.getByTestId("local-provider-settings-flag-key").fill("n-gpu-layers");
		await screen.getByTestId("local-provider-settings-flag-value").fill("99");
		await screen.getByTestId("local-provider-settings-add-flag").click();
		await expect.element(screen.getByText("n-gpu-layers")).toBeVisible();
		await expect.element(screen.getByText("99")).toBeVisible();
		await screen.getByTestId("local-provider-settings-save").click();

		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledWith({
				id: "tiny-aaaa",
				settings: {
					temperature: 0.2,
					contextLength: 8192,
					maxResponseTokens: 2048,
					llamaFlags: { "n-gpu-layers": "99" },
				},
			});
		});
	});

	it("rejects a half-filled llama.cpp flag row", async () => {
		const update = vi.fn();
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"models.update": update,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		await screen.getByTestId("local-provider-settings-advanced").click();
		await screen.getByTestId("local-provider-settings-flag-key").fill("n-gpu-layers");
		await screen.getByTestId("local-provider-settings-save").click();
		await expect.element(screen.getByText("Flag name and value are both required.")).toBeVisible();
		expect(update).not.toHaveBeenCalled();
	});

	it("shows saved llama.cpp flags and removes them", async () => {
		const update = vi.fn(async ({ id, settings }: { id: string; settings: object }) => ({
			id,
			name: "Gemma",
			path: "/models/gemma.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
					settings: { llamaFlags: { "flash-attn": "on" } },
				},
			],
			"models.update": update,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		await expect.element(screen.getByText("flash-attn")).toBeVisible();
		await expect.element(screen.getByText("on")).toBeVisible();
		await screen.getByTestId("local-provider-settings-flag-remove-0").click();
		await expect.element(screen.getByText("flash-attn")).not.toBeInTheDocument();
		await screen.getByTestId("local-provider-settings-save").click();
		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledWith({
				id: "tiny-aaaa",
				settings: {},
			});
		});
	});

	it("opts a local model into Kilo context and tools", async () => {
		const update = vi.fn(async ({ id, settings }: { id: string; settings: object }) => ({
			id,
			name: "Gemma",
			path: "/models/gemma.gguf",
			available: true,
			addedAt: 1,
			settings,
		}));
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
			"models.update": update,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		const toggle = screen.getByTestId("local-provider-settings-kilo-context");
		await expect.element(toggle).toHaveAttribute("aria-checked", "false");
		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-checked", "true");
		await screen.getByTestId("local-provider-settings-save").click();

		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledWith({
				id: "tiny-aaaa",
				settings: { includeKiloContext: true },
			});
		});
	});

	it("restores Kilo context when it was previously enabled", async () => {
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
					settings: { includeKiloContext: true },
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		await expect
			.element(screen.getByTestId("local-provider-settings-kilo-context"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("saves server port, LAN serving, max models, and router flags", async () => {
		const update = vi.fn(async (settings: object) => settings);
		const { baseElement } = renderCard({
			"settings.get": async () => ({}),
			"settings.update": update,
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByTestId("local-provider-server-settings").click();
		await expect.element(screen.getByTestId("local-provider-server-settings-dialog")).toBeVisible();
		await expect.element(screen.getByText("Server settings")).toBeVisible();
		await screen.getByTestId("local-provider-server-port").fill("8080");
		await screen.getByTestId("local-provider-server-max-models").fill("2");
		const lan = screen.getByTestId("local-provider-server-lan");
		await expect.element(lan).toHaveAttribute("aria-checked", "false");
		await lan.click();
		await expect.element(lan).toHaveAttribute("aria-checked", "true");
		await screen.getByTestId("local-provider-server-advanced").click();
		await expect
			.element(screen.getByTestId("local-provider-server-flag-docs"))
			.toHaveAttribute("href", LLAMA_SERVER_DOCS_URL);
		await screen.getByTestId("local-provider-server-flag-key").fill("timeout");
		await screen.getByTestId("local-provider-server-flag-value").fill("120");
		await screen.getByTestId("local-provider-server-add-flag").click();
		await expect.element(screen.getByText("timeout")).toBeVisible();
		await expect.element(screen.getByText("120")).toBeVisible();
		await screen.getByTestId("local-provider-server-settings-save").click();

		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledWith({
				port: 8080,
				maxModels: 2,
				serveOnLocalNetwork: true,
				llamaFlags: { timeout: "120" },
			});
		});
	});

	it("restores LAN serving when it was previously enabled", async () => {
		const { baseElement } = renderCard({
			"settings.get": async () => ({ serveOnLocalNetwork: true }),
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByTestId("local-provider-server-settings").click();
		await expect
			.element(screen.getByTestId("local-provider-server-lan"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("shows saved server flags and removes them", async () => {
		const update = vi.fn(async (settings: object) => settings);
		const { baseElement } = renderCard({
			"settings.get": async () => ({ llamaFlags: { timeout: "120" } }),
			"settings.update": update,
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByTestId("local-provider-server-settings").click();
		await expect.element(screen.getByText("timeout")).toBeVisible();
		await screen.getByTestId("local-provider-server-flag-remove-0").click();
		await expect.element(screen.getByText("timeout")).not.toBeInTheDocument();
		await screen.getByTestId("local-provider-server-settings-save").click();
		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledWith({});
		});
	});

	it("opens llama.cpp docs from server settings", async () => {
		const openExternal = vi.fn(async () => {
			throw new Error("blocked");
		});
		const { baseElement } = renderCard(
			{
				"models.list": async () => [
					{
						id: "tiny-aaaa",
						name: "Gemma",
						path: "/models/gemma.gguf",
						available: true,
						addedAt: 1,
					},
				],
			},
			{ openExternal },
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByTestId("local-provider-server-settings").click();
		await screen.getByTestId("local-provider-server-advanced").click();
		await screen.getByTestId("local-provider-server-flag-docs").click();
		await vi.waitFor(() => {
			expect(openExternal).toHaveBeenCalledWith(LLAMA_SERVER_DOCS_URL);
		});
	});

	it("rejects a duplicate llama.cpp server flag", async () => {
		const update = vi.fn();
		const { baseElement } = renderCard({
			"settings.get": async () => ({ llamaFlags: { timeout: "120" } }),
			"settings.update": update,
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("local-provider-row-trigger").hover();
		await screen.getByTestId("local-provider-server-settings").click();
		await screen.getByTestId("local-provider-server-flag-key").fill("timeout");
		await screen.getByTestId("local-provider-server-flag-value").fill("60");
		await screen.getByTestId("local-provider-server-add-flag").click();
		await expect
			.element(screen.getByText('llama.cpp flag "timeout" is set more than once.'))
			.toBeVisible();
		expect(update).not.toHaveBeenCalled();
	});

	it("opens llama.cpp docs from model settings", async () => {
		const openExternal = vi.fn(async () => {
			throw new Error("blocked");
		});
		const { baseElement } = renderCard(
			{
				"models.list": async () => [
					{
						id: "tiny-aaaa",
						name: "Gemma",
						path: "/models/gemma.gguf",
						available: true,
						addedAt: 1,
					},
				],
			},
			{ openExternal },
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Manage local models" }).click();
		await screen.getByRole("button", { name: "Settings for Gemma" }).click();
		await screen.getByTestId("local-provider-settings-advanced").click();
		await screen.getByTestId("local-provider-settings-flag-docs").click();
		await vi.waitFor(() => {
			expect(openExternal).toHaveBeenCalledWith(LLAMA_SERVER_DOCS_URL);
		});
	});

	it("shows mixed availability when a GGUF file is missing", async () => {
		const { baseElement } = renderCard({
			"models.list": async () => [
				{
					id: "tiny-aaaa",
					name: "Gemma",
					path: "/models/gemma.gguf",
					available: true,
					addedAt: 1,
				},
				{
					id: "tiny-bbbb",
					name: "Missing",
					path: "/models/gone.gguf",
					available: false,
					addedAt: 2,
				},
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("1 of 2 models available")).toBeVisible();
		await screen.getByRole("button", { name: "Manage local models" }).click();
		await expect.element(screen.getByText("File is unavailable")).toBeVisible();
	});
});
