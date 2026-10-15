import path from "node:path";

import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk/main";

import {
	localInferenceContract,
	type LocalInferenceCapabilities,
	type LocalInferenceServiceContract,
} from "../contracts/schemas.js";
import {
	CATALOG_DOWNLOAD_CHANGED_EVENT,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../contracts/events.js";
import { ModelDownloadManager } from "./catalog/ModelDownloadManager.js";
import { ModelCatalogService } from "./catalog/ModelCatalogService.js";
import { type AuthMainCapability } from "./catalog/catalog-client.js";
import { LocalInferenceService, type KiloCapability } from "./inference/LocalInferenceService.js";
import { importAnacondaDesktopModels } from "./integrations/anaconda-desktop.js";
import { LOCAL_PROVIDER_ID } from "./integrations/kilo-constants.js";
import { LocalModelRegistry, type PersistedLocalModels } from "./models/LocalModelRegistry.js";
import { allocateLoopbackPort } from "./runtime/allocatePort.js";
import { LocalChatProxy } from "./runtime/LocalChatProxy.js";
import { LlamaRouterManager } from "./runtime/LlamaRouterManager.js";
import { readLlamaHost, resolveLlamaExecutable } from "./runtime/llamaRuntime.js";
import { createHardwareProfileReader } from "./system/hardware-profile.js";
import { createLocalInferenceUsageCollector } from "./system/resourceUsage.js";

interface CondaRuntimeCapability extends Record<string, unknown> {
	condaRuntime: {
		ensureEnvironment(input: {
			name: string;
			packages: readonly string[];
			channels?: readonly string[];
		}): Promise<{ prefixPath: string }>;
		executable(prefixPath: string, name: string): string;
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function resolveManagedLlamaExecutable(mainSdk: MainSdk): Promise<string> {
	const overridePath = process.env.LOCAL_LLAMA_SERVER_PATH;
	return resolveLlamaExecutable({
		conda: mainSdk.plugins.get<CondaRuntimeCapability>("environments")?.condaRuntime,
		host: await readLlamaHost(),
		logger: mainSdk.logger,
		...(overridePath ? { overridePath } : {}),
	});
}

export async function mainRegister(mainSdk: MainSdk): Promise<void> {
	const registry = new LocalModelRegistry(
		mainSdk.storage.kv<PersistedLocalModels>({
			namespace: "models",
			defaults: { models: [] },
		}),
	);
	const router = new LlamaRouterManager({
		storageDir: mainSdk.storageDir,
		resolveExecutable: () => resolveManagedLlamaExecutable(mainSdk),
		allocatePort: allocateLoopbackPort,
		fetch: mainSdk.net.fetch,
		logger: mainSdk.logger,
		onStatusChange: (status) => mainSdk.events.emit(STATUS_CHANGED_EVENT, status),
	});
	const usage = createLocalInferenceUsageCollector();
	const hardwareProfile = createHardwareProfileReader();
	const settingsFor = (modelId: string) =>
		registry.list().find((model) => model.id === modelId)?.settings;
	const proxy = new LocalChatProxy({
		apiKey: router.apiKey,
		allocatePort: allocateLoopbackPort,
		fetch: mainSdk.net.fetch,
		logger: mainSdk.logger,
		prepareModel: (modelId) => service.prepareModel(modelId),
		getSamplingSettings: settingsFor,
		getIncludeKiloContext: (modelId) => settingsFor(modelId)?.includeKiloContext,
	});
	const service = new LocalInferenceService({
		registry,
		managedModelsDir: path.join(mainSdk.storageDir, "models"),
		router,
		proxy,
		getKilo: () => mainSdk.plugins.get<KiloCapability>("kilo-server"),
		emit: (event, payload) => mainSdk.events.emit(event, payload),
		logger: mainSdk.logger,
	});
	const getApiKey = async () =>
		(await mainSdk.plugins.get<AuthMainCapability>("auth")?.session.getApiKey()) ?? null;
	const getSiteDomain = async () =>
		(await mainSdk.plugins.get<AuthMainCapability>("auth")?.session.getSiteDomain()) ??
		"anaconda.com";
	const catalogDependencies = { fetch: mainSdk.net.fetch, getApiKey, getSiteDomain };
	const catalog = new ModelCatalogService(catalogDependencies, () => hardwareProfile.read());
	const downloads = new ModelDownloadManager({
		modelsDir: path.join(mainSdk.storageDir, "models"),
		fetch: mainSdk.net.fetch,
		resolveArtifact: (identity) => catalog.resolveArtifact(identity),
		resolveDownloadUrl: (artifact, signal) => catalog.downloadUrl(artifact, signal),
		addModel: (input) => service.add(input),
		emit: (download) => mainSdk.events.emit(CATALOG_DOWNLOAD_CHANGED_EVENT, download),
		logger: mainSdk.logger,
	});
	await downloads.initialize();
	await registry.adoptLegacyManagedFiles(path.join(mainSdk.storageDir, "models"));

	const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
		try {
			return await operation();
		} catch (error) {
			throw new FeatureError(message(error), "BUSINESS");
		}
	};
	const handlers: LocalInferenceServiceContract = {
		"catalog.list": () => catalog.list(),
		"catalog.download.start": (input) => guarded(() => downloads.start(input)),
		"catalog.download.cancel": (input) => guarded(async () => downloads.cancel(input)),
		"catalog.downloads.list": async () => downloads.list(),
		"hardware.profile": () => hardwareProfile.read(),
		"models.list": async () => service.list(),
		"models.add": (input) => guarded(() => service.add(input)),
		"models.remove": async ({ id, mode }) => {
			try {
				if (!(await service.remove(id, mode))) {
					throw new FeatureError("Local model not found.", "NOT_FOUND");
				}
				return { ok: true };
			} catch (error) {
				if (error instanceof FeatureError) throw error;
				throw new FeatureError(message(error), "BUSINESS");
			}
		},
		"models.update": async ({ id, settings }) => {
			try {
				return service.update(id, settings);
			} catch (error) {
				if (error instanceof Error && error.message === "Local model not found.") {
					throw new FeatureError("Local model not found.", "NOT_FOUND");
				}
				throw new FeatureError(message(error), "BUSINESS");
			}
		},
		"models.prepare": async ({ modelId }) => {
			try {
				await service.prepareModel(modelId);
				return { ok: true };
			} catch (error) {
				mainSdk.logger.warn(`Could not prepare local model "${modelId}": ${message(error)}`);
				throw new FeatureError("The local model could not be prepared.", "BUSINESS");
			}
		},
		"runtime.retry": async () => {
			service.retry();
			return { ok: true };
		},
		"runtime.disconnect": () =>
			guarded(async () => {
				await service.disconnect();
				return { ok: true as const };
			}),
		"runtime.connect": () =>
			guarded(async () => {
				await service.connect();
				return { ok: true as const };
			}),
		"settings.get": async () => service.serverSettings(),
		"settings.update": (input) => guarded(async () => service.updateServerSettings(input)),
		"status.get": async () => service.status,
		"usage.get": () => usage.read(),
	};

	const capability = {
		prepareModel: service.prepareModel.bind(service),
		connect: service.connect.bind(service),
	} satisfies LocalInferenceCapabilities["localInference"];
	mainSdk.plugins.expose("localInference", capability);
	mainSdk.channels(localInferenceContract).handleAll(handlers);
	const unsubscribe = mainSdk.events.on("kilo-server.server-status-changed", (status) => {
		if (
			typeof status === "object" &&
			status !== null &&
			"status" in status &&
			status.status === "ready" &&
			service.status.status !== "disconnected" &&
			service.status.status !== "stopping"
		) {
			void service.reconcile().catch(() => undefined);
		}
	});
	mainSdk.onDispose(async () => {
		unsubscribe();
		usage.dispose();
		await downloads.dispose();
		service.dispose();
	});

	await service.initialize().catch((error) => {
		mainSdk.logger.error(`Local inference initialization failed: ${message(error)}`);
	});
	mainSdk.logger.info(
		`Local inference registered with managed provider "${LOCAL_PROVIDER_ID}" and event "${MODELS_CHANGED_EVENT}".`,
	);

	if (!registry.isAnacondaDesktopModelsImported()) {
		void importAnacondaDesktopModels((input) => service.add(input), mainSdk.logger).then(
			() => registry.setAnacondaDesktopModelsImported(true),
			(error) => {
				mainSdk.logger.error(`Failed to import Anaconda Desktop models: ${message(error)}`);
			},
		);
	}
}
