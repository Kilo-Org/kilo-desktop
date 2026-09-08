import path from "node:path";

import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	localInferenceContract,
	type ModelCatalog,
	type LocalInferenceCapabilities,
	type LocalInferenceServiceContract,
} from "../contracts/schemas.js";
import {
	LOCAL_PROVIDER_ID,
	CATALOG_DOWNLOAD_CHANGED_EVENT,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../shared/constants.js";
import { allocateLoopbackPort } from "./allocatePort.js";
import { LocalChatProxy } from "./LocalChatProxy.js";
import { LlamaRouterManager } from "./LlamaRouterManager.js";
import { LocalInferenceService, type KiloCapability } from "./LocalInferenceService.js";
import { LocalModelRegistry, type PersistedLocalModels } from "./LocalModelRegistry.js";
import { ModelDownloadManager, type ModelDownloadIdentity } from "./ModelDownloadManager.js";
import { readLlamaHost, resolveLlamaExecutable } from "./llamaRuntime.js";
import { createHardwareProfileReader } from "./hardware-profile.js";
import { getModelDownloadUrl, listModelCatalog, type AuthMainCapability } from "./model-catalog.js";
import { createLocalInferenceUsageCollector } from "./resourceUsage.js";
import { evaluateCatalogModel } from "../shared/model-compatibility.js";

interface CondaRuntimeCapability extends Record<string, unknown> {
	condaRuntime: {
		ensureEnvironment(input: {
			name: string;
			packages: readonly string[];
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
	const catalogDependencies = { fetch: mainSdk.net.fetch, getApiKey };
	let cachedCatalog: ModelCatalog | undefined;
	const loadCatalog = async (): Promise<ModelCatalog> => {
		const catalog = await listModelCatalog(catalogDependencies);
		cachedCatalog = catalog;
		return catalog;
	};
	const resolveArtifact = async ({ modelId, quantizationId }: ModelDownloadIdentity) => {
		const find = (catalog: ModelCatalog) => {
			const model = catalog.models.find((entry) => entry.id === modelId);
			const quantization = model?.quantizations.find((entry) => entry.id === quantizationId);
			return model && quantization ? { model, quantization } : undefined;
		};
		const resolved = (cachedCatalog ? find(cachedCatalog) : undefined) ?? find(await loadCatalog());
		if (!resolved) {
			throw new FeatureError(
				"The selected model quantization is no longer available.",
				"NOT_FOUND",
			);
		}
		const compatibility = evaluateCatalogModel(
			{ ...resolved.model, quantizations: [resolved.quantization] },
			await hardwareProfile.read(),
		);
		if (!compatibility) {
			throw new FeatureError("This model quantization does not fit on this machine.", "BUSINESS");
		}
		return {
			modelId: resolved.model.id,
			quantizationId: resolved.quantization.id,
			modelName: resolved.model.name,
			publisher: resolved.model.publisher,
			quantization: resolved.quantization.method,
			sizeBytes: resolved.quantization.sizeBytes,
			sha256: resolved.quantization.sha256,
		};
	};
	const downloads = new ModelDownloadManager({
		modelsDir: path.join(mainSdk.storageDir, "models"),
		fetch: mainSdk.net.fetch,
		resolveArtifact,
		resolveDownloadUrl: (artifact, signal) =>
			getModelDownloadUrl(catalogDependencies, artifact.modelId, artifact.quantizationId, signal),
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
		"catalog.list": loadCatalog,
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
}
