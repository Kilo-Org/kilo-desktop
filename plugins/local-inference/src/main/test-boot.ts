// Boots kilo.local-inference's main entry on a real main kernel (and a
// window), with stand-ins under the real manifests: kilo.core (its points, no
// server) and kilo.shell (its points, and a `navigation` recording what it is
// asked to open). The router and the proxy are fakes; catalogs and llama.cpp
// runtimes are stand-in contributions (src/main/test-catalog.ts and
// `runtimeStandIn`). Any stand-in can be left out to check
// kilo.local-inference works without it.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { definePlugin, type KernelLogger, type PluginRegistration } from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestKernelPair,
	testPlugin,
} from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	AiProviderPoint,
	CORE_DEFINITIONS,
	Tool,
	type ToolCallContext,
} from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { Navigation, SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import {
	LlamaRuntime,
	LOCAL_INFERENCE_DEFINITIONS,
	LOCAL_INFERENCE_PLUGIN_ID,
	LocalModels,
	ModelServer,
	type LocalModel,
} from "../contracts";
import { createLocalInferenceMainEntry, type LocalInferenceMainOptions } from "./entry";
import type { LlamaRouterManagerOptions, LlamaRouterStatus } from "./runtime/LlamaRouterManager";

export const WAIT = { timeout: 5_000 };

const kernels: { stop(): Promise<void> }[] = [];
const directories: string[] = [];

/** Stops every kernel and removes every folder made since the last call (an `afterEach`). */
export async function stopLocalInferenceMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function temporaryDirectory(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "local-inference-"));
	directories.push(dir);
	return dir;
}

export async function gguf(dir: string, name: string): Promise<string> {
	const file = path.join(dir, name);
	await writeFile(file, "GGUF");
	return file;
}

/** The router: running when models are registered, loading what `prepare` asks for. */
export function fakeRouter() {
	let status: LlamaRouterStatus = { status: "idle" };
	let onStatusChange: (status: LlamaRouterStatus) => void = () => {};
	let options: LlamaRouterManagerOptions | undefined;
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
		/** How the entry asks for llama.cpp. */
		resolveExecutable: () => options!.resolveExecutable(),
		create: ((given) => {
			options = given;
			onStatusChange = given.onStatusChange ?? (() => {});
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

export function fakeProxy() {
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

/** A plugin contributing one way to get llama.cpp. */
export function runtimeStandIn(
	pluginId: string,
	resolveExecutable: () => Promise<string>,
	options: { readonly title?: string; readonly priority?: number } = {},
): PluginRegistration {
	return testPlugin(pluginId, {
		manifest: {
			requires: { [LlamaRuntime.id]: "optional" },
			contributes: {
				extensions: {
					[LlamaRuntime.id]: [
						{
							id: "runtime",
							title: options.title ?? pluginId,
							...(options.priority === undefined ? {} : { priority: options.priority }),
						},
					],
				},
			},
		},
		entry: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(LlamaRuntime, "runtime", { resolveExecutable });
			},
		}),
	});
}

/** kilo.shell with only its `navigation`, recording the settings sections it is asked to open. */
function shellStandIn(openSettings: (section: string | undefined) => void): PluginRegistration {
	const unused = () => undefined;
	return {
		manifest: shellManifest,
		definitions: SHELL_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Navigation, {
					initialState: { windows: {} },
					methods: {
						navigate: unused,
						openSettings: ({ section }) => openSettings(section),
						goHome: unused,
						openDialog: unused,
						reportLocation: unused,
					},
				});
			},
		}),
	};
}

export interface BootOptions extends Partial<LocalInferenceMainOptions> {
	readonly storageDir?: string;
	/** False keeps the window hidden, so window-shown services stay idle. */
	readonly windowShown?: boolean;
	readonly fetch?: typeof globalThis.fetch;
	/** More plugins, e.g. catalog and runtime stand-ins. */
	readonly plugins?: readonly PluginRegistration[];
	readonly withoutCore?: boolean;
	readonly withoutShell?: boolean;
	readonly logger?: KernelLogger;
}

/** kilo.local-inference's main entry with its stand-ins, and a window. */
export async function bootLocalInferenceMain(options: BootOptions = {}) {
	const {
		storageDir: givenDir,
		windowShown,
		fetch,
		plugins,
		withoutCore,
		withoutShell,
		logger,
		...entryOptions
	} = options;
	const storageDir = givenDir ?? (await temporaryDirectory());
	const storage = createMemoryStorage(storageDir);
	const router = fakeRouter();
	const proxy = fakeProxy();
	const importModels = vi.fn(async () => undefined);
	const openSettings = vi.fn<(section: string | undefined) => void>();
	const core: PluginRegistration = { manifest: coreManifest, definitions: CORE_DEFINITIONS };
	const shell: PluginRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };
	const { main } = await createTestKernelPair({
		main: [
			...(withoutCore ? [] : [{ ...core, entry: definePlugin({ activate() {} }) }]),
			...(withoutShell ? [] : [shellStandIn(openSettings)]),
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
		],
		renderer: [
			...(withoutCore ? [] : [core]),
			...(withoutShell ? [] : [shell]),
			{
				manifest,
				definitions: LOCAL_INFERENCE_DEFINITIONS,
				entry: definePlugin({ activate() {} }),
			},
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { storage, net: { fetch: fetch ?? globalThis.fetch } }
				: { storage: createMemoryStorage(`/memory/${pluginId}`) },
		...(logger ? { logger } : {}),
	});
	kernels.push(main);
	if (windowShown !== false) await main.windowShown();
	await main.flush();
	const models = main.kernelSdk.domainObjects.get(LocalModels)!;
	const server = main.kernelSdk.domainObjects.get(ModelServer)!;
	const own = <T extends { key: string }>(list: readonly T[], id: string) =>
		list.find((candidate) => candidate.key === `${LOCAL_INFERENCE_PLUGIN_ID}/${id}`);
	const provider = () => own(main.kernelSdk.extensions.list(AiProviderPoint), "local-model-server");
	const tool = (id: string) => own(main.kernelSdk.extensions.list(Tool), id);
	const callTool = (id: string, input: unknown = {}) => {
		const context: ToolCallContext = {
			chatId: null,
			workSessionId: null,
			workspaceId: null,
			callId: null,
			external: false,
			signal: new AbortController().signal,
		};
		const { implementation } = tool(id)!;
		return Promise.resolve().then(() =>
			implementation!.run(implementation!.input.parse(input), context),
		);
	};
	return {
		main,
		storage,
		storageDir,
		router,
		proxy,
		importModels,
		openSettings,
		models,
		server,
		provider,
		tool,
		callTool,
	};
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}
