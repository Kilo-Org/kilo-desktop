import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	definePlugin,
	KernelError,
	type DomainObjectProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	Models,
	type AiProvider,
	type CustomAiProvider,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";

import shellManifest from "../../../plugin.json";
import { SettingsSection, SHELL_DEFINITIONS } from "../../contracts";
import { AiProviderList } from "./AiProviderList";

const KILO: AiProvider = {
	id: "kilo",
	name: "Kilo Gateway",
	connected: true,
	source: "kilo",
	env: [],
	canDisconnect: false,
};

function catalog(id: string, name: string, connected: boolean): AiProvider {
	return { id, name, connected, source: "api", env: [], canDisconnect: connected };
}

const POPULAR: Record<string, string> = {
	anthropic: "Anthropic",
	deepseek: "DeepSeek",
	openai: "OpenAI",
	google: "Google",
	openrouter: "OpenRouter",
	vercel: "Vercel",
};

/** Kilo's gateway plus every popular AI provider, `connected` ones connected with a key. */
function aiProviders(connected: string[] = [], extra: AiProvider[] = []) {
	const entries = [
		KILO,
		...Object.entries(POPULAR).map(([id, name]) => catalog(id, name, connected.includes(id))),
		...extra,
	];
	return Object.fromEntries(entries.map((entry) => [entry.id, entry]));
}

const VLLM: AiProvider = {
	id: "vllm",
	name: "Local vLLM",
	connected: true,
	source: "custom",
	env: [],
	canDisconnect: true,
};

const SAVED_VLLM: CustomAiProvider = {
	aiProviderId: "vllm",
	name: "Local vLLM",
	baseUrl: "http://127.0.0.1:8000/v1",
	apiFormat: "openai-compatible",
	models: [{ modelId: "qwen", name: "Qwen" }],
};

interface FakeModelsOptions {
	readonly ready?: boolean;
	readonly aiProviders?: Record<string, AiProvider>;
	readonly saved?: Record<string, CustomAiProvider>;
}

/**
 * Stands in for kilo.core's models: AI providers the test controls and
 * mutations that change them the way kilo.core's re-read would. Each method
 * is a spy; queue a failure or a hang with `failNext` / `hangNext`.
 */
function fakeCore(options: FakeModelsOptions) {
	let models: DomainObjectProvider<typeof Models> | undefined;
	const saved: Record<string, CustomAiProvider> = { ...options.saved };
	const failures = new Map<string, Error[]>();
	const hangs = new Set<string>();
	const guard = (method: string) => {
		const failure = failures.get(method)?.shift();
		if (failure) throw failure;
		if (hangs.delete(method)) return new Promise<never>(() => undefined);
		return undefined;
	};
	const setProviders = (
		update: (current: Record<string, AiProvider>) => Record<string, AiProvider>,
	) => models!.update((state) => ({ ...state, aiProviders: update(state.aiProviders) }));

	const methods = {
		refresh: vi.fn(async () => {
			await guard("refresh");
			models!.update((state) => ({ ...state, ready: true }));
		}),
		connectAiProvider: vi.fn(async ({ aiProviderId }: { aiProviderId: string; apiKey: string }) => {
			await guard("connectAiProvider");
			setProviders((current) => ({
				...current,
				[aiProviderId]: {
					...current[aiProviderId]!,
					connected: true,
					source: "api",
					canDisconnect: true,
				},
			}));
		}),
		disconnectAiProvider: vi.fn(async ({ aiProviderId }: { aiProviderId: string }) => {
			await guard("disconnectAiProvider");
			setProviders((current) => {
				const { [aiProviderId]: removed, ...rest } = current;
				if (!removed || removed.source === "custom") return rest;
				return { ...rest, [aiProviderId]: { ...removed, connected: false, canDisconnect: false } };
			});
		}),
		saveCustomAiProvider: vi.fn(async (provider: CustomAiProvider) => {
			await guard("saveCustomAiProvider");
			saved[provider.aiProviderId] = provider;
			setProviders((current) => ({
				...current,
				[provider.aiProviderId]: { ...VLLM, id: provider.aiProviderId, name: provider.name },
			}));
		}),
		customAiProvider: vi.fn(async ({ aiProviderId }: { aiProviderId: string }) => {
			await guard("customAiProvider");
			return saved[aiProviderId] ?? null;
		}),
		presentEnv: vi.fn(async ({ names }: { names: string[] }) => ({ names })),
	};

	const initialState: ModelsState = {
		ready: options.ready ?? true,
		followingAccount: false,
		aiProviders: options.aiProviders ?? aiProviders(),
		models: {},
		defaults: {},
		preferences: { byAgent: {}, variants: {}, recent: [], favorites: [], autoFreeModels: true },
		gatewayCatalog: { details: [], fetchedAt: null },
	};
	const main: PluginEntry = definePlugin({
		activate(sdk) {
			models = sdk.domainObjects.provide(Models, {
				initialState,
				methods: {
					...methods,
					refreshGatewayCatalog: () => undefined,
					remember: () => undefined,
					recordRecent: () => undefined,
					setFavorite: () => undefined,
					setAutoFreeModels: () => undefined,
				},
			});
		},
	});
	return {
		main,
		methods,
		failNext: (method: keyof typeof methods, error: Error) =>
			failures.set(method, [...(failures.get(method) ?? []), error]),
		hangNext: (method: keyof typeof methods) => hangs.add(method),
		setProviders: (next: Record<string, AiProvider>) => setProviders(() => next),
	};
}

