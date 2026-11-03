/**
 * kilo.local-inference in main: the Local Model Server — GGUF models served by
 * one managed llama.cpp router behind an OpenAI-compatible proxy, published to
 * Kilo as the `kilo-desktop-model-server` provider.
 *
 * Ownership and lifecycle:
 * - `LocalInferenceService` reconciles the registry (kv `models`, origin's),
 *   the router, the proxy and the provider entry, as in origin. Activation
 *   refreshes the registry and publishes the entry (the proxy listens, no
 *   process yet), so kilo.agent's first config sync already has it.
 * - The router process belongs to the `router` kernel service
 *   (`window-shown`, its own restart): starting it lets the service run the
 *   router when models are registered; stopping it (quit, or a restart from
 *   Diagnostics) stops the router and the proxy. `prepare`, `connect` and the
 *   proxy's model loads ask `kernel/services` for it first, so a failed start
 *   shows in Diagnostics. llama.cpp comes from a conda environment
 *   kilo.environments' `conda-runtime` owns (or `LOCAL_LLAMA_SERVER_PATH`).
 * - The provider entry is a `kilo.agent/model-provider` source and the
 *   router's API key a `runtime-config` env var; kilo.agent writes and
 *   restarts, so nothing here re-registers when the server restarts.
 * - `kilo.local-inference/local-inference` mirrors status, models and catalog
 *   downloads as state; its methods are origin's contract. The catalog reads
 *   the Anaconda API key and site from kilo.anaconda-account's `account`
 *   (asking to sign in when there is none, or the plugin is absent) and drops
 *   its cached catalog when that account changes. It is behind the
 *   `local-model-catalog` flag.
 * - Origin's saved registry and downloaded models are taken over once
 *   (`import-origin`); Anaconda Desktop's models are imported once by the
 *   `import` task.
 */
import path from "node:path";

import {
	definePlugin,
	KernelError,
	KernelService,
	KernelServices,
	mainHost,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { AgentTool, ModelProvider, RuntimeConfigPoint } from "@kilo-desktop/plugin-agent/contracts";
import { AnacondaAccount } from "@kilo-desktop/plugin-anaconda-account/contracts";
import { CondaRuntime, condaExecutable } from "@kilo-desktop/plugin-environments/contracts";

import {
	LOCAL_PROVIDER_ID,
	LocalInference,
	ROUTER_SERVICE_KEY,
	type LocalInferenceState,
} from "../contracts/index.js";
import { ModelCatalogService } from "./catalog/ModelCatalogService.js";
import { ModelDownloadManager } from "./catalog/ModelDownloadManager.js";
import { importOriginLocalInference, type OriginLocalInferenceStore } from "./import-origin.js";
import { LocalInferenceService } from "./inference/LocalInferenceService.js";
import { importAnacondaDesktopModels } from "./integrations/anaconda-desktop.js";
import { LLAMA_API_KEY_ENV } from "./integrations/kilo-constants.js";
import { createKiloProvider } from "./kilo-provider.js";
import { LocalModelRegistry } from "./models/LocalModelRegistry.js";
import { allocateLoopbackPort } from "./runtime/allocatePort.js";
import {
	LlamaRouterManager,
	type LlamaRouterManagerOptions,
} from "./runtime/LlamaRouterManager.js";
import { LocalChatProxy, type LocalChatProxyOptions } from "./runtime/LocalChatProxy.js";
import {
	readLlamaHost,
	resolveLlamaExecutable,
	type LlamaCondaRuntime,
} from "./runtime/llamaRuntime.js";
import {
	createHardwareProfileReader,
	type HardwareProfileReader,
} from "./system/hardware-profile.js";
import {
	createLocalInferenceUsageCollector,
	type LocalInferenceUsageCollector,
} from "./system/resourceUsage.js";
import { localInferenceTools } from "./tools.js";

type Router = ConstructorParameters<typeof LocalInferenceService>[0]["router"];
type Proxy = ConstructorParameters<typeof LocalInferenceService>[0]["proxy"];

export interface LocalInferenceMainOptions {
	/** Origin's storage folder, whose registry and models are taken over once. */
	readonly originStorageDir?: (storageDir: string) => string;
	readonly createRouter?: (options: LlamaRouterManagerOptions) => Router;
	readonly createProxy?: (options: LocalChatProxyOptions) => Proxy;
	readonly hardwareProfile?: HardwareProfileReader;
	readonly usage?: () => LocalInferenceUsageCollector;
	readonly importAnacondaDesktopModels?: typeof importAnacondaDesktopModels;
	readonly networkInterfaces?: ConstructorParameters<
		typeof LocalInferenceService
	>[0]["networkInterfaces"];
}

/** The Anaconda site when no account says otherwise, as in origin. */
const DEFAULT_ANACONDA_DOMAIN = "anaconda.com";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const asKernelError = (error: unknown) =>
	error instanceof KernelError ? error : new KernelError("BUSINESS", errorMessage(error));

async function guarded<T>(operation: () => Promise<T> | T): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw asKernelError(error);
	}
}

