import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelError,
	KernelServices,
	type DomainProvider,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestKernelPair,
	testPlugin,
} from "@kilo-desktop/kernel/testing";
import {
	AgentTool,
	ModelProvider,
	RuntimeConfigPoint,
	type ToolCallContext,
} from "@kilo-desktop/plugin-agent/contracts";

import anacondaManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json";
import {
	ANACONDA_ACCOUNT_DEFINITIONS,
	AnacondaAccount,
} from "@kilo-desktop/plugin-anaconda-account/contracts";

import manifest from "../../plugin.json";
import {
	LOCAL_INFERENCE_DEFINITIONS,
	LOCAL_PROVIDER_ID,
	LocalInference,
	ROUTER_SERVICE_KEY,
	type LocalModel,
} from "../contracts/index.js";
import { createLocalInferenceMainEntry, type LocalInferenceMainOptions } from "./entry.js";
import type { LlamaRouterStatus } from "./runtime/LlamaRouterManager.js";

const WAIT = { timeout: 5_000 };

const agentPoints = testPlugin("kilo.agent", {
	manifest: {
		extensionPoints: [
			{ id: "tool", kind: "additive" },
			{ id: "runtime-config", kind: "additive" },
			{ id: "model-provider", kind: "additive" },
		],
	},
	definitions: { extensionPoints: [AgentTool, RuntimeConfigPoint, ModelProvider] },
});

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "local-inference-"));
	directories.push(dir);
	return dir;
}

function fakeRouter() {
	let status: LlamaRouterStatus = { status: "idle" };
	let onStatusChange: (status: LlamaRouterStatus) => void = () => {};
	const setStatus = (next: LlamaRouterStatus) => {
		status = next;
		onStatusChange(next);
	};
	const ensureRunning = vi.fn(async (models: readonly LocalModel[]) => {
		if (models.length === 0) {
			setStatus({ status: "idle" });
			return null;
		}
		setStatus({ status: "ready", loadedModelIds: [] });
		return { baseUrl: "http://127.0.0.1:41000", port: 41_000 };
	});
	const prepareModel = vi.fn(async (modelId: string) => {
		setStatus({ status: "ready", loadedModelId: modelId, loadedModelIds: [modelId] });
	});
	return {
		ensureRunning,
		prepareModel,
		dispose: vi.fn(),
		create: ((options) => {
			onStatusChange = options.onStatusChange ?? (() => {});
			return {
				apiKey: "router-secret",
				get status() {
					return status;
				},
				ensureRunning,
				restart: ensureRunning,
				prepareModel,
				dispose: () => undefined,
			};
		}) satisfies NonNullable<LocalInferenceMainOptions["createRouter"]>,
	};
}

function fakeProxy() {
	let port: number | undefined;
	const connection = () => {
		port = 42_000;
		return Promise.resolve({ baseUrl: "http://127.0.0.1:42000", port: 42_000 });
	};
	const close = vi.fn(() => {
		port = undefined;
	});
	return {
		close,
		create: (() => ({
			get port() {
				return port;
			},
			ensureListening: connection,
			ensureRunning: connection,
			close,
		})) satisfies NonNullable<LocalInferenceMainOptions["createProxy"]>,
	};
}

async function gguf(dir: string, name: string): Promise<string> {
	const file = path.join(dir, name);
	await writeFile(file, "GGUF");
	return file;
}