/** Settings → AI Providers as the settings area draws it: the list below Kilo Gateway's panel. */
function AiProvidersPage() {
	return <AiProviderList hiddenAiProviderIds={["kilo"]} />;
}

let host: PluginHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

async function renderList(
	options: FakeModelsOptions & {
		withoutModels?: boolean;
		/** Queues failures or hangs before the list first renders. */
		setup?: (core: ReturnType<typeof fakeCore>) => void;
	} = {},
) {
	const core = fakeCore(options);
	options.setup?.(core);
	host = await createPluginHost(
		[
			{
				manifest: coreManifest,
				definitions: CORE_DEFINITIONS,
				...(options.withoutModels ? {} : { main: core.main }),
			},
			{
				manifest: shellManifest,
				definitions: SHELL_DEFINITIONS,
				web: definePlugin({
					activate(sdk) {
						sdk.extensions.implement(SettingsSection, "ai-providers", {
							component: AiProvidersPage,
						});
					},
				}),
			},
		],
		{ host: { desktop: true } },
	);
	host.renderSlot(SettingsSection, {}, { select: (section) => section.component });
	return { screen: page, ...core };
}

async function openCustomDialog(screen: typeof page) {
	await screen.getByTestId("kilo-providers-add-provider").click();
	await screen.getByTestId("kilo-providers-add-custom").click();
	await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
}