function condaRuntime(sdk: PluginSdk): LlamaCondaRuntime | null {
	const runtime = sdk.domains.get(CondaRuntime);
	if (!runtime) return null;
	return {
		ensureEnvironment: (input) =>
			runtime.methods.ensureEnvironment({
				name: input.name,
				packages: [...input.packages],
				...(input.channels ? { channels: [...input.channels] } : {}),
			}),
		executable: (prefixPath, name) =>
			condaExecutable(prefixPath, name, process.platform === "win32" ? "win32" : "other"),
	};
}

export function createLocalInferenceMainEntry(
	options: LocalInferenceMainOptions = {},
): PluginEntry {
	return definePlugin({
		async activate(sdk) {
			const host = mainHost(sdk);
			const storageDir = host.storage.dir;
			const modelsDir = path.join(storageDir, "models");
			const store = host.storage.kv<OriginLocalInferenceStore>({
				namespace: "models",
				defaults: { models: [] },
			});
			const originDir = options.originStorageDir?.(storageDir);
			if (originDir) {
				await importOriginLocalInference({ originDir, storageDir, store }).catch((error) =>
					sdk.logger.warn(
						`Could not import local models from ${originDir}; will try again next launch: ${errorMessage(error)}`,
					),
				);
			}
			const registry = new LocalModelRegistry(store);

			let sync = () => {};
			const ensureRouter = async () => {
				// A failed start shows in Diagnostics; the caller still gets the service's own answer.
				await sdk.domains
					.get(KernelServices)
					?.methods.ensureStarted({ key: ROUTER_SERVICE_KEY })
					.catch(() => undefined);
			};

			const routerOptions: LlamaRouterManagerOptions = {
				storageDir,
				resolveExecutable: async () => {
					const overridePath = process.env["LOCAL_LLAMA_SERVER_PATH"];
					return resolveLlamaExecutable({
						conda: condaRuntime(sdk),
						host: await readLlamaHost(),
						logger: sdk.logger,
						...(overridePath ? { overridePath } : {}),
					});
				},
				allocatePort: allocateLoopbackPort,
				fetch: host.net.fetch,
				logger: sdk.logger,
				onStatusChange: () => sync(),
			};
			const router = (options.createRouter ?? ((o) => new LlamaRouterManager(o)))(routerOptions);
			const settingsFor = (modelId: string) =>
				registry.list().find((model) => model.id === modelId)?.settings;
			const proxyOptions: LocalChatProxyOptions = {
				apiKey: router.apiKey,
				allocatePort: allocateLoopbackPort,
				fetch: host.net.fetch,
				logger: sdk.logger,
				prepareModel: async (modelId) => {
					await ensureRouter();
					await service.prepareModel(modelId);
				},
				getSamplingSettings: settingsFor,
				getIncludeKiloContext: (modelId) => settingsFor(modelId)?.includeKiloContext,
			};
			const proxy = (options.createProxy ?? ((o) => new LocalChatProxy(o)))(proxyOptions);
			const provider = createKiloProvider();
			const service = new LocalInferenceService({
				registry,
				managedModelsDir: modelsDir,
				...(originDir ? { originModelsDir: path.join(originDir, "models") } : {}),
				router,
				proxy,
				getKilo: () => provider.kilo,
				emit: () => sync(),
				logger: sdk.logger,
				startHalted: true,
				...(options.networkInterfaces ? { networkInterfaces: options.networkInterfaces } : {}),
			});
			const usage = (options.usage ?? createLocalInferenceUsageCollector)();
			const hardware = options.hardwareProfile ?? createHardwareProfileReader();
			const anaconda = () => sdk.domains.get(AnacondaAccount);
			const catalog = new ModelCatalogService(
				{
					fetch: host.net.fetch,
					getApiKey: async () =>
						(await anaconda()
							?.methods.apiKey(undefined)
							.catch((error: unknown) => {
								sdk.logger.warn(`Could not read the Anaconda API key: ${errorMessage(error)}`);
								return null;
							})) ?? null,
					getSiteDomain: async () =>
						(await anaconda()
							?.methods.siteDomain(undefined)
							.catch(() => undefined)) ?? DEFAULT_ANACONDA_DOMAIN,
				},
				() => hardware.read(),
			);
			let stopFollowingAccount: (() => void) | undefined;
			sdk.onDispose(
				sdk.domains.track(AnacondaAccount, {
					added: (account) => {
						stopFollowingAccount = account.on("changed", () => catalog.invalidate());
					},
					removed: () => {
						stopFollowingAccount?.();
						catalog.invalidate();
					},
				}),
			);
			sdk.onDispose(() => stopFollowingAccount?.());
			const downloads = new ModelDownloadManager({
				modelsDir,
				fetch: host.net.fetch,
				resolveArtifact: (identity) => catalog.resolveArtifact(identity),
				resolveDownloadUrl: (artifact, signal) => catalog.downloadUrl(artifact, signal),
				addModel: (input) => service.add(input),
				emit: () => sync(),
				logger: sdk.logger,
			});

			const snapshot = (): LocalInferenceState => ({
				status: service.status,
				models: service.list(),
				downloads: downloads.list(),
			});
			const domain = sdk.domains.provide(LocalInference, {
				initialState: snapshot(),
				methods: {
					status: () => service.status,
					listModels: () => service.list(),
					addModel: (input) => guarded(() => service.add(input)),
					removeModel: async ({ id, mode }) => {
						const removed = await guarded(() => service.remove(id, mode));
						if (!removed) throw new KernelError("NOT_FOUND", "Local model not found.");
						return { ok: true as const };
					},
					updateModel: ({ id, settings }) =>
						guarded(() => {
							try {
								return service.update(id, settings);
							} catch (error) {
								if (errorMessage(error) === "Local model not found.") {
									throw new KernelError("NOT_FOUND", "Local model not found.");
								}
								throw error;
							}
						}),
					prepare: async ({ modelId }) => {
						try {
							await ensureRouter();
							await service.prepareModel(modelId);
							return { ok: true as const };
						} catch (error) {
							sdk.logger.warn(`Could not prepare local model "${modelId}": ${errorMessage(error)}`);
							throw new KernelError("BUSINESS", "The local model could not be prepared.");
						}
					},
					connect: () =>
						guarded(async () => {
							await ensureRouter();
							await service.connect();
							return { ok: true as const };
						}),
					disconnect: () =>
						guarded(async () => {
							await service.disconnect();
							return { ok: true as const };
						}),
					retry: () => {
						service.retry();
						return { ok: true as const };
					},
					settings: () => service.serverSettings(),
					updateSettings: (input) => guarded(() => service.updateServerSettings(input)),
					usage: () => usage.read(),
					hardwareProfile: () => hardware.read(),
					listCatalog: () => guarded(() => catalog.list()),
					listDownloads: () => downloads.list(),
					startDownload: (input) => guarded(() => downloads.start(input)),
					cancelDownload: (input) => guarded(() => downloads.cancel(input)),
				},
			});
			sync = () => domain.setState(snapshot());

			sdk.extensions.implement(ModelProvider, "local-model-server", provider.source);
			sdk.extensions.implement(RuntimeConfigPoint, "local-model-server", {
				read: () => ({ env: { [LLAMA_API_KEY_ENV]: router.apiKey } }),
			});
			sdk.extensions.implement(KernelService, "router", {
				start: () => service.start(),
				stop: () => service.stop(),
			});
			const importModels = options.importAnacondaDesktopModels ?? importAnacondaDesktopModels;
			sdk.extensions.implement(KernelService, "import", {
				start: async () => {
					if (registry.isAnacondaDesktopModelsImported()) return;
					try {
						await importModels((input) => service.add(input), sdk.logger);
						registry.setAnacondaDesktopModelsImported(true);
					} catch (error) {
						sdk.logger.error(`Failed to import Anaconda Desktop models: ${errorMessage(error)}`);
					}
				},
			});
			for (const [id, tool] of Object.entries(
				localInferenceTools({ openSettings: () => domain.emit("settings-requested", {}) }),
			)) {
				sdk.extensions.implement(AgentTool, id, tool);
			}

			sdk.onDispose(async () => {
				usage.dispose();
				await downloads.dispose();
				service.dispose();
			});

			try {
				await downloads.initialize();
				await registry.adoptLegacyManagedFiles(modelsDir);
			} catch (error) {
				sdk.logger.warn(`Could not prepare the local models folder: ${errorMessage(error)}`);
			}
			await service.initialize().catch((error) => {
				sdk.logger.error(`Local inference initialization failed: ${errorMessage(error)}`);
			});
			sync();
			sdk.logger.info(`Local inference publishes the "${LOCAL_PROVIDER_ID}" provider.`);
		},
	});
}
