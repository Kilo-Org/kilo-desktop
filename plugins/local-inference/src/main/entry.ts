/**
 * kilo.local-inference in main: the Local Model Server — GGUF models served by
 * one managed llama.cpp router behind an OpenAI-compatible proxy, offered to
 * Kilo as the `kilo-desktop-model-server` AI provider.
 *
 * Ownership and lifecycle:
 * - `LocalInferenceService` reconciles the registry (kv `models`, origin's),
 *   the router, the proxy and the provider entry, as in origin. Activation
 *   refreshes the registry and publishes the entry (the proxy listens, no
 *   process yet), so kilo.core's first config sync already has it.
 * - The router process belongs to the `router` kernel service
 *   (`window-shown`, its own restart): starting it lets the service run the
 *   router when models are registered; stopping it (quit, or a restart from
 *   Diagnostics) stops the router and the proxy. `prepare`, `connect` and the
 *   proxy's model loads ask `kernel/services` for it first, so a failed start
 *   shows in Diagnostics. llama.cpp comes from `LOCAL_LLAMA_SERVER_PATH`, else
 *   the `kilo.local-inference/llama-runtime` contributions (e.g.
 *   kilo.environments' conda environment), read per start.
 * - The provider entry and the router's API key (its env) are one
 *   `kilo.core/ai-provider` source; kilo.core writes the config and restarts
 *   the server, so nothing here re-registers when the router restarts.
 * - Origin's single domain object is split in two, its methods kept:
 *   `local-models` (installed models) and `model-server` (status, catalog
 *   downloads and the catalog's access). One `sync` mirrors the service's
 *   state into both.
 * - The catalog is the highest-priority implemented
 *   `kilo.local-inference/model-catalog` contribution, followed live: the
 *   cached catalog is dropped whenever the chosen catalog changes or calls
 *   back (its account changed), and `model-server.catalog` shows its title and
 *   access (null without one). The catalog UI is behind the
 *   `local-model-catalog` flag (in the window).
 * - The `settings.open` agent tool asks kilo.shell's `navigation` to open the
 *   section (a no-op without kilo.shell).
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
	type Contribution,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { AiProviderPoint, Tool } from "@kilo-desktop/plugin-core/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import {
	LlamaRuntime,
	LOCAL_AI_PROVIDER_ID,
	LOCAL_MODEL_SERVER_CONTRIBUTION,
	LOCAL_MODEL_SERVER_SETTINGS_SECTION,
	LocalModels,
	ModelCatalogPoint,
	ModelServer,
	ROUTER_SERVICE_KEY,
	type LocalModelsState,
	type ModelCatalogAccess,
	type ModelCatalogSource,
	type ModelCatalogState,
	type ModelServerState,
} from "../contracts";
import { ModelCatalogService } from "./catalog/ModelCatalogService";
import { ModelDownloadManager } from "./catalog/ModelDownloadManager";
import { importOriginLocalInference, type OriginLocalInferenceStore } from "./import-origin";
import { LocalInferenceService } from "./inference/LocalInferenceService";
import { importAnacondaDesktopModels } from "./integrations/anaconda-desktop";
import { createKiloProvider } from "./kilo-provider";
import { LocalModelRegistry } from "./models/LocalModelRegistry";
import { allocateLoopbackPort } from "./runtime/allocatePort";
import { LlamaRouterManager, type LlamaRouterManagerOptions } from "./runtime/LlamaRouterManager";
import { LocalChatProxy, type LocalChatProxyOptions } from "./runtime/LocalChatProxy";
import { resolveLlamaExecutable } from "./runtime/llamaRuntime";
import { createHardwareProfileReader, type HardwareProfileReader } from "./system/hardware-profile";
import {
	createLocalInferenceUsageCollector,
	type LocalInferenceUsageCollector,
} from "./system/resourceUsage";
import { localInferenceTools } from "./tools";

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

const SIGN_IN_UNAVAILABLE = "Sign-in is unavailable.";

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

type CatalogContribution = Contribution<typeof ModelCatalogPoint> & {
	readonly implementation: ModelCatalogSource;
};

const isImplemented = <T extends { readonly implementation?: unknown }>(
	contribution: T,
): contribution is T & { readonly implementation: NonNullable<T["implementation"]> } =>
	contribution.implementation !== undefined;

function accessOf(source: ModelCatalogSource): ModelCatalogAccess {
	try {
		return source.access();
	} catch (error) {
		return { status: "error", reason: errorMessage(error) };
	}
}

/**
 * The highest-priority implemented `model-catalog` contribution, followed
 * live: `onChange` runs when the chosen catalog changes or calls back.
 */