describe("AiProviderList", () => {
	it("says provider management needs the desktop app without kilo.core's models", async () => {
		const { screen } = await renderList({ withoutModels: true });
		await expect
			.element(screen.getByTestId("kilo-providers-page"))
			.toHaveAttribute("data-state", "unavailable");
		await expect.element(screen.getByTestId("kilo-providers-unavailable")).toBeVisible();
	});

	it("asks kilo.core to read the AI providers, showing a placeholder until they arrive", async () => {
		const { screen, methods } = await renderList({
			ready: false,
			setup: (core) => core.hangNext("refresh"),
		});

		await vi.waitFor(() => expect(methods.refresh).toHaveBeenCalledOnce());
		await expect.element(screen.getByTestId("kilo-providers-loading-provider")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
	});

	it("shows a failed read with a retry, and the list once it succeeds", async () => {
		const { screen, methods } = await renderList({
			ready: false,
			aiProviders: aiProviders(["anthropic"]),
			setup: (core) => core.failNext("refresh", new KernelError("UNAVAILABLE", "catalog offline")),
		});

		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toMatchTextContent(/catalog offline/);
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
		await screen.getByTestId("kilo-providers-retry").click();

		await expect.element(screen.getByTestId("kilo-providers-row-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		expect(methods.refresh).toHaveBeenCalledTimes(2);
	});

	it("leaves out AI providers drawn by a panel and those a plugin manages", async () => {
		const { screen } = await renderList({
			aiProviders: aiProviders(
				["openai"],
				[{ ...VLLM, id: "local-server", name: "Local Model Server", source: "plugin" }],
			),
		});
		await expect.element(screen.getByTestId("kilo-providers-row-openai")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-row-kilo")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-local-server"))
			.not.toBeInTheDocument();
	});

	it("keeps one dialog shell mounted across provider setup steps", async () => {
		const { screen } = await renderList();
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect.element(screen.getByTestId("kilo-providers-add-dialog")).toBeVisible();
		const dialog = document.querySelector('[data-slot="dialog-content"]');
		expect(dialog).not.toBeNull();
		const dialogWidth = dialog!.getBoundingClientRect().width;

		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByTestId("kilo-providers-connect-dialog")).toBeVisible();
		expect(document.querySelector('[data-slot="dialog-content"]')).toBe(dialog);

		await screen.getByRole("button", { name: "Back" }).click();
		await screen.getByTestId("kilo-providers-add-custom").click();
		await expect.element(screen.getByTestId("kilo-providers-custom-dialog")).toBeVisible();
		expect(document.querySelector('[data-slot="dialog-content"]')).toBe(dialog);
		expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
		expect(dialog!.getBoundingClientRect().width).toBe(dialogWidth);
	});

	it("lists the popular AI providers to add, then a custom one", async () => {
		const { screen } = await renderList({ aiProviders: aiProviders(["openai"]) });
		await expect
			.element(screen.getByTestId("kilo-providers-add-provider"))
			.toHaveTextContent("Add AI Provider");
		await screen.getByTestId("kilo-providers-add-provider").click();
		const dialog = screen.getByTestId("kilo-providers-add-dialog");
		await expect.element(dialog.getByRole("heading", { name: "Add AI Provider" })).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.toHaveTextContent("1 of 2");
		await expect.element(screen.getByTestId("kilo-providers-add-anthropic")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-add-openai")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-add-kilo")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-add-custom")).toBeVisible();
	});

	it("opens custom provider configuration directly when every popular provider is added", async () => {
		const { screen } = await renderList({ aiProviders: aiProviders(Object.keys(POPULAR)) });
		await screen.getByTestId("kilo-providers-add-provider").click();
		await expect
			.element(screen.getByRole("heading", { name: "Add custom AI provider" }))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Back" })).not.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
	});

	it("connects a catalog provider with an API key", async () => {
		const { screen, methods } = await renderList();
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await expect.element(screen.getByRole("heading", { name: "Add Anthropic" })).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-add-progress-label"))
			.toHaveTextContent("2 of 2");
		await screen.getByTestId("kilo-providers-connect").click();
		await expect.element(screen.getByText("API key is required")).toBeVisible();

		await screen.getByTestId("kilo-providers-api-key").fill("sk-ant");
		await screen.getByTestId("kilo-providers-connect").click();

		await vi.waitFor(() =>
			expect(methods.connectAiProvider).toHaveBeenCalledWith(
				{ aiProviderId: "anthropic", apiKey: "sk-ant" },
				expect.anything(),
			),
		);
		await expect
			.element(screen.getByTestId("kilo-providers-connect-dialog"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-anthropic").getByText("API key"))
			.toBeVisible();
	});

	it("keeps the connect dialog open with the reason a key was refused", async () => {
		const { screen, failNext } = await renderList();
		failNext("connectAiProvider", new KernelError("BUSINESS", "That key was refused."));
		await screen.getByTestId("kilo-providers-add-provider").click();
		await screen.getByTestId("kilo-providers-add-anthropic").click();
		await screen.getByTestId("kilo-providers-api-key").fill("sk-bad");
		await screen.getByTestId("kilo-providers-connect").click();

		const dialog = screen.getByTestId("kilo-providers-connect-dialog");
		await expect.element(dialog.getByText("That key was refused.")).toBeVisible();
		await screen.getByRole("button", { name: "Back" }).click();
		await expect.element(screen.getByTestId("kilo-providers-add-dialog")).toBeVisible();
	});

	it("replaces the API key for a connected catalog provider", async () => {
		const { screen, methods } = await renderList({ aiProviders: aiProviders(["openai"]) });

		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "summary");
		await screen.getByTestId("kilo-providers-toggle-openai").click();
		const editor = screen.getByTestId("kilo-providers-editor-openai");
		const input = editor.getByTestId("kilo-providers-edit-api-key");
		await expect.element(input).toHaveValue("");
		await expect.element(input).toHaveAttribute("type", "password");
		await screen.getByTestId("kilo-providers-edit-api-key-visibility").click();
		await expect.element(input).toHaveAttribute("type", "text");
		await input.fill("sk-new");
		await screen.getByTestId("kilo-providers-edit-save").click();

		await vi.waitFor(() =>
			expect(methods.connectAiProvider).toHaveBeenCalledWith(
				{ aiProviderId: "openai", apiKey: "sk-new" },
				expect.anything(),
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
		const { screen, failNext } = await renderList({ aiProviders: aiProviders(["openai"]) });
		failNext("connectAiProvider", new KernelError("BUSINESS", "credential store unavailable"));

		await screen.getByTestId("kilo-providers-row-trigger-openai").click();
		const editor = screen.getByTestId("kilo-providers-editor-openai");
		await editor.getByTestId("kilo-providers-edit-api-key").fill("sk-new");
		await editor.getByTestId("kilo-providers-edit-save").click();

		await expect.element(editor.getByText("credential store unavailable")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-openai"))
			.toHaveAttribute("data-state", "expanded");

		await editor.getByRole("button", { name: "Cancel" }).click();
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("credential store unavailable");
	});

	it("does not surface an earlier provider's editor error after another provider fails", async () => {
		const { screen, failNext } = await renderList({
			aiProviders: aiProviders(["openai"], [VLLM]),
			saved: { vllm: SAVED_VLLM },
		});
		failNext("connectAiProvider", new KernelError("BUSINESS", "credential store unavailable"));
		failNext("saveCustomAiProvider", new KernelError("BUSINESS", "config write failed"));

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

	it("edits a custom provider inline and collapses after saving", async () => {
		const { screen, methods } = await renderList({
			aiProviders: aiProviders([], [VLLM]),
			saved: { vllm: SAVED_VLLM },
		});

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

		await vi.waitFor(() =>
			expect(methods.saveCustomAiProvider).toHaveBeenCalledWith(
				{
					aiProviderId: "vllm",
					name: "Local vLLM",
					baseUrl: "http://127.0.0.1:9000/v1",
					apiFormat: "openai-compatible",
					models: [{ modelId: "qwen", name: "Qwen", reasoning: false, attachments: false }],
				},
				expect.anything(),
			),
		);
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm"))
			.toHaveAttribute("data-state", "summary");
	});

	it("explains a custom provider it can't read back for editing", async () => {
		const { screen } = await renderList({ aiProviders: aiProviders([], [VLLM]) });

		await screen.getByTestId("kilo-providers-toggle-vllm").click();

		await expect.element(screen.getByText("Local vLLM can't be edited here.")).toBeVisible();
		await screen.getByRole("button", { name: "Close" }).click();
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm"))
			.toHaveAttribute("data-state", "summary");
	});

	it("shows why a custom provider couldn't be read", async () => {
		const { screen, failNext } = await renderList({
			aiProviders: aiProviders([], [VLLM]),
			saved: { vllm: SAVED_VLLM },
		});
		failNext("customAiProvider", new KernelError("UNAVAILABLE", "Kilo isn't running."));

		await screen.getByTestId("kilo-providers-toggle-vllm").click();

		await expect.element(screen.getByText("Kilo isn't running.")).toBeVisible();
	});

	it("removes a custom provider's stored key on request", async () => {
		const { screen, methods } = await renderList({
			aiProviders: aiProviders([], [VLLM]),
			saved: { vllm: { ...SAVED_VLLM, apiKey: "********" } },
		});

		await screen.getByTestId("kilo-providers-toggle-vllm").click();
		const editor = screen.getByTestId("kilo-providers-editor-vllm");
		await editor.getByTestId("kilo-providers-custom-key-remove").click();
		await expect.element(editor.getByText("Removal pending")).toBeVisible();
		await editor.getByTestId("kilo-providers-custom-save").click();

		await vi.waitFor(() =>
			expect(methods.saveCustomAiProvider.mock.calls[0]?.[0]).toMatchObject({ apiKey: "" }),
		);
	});

	it("discards unsaved custom provider edits on cancel", async () => {
		const { screen, methods } = await renderList({
			aiProviders: aiProviders([], [VLLM]),
			saved: { vllm: SAVED_VLLM },
		});

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
		expect(methods.saveCustomAiProvider).not.toHaveBeenCalled();
	});

	it("saves a custom provider after validation", async () => {
		const { screen, methods } = await renderList();
		await openCustomDialog(screen);
		await screen.getByTestId("kilo-providers-custom-save").click();
		await expect.element(screen.getByText("Enter a provider name")).toBeVisible();

		await screen.getByTestId("kilo-providers-custom-name").fill("Local vLLM");
		await screen.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:8000/v1");
		await screen.getByTestId("kilo-providers-custom-key").fill("sk-local");
		await screen.getByTestId("kilo-providers-model-id-input").fill("qwen");
		await screen.getByTestId("kilo-providers-custom-save").click();

		await vi.waitFor(() =>
			expect(methods.saveCustomAiProvider).toHaveBeenCalledWith(
				{
					aiProviderId: "local-vllm",
					name: "Local vLLM",
					baseUrl: "http://127.0.0.1:8000/v1",
					apiFormat: "openai-compatible",
					apiKey: "sk-local",
					models: [{ modelId: "qwen", name: "qwen", reasoning: false, attachments: false }],
				},
				expect.anything(),
			),
		);
		await expect
			.element(screen.getByTestId("kilo-providers-custom-dialog"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-providers-row-local-vllm")).toBeVisible();
	});

	it("saves the API format, reasoning, image support and headers chosen", async () => {
		const { screen, methods } = await renderList();
		await openCustomDialog(screen);
		await screen.getByTestId("kilo-providers-custom-name").fill("Claude Proxy");
		await screen.getByTestId("kilo-providers-custom-url").fill("https://proxy.example.com/v1");
		await screen.getByTestId("kilo-providers-custom-npm").click();
		await screen.getByRole("option", { name: "Anthropic Messages" }).click();
		await screen.getByTestId("kilo-providers-model-id-input").fill("claude");
		await screen.getByTestId("kilo-providers-model-reasoning-input").click();
		await screen.getByTestId("kilo-providers-add-model").click();
		await screen.getByTestId("kilo-providers-model-images-all").click();
		await screen.getByTestId("kilo-providers-custom-advanced").click();
		await screen.getByTestId("kilo-providers-header-key-input").fill("X-Team");
		await screen.getByTestId("kilo-providers-header-value-input").fill("desktop");
		await screen.getByTestId("kilo-providers-add-header").click();
		await screen.getByTestId("kilo-providers-custom-save").click();

		await vi.waitFor(() =>
			expect(methods.saveCustomAiProvider.mock.calls[0]?.[0]).toEqual({
				aiProviderId: "claude-proxy",
				name: "Claude Proxy",
				baseUrl: "https://proxy.example.com/v1",
				apiFormat: "anthropic-messages",
				headers: { "X-Team": "desktop" },
				models: [{ modelId: "claude", name: "claude", reasoning: true, attachments: true }],
			}),
		);
	});

	it("generates a unique provider id when the provider name is already in use", async () => {
		const { screen, methods } = await renderList();
		await openCustomDialog(screen);
		await screen.getByTestId("kilo-providers-custom-name").fill("Anthropic");
		await screen.getByTestId("kilo-providers-custom-url").fill("https://example.com/v1");
		await screen.getByTestId("kilo-providers-model-id-input").fill("model");
		await screen.getByTestId("kilo-providers-custom-save").click();

		await vi.waitFor(() =>
			expect(methods.saveCustomAiProvider.mock.calls[0]?.[0]).toMatchObject({
				aiProviderId: "anthropic-2",
			}),
		);
	});

	it("rejects a half-filled custom header row", async () => {
		const { screen, methods } = await renderList();
		await openCustomDialog(screen);
		await screen.getByTestId("kilo-providers-custom-name").fill("Local vLLM");
		await screen.getByTestId("kilo-providers-custom-url").fill("http://127.0.0.1:8000/v1");
		await screen.getByTestId("kilo-providers-model-id-input").fill("qwen");
		await screen.getByTestId("kilo-providers-custom-advanced").click();
		await screen.getByTestId("kilo-providers-header-key-input").fill("Authorization");
		await screen.getByTestId("kilo-providers-custom-save").click();
		await expect.element(screen.getByText("Header name and value are both required")).toBeVisible();
		expect(methods.saveCustomAiProvider).not.toHaveBeenCalled();
	});

	it("rejects a duplicated model id from the add row", async () => {
		const { screen } = await renderList();
		await openCustomDialog(screen);
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
		const { screen, methods } = await renderList({ aiProviders: aiProviders([], [VLLM]) });
		await expect
			.element(screen.getByTestId("kilo-providers-row-vllm").getByText("Custom"))
			.toBeVisible();
		await screen.getByTestId("kilo-providers-delete-vllm").click();
		await expect.element(screen.getByTestId("kilo-providers-remove-dialog")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-remove-confirm"))
			.toHaveTextContent("Delete AI provider");
		expect(methods.disconnectAiProvider).not.toHaveBeenCalled();

		await screen.getByTestId("kilo-providers-remove-confirm").click();
		await vi.waitFor(() =>
			expect(methods.disconnectAiProvider).toHaveBeenCalledWith(
				{ aiProviderId: "vllm" },
				expect.anything(),
			),
		);
		await expect.element(screen.getByTestId("kilo-providers-row-vllm")).not.toBeInTheDocument();
	});

	it("includes environment-sourced credentials in the list, with their variables on request", async () => {
		const { screen, methods } = await renderList({
			aiProviders: aiProviders(
				["anthropic"],
				[
					{
						id: "amazon-bedrock",
						name: "Amazon Bedrock",
						connected: true,
						source: "env",
						env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
						canDisconnect: false,
					},
				],
			),
		});
		const row = screen.getByTestId("kilo-providers-row-amazon-bedrock");
		await expect.element(row.getByText("Environment Variables")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-row-anthropic").getByText("API key"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-providers-delete-amazon-bedrock"))
			.not.toBeInTheDocument();
		await expect.element(row).toHaveAttribute("data-state", "summary");
		expect(methods.presentEnv).not.toHaveBeenCalled();

		await screen.getByTestId("kilo-providers-toggle-amazon-bedrock").click();
		await expect.element(row).toHaveAttribute("data-state", "expanded");
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).toBeVisible();
		await expect.element(screen.getByText("AWS_REGION")).toBeVisible();
		await screen.getByTestId("kilo-providers-row-trigger-amazon-bedrock").click();
		await expect.element(row).toHaveAttribute("data-state", "summary");
	});

	it("does not treat autoloaded credentials as a stored API key", async () => {
		const { screen, methods } = await renderList({
			aiProviders: aiProviders(
				[],
				[
					{
						id: "amazon-bedrock",
						name: "Amazon Bedrock",
						connected: true,
						source: "config",
						env: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
						canDisconnect: false,
					},
				],
			),
		});
		methods.presentEnv.mockResolvedValue({ names: ["AWS_PROFILE"] });
		await expect
			.element(
				screen.getByTestId("kilo-providers-row-amazon-bedrock").getByText("System credentials"),
			)
			.toBeVisible();
		await screen.getByTestId("kilo-providers-toggle-amazon-bedrock").click();
		await expect
			.element(
				screen.getByText(
					"Amazon Bedrock is connected using credentials already available on this machine, not a stored API key.",
				),
			)
			.toBeVisible();
		await expect.element(screen.getByText("AWS_PROFILE")).toBeVisible();
		await expect.element(screen.getByText("AWS_ACCESS_KEY_ID")).not.toBeInTheDocument();
	});

	it("disables provider actions while a change is pending", async () => {
		const { screen, hangNext } = await renderList({
			aiProviders: aiProviders(["openai", "anthropic"]),
		});
		hangNext("disconnectAiProvider");
		await screen.getByRole("button", { name: "Delete OpenAI" }).click();
		await expect.element(screen.getByTestId("kilo-providers-delete-anthropic")).toBeDisabled();
		await expect.element(screen.getByTestId("kilo-providers-add-provider")).toBeDisabled();
	});

	it("clears an earlier error when a later provider action succeeds", async () => {
		const { screen, failNext, methods } = await renderList({
			aiProviders: aiProviders(["openai", "anthropic"]),
		});
		failNext("disconnectAiProvider", new KernelError("BUSINESS", "credential store unavailable"));
		await screen.getByTestId("kilo-providers-delete-openai").click();
		await expect
			.element(screen.getByTestId("kilo-providers-error"))
			.toHaveTextContent("credential store unavailable");

		await screen.getByTestId("kilo-providers-delete-anthropic").click();
		await vi.waitFor(() => expect(methods.disconnectAiProvider).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByTestId("kilo-providers-error")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-providers-row-anthropic"))
			.not.toBeInTheDocument();
	});

	it("follows AI providers kilo.core reads later", async () => {
		const { screen, setProviders } = await renderList();
		await expect.element(screen.getByTestId("kilo-providers-inventory")).not.toBeInTheDocument();

		setProviders(aiProviders(["deepseek"]));

		await expect.element(screen.getByTestId("kilo-providers-row-deepseek")).toBeVisible();
	});
});