async function boot(
	options: Partial<LocalInferenceMainOptions> & {
		readonly storageDir?: string;
		/** False keeps the window hidden, so window-shown services stay idle. */
		readonly windowShown?: boolean;
		readonly fetch?: typeof globalThis.fetch;
		readonly plugins?: readonly PluginRegistration[];
	} = {},
) {
	const { storageDir: givenDir, windowShown, fetch, plugins, ...entryOptions } = options;
	const storageDir = givenDir ?? (await temporaryDirectory());
	const storage = createMemoryStorage(storageDir);
	const router = fakeRouter();
	const proxy = fakeProxy();
	const importModels = vi.fn(async () => undefined);
	const registrations: PluginRegistration[] = [
		agentPoints,
		...(plugins ?? []),
		{
			manifest,
			definitions: LOCAL_INFERENCE_DEFINITIONS,
			entry: createLocalInferenceMainEntry({
				createRouter: router.create,
				createProxy: proxy.create,
				hardwareProfile: {
					read: async () => ({
						name: "Test machine",
						kind: "unified-memory",
						accelerator: "metal",
						memoryTotalBytes: 16 * 1024 ** 3,
						systemMemoryTotalBytes: 16 * 1024 ** 3,
						memoryBandwidthGBps: 100,
					}),
				},
				usage: () => ({
					read: async () => ({
						system: {
							cpuPercent: 1,
							cpuSpeedGHz: null,
							gpuMemoryUsedBytes: null,
							gpuMemoryTotalBytes: null,
							memoryUsedBytes: 1,
							memoryTotalBytes: 2,
						},
					}),
					dispose: () => undefined,
				}),
				importAnacondaDesktopModels: importModels,
				...entryOptions,
			}),
		},
	];
	const { main } = await createTestKernelPair({
		main: registrations,
		renderer: [
			{
				manifest,
				definitions: LOCAL_INFERENCE_DEFINITIONS,
				entry: definePlugin({ activate() {} }),
			},
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id ? { storage, net: { fetch: fetch ?? globalThis.fetch } } : {},
	});
	if (windowShown !== false) await main.windowShown();
	await main.flush();
	const domain = main.kernelSdk.domains.get(LocalInference)!;
	const contribution = <T extends { key: string }>(list: readonly T[], id: string) =>
		list.find((candidate) => candidate.key === `${manifest.id}/${id}`)!;
	const provider = () =>
		contribution(main.kernelSdk.extensions.list(ModelProvider), "local-model-server");
	return { main, storage, storageDir, router, proxy, importModels, domain, provider, contribution };
}

describe("kilo.local-inference in main", () => {
	it("publishes registered models as Kilo's provider before the router runs", async () => {
		const storageDir = await temporaryDirectory();
		const modelsDir = await temporaryDirectory();
		const file = await gguf(modelsDir, "tiny.gguf");
		const host = await boot({ storageDir, windowShown: false });

		await host.domain.methods.addModel({ path: file });

		await vi.waitFor(() => {
			const entry = host.provider().implementation!.read() as {
				options: { baseURL: string };
				models: Record<string, unknown>;
			};
			expect(entry.options.baseURL).toBe("http://127.0.0.1:42000/v1");
			expect(Object.keys(entry.models)).toHaveLength(1);
		}, WAIT);
		expect(host.provider().metadata.providerId).toBe(LOCAL_PROVIDER_ID);
		expect(host.router.ensureRunning).not.toHaveBeenCalledWith(
			expect.arrayContaining([expect.anything()]),
			expect.anything(),
		);
		const env = host.contribution(
			host.main.kernelSdk.extensions.list(RuntimeConfigPoint),
			"local-model-server",
		);
		expect(env.implementation!.read()).toEqual({
			env: { ANACONDA_LOCAL_LLAMA_API_KEY: "router-secret" },
		});
		expect(host.domain.getState().models.map((model) => model.name)).toEqual(["tiny"]);
	});

	it("starts the router through its kernel service and loads a model on prepare", async () => {
		const modelsDir = await temporaryDirectory();
		const host = await boot();
		const model = await host.domain.methods.addModel({ path: await gguf(modelsDir, "a.gguf") });

		await host.domain.methods.prepare({ modelId: model.id });

		expect(host.router.prepareModel).toHaveBeenCalledWith(model.id, expect.any(Array));
		await vi.waitFor(
			() =>
				expect(host.domain.getState().status).toMatchObject({
					status: "ready",
					loadedModelId: model.id,
				}),
			WAIT,
		);
		const services = host.main.kernelSdk.domains.get(KernelServices)!;
		expect(services.getState().services[ROUTER_SERVICE_KEY]?.status).toBe("ready");
	});

	it("reports a model that cannot be prepared", async () => {
		const host = await boot();
		host.router.prepareModel.mockRejectedValueOnce(new Error("boom"));
		const model = await host.domain.methods.addModel({
			path: await gguf(await temporaryDirectory(), "b.gguf"),
		});

		await expect(host.domain.methods.prepare({ modelId: model.id })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "The local model could not be prepared.",
		});
	});

	it("stops the router and the proxy when its service restarts, then serves again", async () => {
		const host = await boot();
		const model = await host.domain.methods.addModel({
			path: await gguf(await temporaryDirectory(), "c.gguf"),
		});
		await host.domain.methods.prepare({ modelId: model.id });
		const services = host.main.kernelSdk.domains.get(KernelServices)!;

		host.router.ensureRunning.mockClear();

		await services.methods.restart({ key: ROUTER_SERVICE_KEY });

		expect(host.proxy.close).toHaveBeenCalled();
		expect(host.router.ensureRunning).toHaveBeenCalledWith([]);
		await vi.waitFor(
			() =>
				expect(host.router.ensureRunning).toHaveBeenLastCalledWith(
					[expect.objectContaining({ id: model.id })],
					expect.anything(),
				),
			WAIT,
		);
	});

	it("turns removal, update and server settings into the domain object's answers", async () => {
		const host = await boot();
		const model = await host.domain.methods.addModel({
			path: await gguf(await temporaryDirectory(), "d.gguf"),
		});

		await expect(
			host.domain.methods.updateModel({ id: "missing", settings: { temperature: 0.2 } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			host.domain.methods.updateModel({ id: model.id, settings: { temperature: 0.2 } }),
		).resolves.toMatchObject({ settings: { temperature: 0.2 } });
		await expect(
			host.domain.methods.removeModel({ id: "missing", mode: "registry-only" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(host.domain.methods.updateSettings({ port: 8124 })).resolves.toMatchObject({
			port: 8124,
		});
		await expect(host.domain.methods.settings(undefined)).resolves.toMatchObject({ port: 8124 });
		await expect(host.domain.methods.listModels(undefined)).resolves.toHaveLength(1);
		await expect(host.domain.methods.usage(undefined)).resolves.toMatchObject({
			system: { cpuPercent: 1 },
		});
		await expect(host.domain.methods.hardwareProfile(undefined)).resolves.toMatchObject({
			name: "Test machine",
		});
		await expect(host.domain.methods.listDownloads(undefined)).resolves.toEqual([]);
		await expect(host.domain.methods.listCatalog(undefined)).rejects.toMatchObject({
			code: "BUSINESS",
		});
		await expect(
			host.domain.methods.removeModel({ id: model.id, mode: "registry-only" }),
		).resolves.toEqual({ ok: true });
		await vi.waitFor(() => expect(host.domain.getState().models).toEqual([]), WAIT);
		await vi.waitFor(() => expect(host.provider().implementation!.read()).toBeUndefined(), WAIT);
	});

	it("disconnects, connects and retries the server", async () => {
		const host = await boot();
		await host.domain.methods.addModel({
			path: await gguf(await temporaryDirectory(), "e.gguf"),
		});

		await host.domain.methods.disconnect(undefined);
		await vi.waitFor(
			() => expect(host.domain.getState().status).toEqual({ status: "disconnected" }),
			WAIT,
		);
		await host.domain.methods.connect(undefined);
		await expect(host.domain.methods.status(undefined)).resolves.not.toEqual({
			status: "disconnected",
		});
		await expect(host.domain.methods.retry(undefined)).resolves.toEqual({ ok: true });
	});

	it("imports Anaconda Desktop models once the window shows", async () => {
		const host = await boot();
		await vi.waitFor(() => expect(host.importModels).toHaveBeenCalledOnce(), WAIT);
		expect(host.storage.saved.get("models")).toMatchObject({ anacondaDesktopModelsImported: true });
	});

	it("asks a window to open its settings when the agent calls its tool", async () => {
		const host = await boot();
		const requested = vi.fn();
		host.domain.on("settings-requested", requested);
		const tool = host.contribution(host.main.kernelSdk.extensions.list(AgentTool), "settings.open");
		const context: ToolCallContext = {
			sessionId: null,
			chatId: null,
			callId: null,
			external: false,
			signal: new AbortController().signal,
		};

		await expect(tool.implementation!.run({}, context)).toEqual({ opened: true });
		await host.main.flush();

		await vi.waitFor(() => expect(requested).toHaveBeenCalledOnce(), WAIT);
	});

	it("takes over origin's registry and downloaded models once", async () => {
		const root = await temporaryDirectory();
		const originDir = path.join(root, "local-inference");
		const storageDir = path.join(root, "kilo.local-inference");
		await mkdir(path.join(originDir, "models"), { recursive: true });
		await mkdir(storageDir, { recursive: true });
		const downloaded = path.join(originDir, "models", "qwen.gguf");
		await writeFile(downloaded, "GGUF");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({
				models: [
					{
						id: "qwen-1",
						name: "Qwen",
						path: downloaded,
						available: true,
						addedAt: 1,
						managedFile: true,
					},
				],
				enabled: false,
				settings: { port: 8123 },
				anacondaDesktopModelsImported: true,
			}),
		);

		const host = await boot({
			storageDir,
			originStorageDir: (dir) => path.join(dir, "..", "local-inference"),
		});

		expect(host.domain.getState().models).toEqual([
			expect.objectContaining({
				id: "qwen-1",
				path: path.join(storageDir, "models", "qwen.gguf"),
				available: true,
			}),
		]);
		await expect(host.domain.methods.settings(undefined)).resolves.toMatchObject({ port: 8123 });
		expect(host.storage.saved.get("models")).toMatchObject({ importedFromOrigin: true });
	});

	describe("the model catalog's Anaconda key", () => {
		/** kilo.anaconda-account's domain object, answering only kilo.local-inference. */
		function anacondaAccount(apiKey: string | null) {
			let account!: DomainProvider<typeof AnacondaAccount>;
			const registration: PluginRegistration = {
				manifest: anacondaManifest,
				definitions: ANACONDA_ACCOUNT_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						account = sdk.domains.provide(AnacondaAccount, {
							initialState: { session: { status: "anonymous" }, signingIn: false },
							methods: {
								session: () => account.state.session,
								refresh: () => account.state.session,
								signIn: () => ({ ok: true as const }),
								cancelSignIn: () => undefined,
								signOut: () => ({ ok: true as const }),
								apiKey: (_input, caller) => {
									if (caller.pluginId !== manifest.id) {
										throw new KernelError("PERMISSION_DENIED", "Not for you.");
									}
									return apiKey;
								},
								siteDomain: () => "anaconda.test",
							},
						});
					},
				}),
			};
			return { registration };
		}

		const forbidden = () => new Response("", { status: 403 });

		it("fetches the catalog from the account's site with its API key", async () => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () => forbidden());
			const host = await boot({ fetch, plugins: [anacondaAccount("anaconda-key").registration] });

			await expect(host.domain.methods.listCatalog(undefined)).rejects.toMatchObject({
				message: "Your Anaconda account does not have access to the model catalog.",
			});
			expect(fetch).toHaveBeenCalledWith(
				"https://anaconda.test/api/ai/model/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer anaconda-key" }),
				}),
			);
		});

		it("asks to sign in when the account has no key", async () => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () => forbidden());
			const host = await boot({ fetch, plugins: [anacondaAccount(null).registration] });

			await expect(host.domain.methods.listCatalog(undefined)).rejects.toMatchObject({
				message: "Sign in to your Anaconda account (Settings → Account) to view the model catalog.",
			});
			expect(fetch).not.toHaveBeenCalled();
		});

		it("asks to sign in when kilo.anaconda-account is not installed", async () => {
			const fetch = vi.fn<typeof globalThis.fetch>(async () => forbidden());
			const host = await boot({ fetch });

			await expect(host.domain.methods.listCatalog(undefined)).rejects.toMatchObject({
				message: "Sign in to your Anaconda account (Settings → Account) to view the model catalog.",
			});
			expect(fetch).not.toHaveBeenCalled();
		});
	});
});