function followCatalog(sdk: PluginSdk, onChange: () => void) {
	let chosen: CatalogContribution | undefined;
	let stopFollowingSource: (() => void) | undefined;
	const choose = () => {
		const next = sdk.extensions.list(ModelCatalogPoint).find(isImplemented);
		if (next?.key === chosen?.key && next?.implementation === chosen?.implementation) return;
		stopFollowingSource?.();
		chosen = next;
		stopFollowingSource = next?.implementation.subscribe?.(onChange);
		onChange();
	};
	choose();
	const stopFollowingPoint = sdk.extensions.subscribe(ModelCatalogPoint, choose);
	return {
		source: (): ModelCatalogSource | null => chosen?.implementation ?? null,
		state: (): ModelCatalogState =>
			chosen ? { title: chosen.metadata.title, access: accessOf(chosen.implementation) } : null,
		dispose: () => {
			stopFollowingPoint();
			stopFollowingSource?.();
		},
	};
}

/** llama.cpp from `LOCAL_LLAMA_SERVER_PATH`, else the `llama-runtime` contributions by priority. */
function resolveExecutable(sdk: PluginSdk): Promise<string> {
	const overridePath = process.env["LOCAL_LLAMA_SERVER_PATH"];
	return resolveLlamaExecutable({
		runtimes: sdk.extensions
			.list(LlamaRuntime)
			.filter(isImplemented)
			.map((contribution) => ({
				title: contribution.metadata.title,
				resolveExecutable: () => contribution.implementation.resolveExecutable(),
			})),
		logger: sdk.logger,
		...(overridePath ? { overridePath } : {}),
	});
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
				await sdk.domainObjects
					.get(KernelServices)
					?.methods.ensureStarted({ key: ROUTER_SERVICE_KEY })
					.catch(() => undefined);
			};

			const routerOptions: LlamaRouterManagerOptions = {
				storageDir,
				resolveExecutable: () => resolveExecutable(sdk),
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
			const provider = createKiloProvider(() => router.apiKey);
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
			const catalog = new ModelCatalogService(
				() => catalogSource.source(),
				() => hardware.read(),
			);
			const catalogSource = followCatalog(sdk, () => {
				catalog.invalidate();
				sync();
			});
			sdk.onDispose(() => catalogSource.dispose());
			const downloads = new ModelDownloadManager({
				modelsDir,
				fetch: host.net.fetch,
				resolveArtifact: (identity) => catalog.resolveArtifact(identity),
				resolveDownloadUrl: (artifact, signal) => catalog.downloadUrl(artifact, signal),
				addModel: (input) => service.add(input),
				emit: () => sync(),
				logger: sdk.logger,
			});

			const modelsSnapshot = (): LocalModelsState => ({ models: service.list() });
			const serverSnapshot = (): ModelServerState => ({
				status: service.status,
				downloads: downloads.list(),
				catalog: catalogSource.state(),
			});
			const models = sdk.domainObjects.provide(LocalModels, {
				initialState: modelsSnapshot(),
				methods: {
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
				},
			});
			const server = sdk.domainObjects.provide(ModelServer, {
				initialState: serverSnapshot(),
				methods: {
					status: () => service.status,
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
					resolveCatalogAccess: async () => {
						await guarded(() => catalogSource.source()?.resolveAccess?.());
					},
					signInToCatalog: async () => {
						const source = catalogSource.source();
						if (!source?.signIn) return { ok: false as const, reason: SIGN_IN_UNAVAILABLE };
						return guarded(() => source.signIn!());
					},
					cancelCatalogSignIn: async () => {
						await guarded(() => catalogSource.source()?.cancelSignIn?.());
					},
					listDownloads: () => downloads.list(),
					startDownload: (input) => guarded(() => downloads.start(input)),
					cancelDownload: (input) => guarded(() => downloads.cancel(input)),
				},
			});
			sync = () => {
				models.setState(modelsSnapshot());
				server.setState(serverSnapshot());
			};

			sdk.extensions.implement(AiProviderPoint, LOCAL_MODEL_SERVER_CONTRIBUTION, provider.source);
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
			const tools = localInferenceTools({
				openSettings: async () => {
					await sdk.domainObjects
						.get(Navigation)
						?.methods.openSettings({ section: LOCAL_MODEL_SERVER_SETTINGS_SECTION });
				},
			});
			for (const [id, tool] of Object.entries(tools)) {
				sdk.extensions.implement(Tool, id, tool);
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
			sdk.logger.info(`Local inference publishes the "${LOCAL_AI_PROVIDER_ID}" provider.`);
		},
	});
}
