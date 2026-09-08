import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	localInferenceContract,
	type LocalInferenceCapabilities,
	type LocalInferenceServiceContract,
} from "../contracts/schemas.js";
import {
	LOCAL_PROVIDER_ID,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../shared/constants.js";
import { allocateLoopbackPort } from "./allocatePort.js";
import { LocalChatProxy } from "./LocalChatProxy.js";
import { LlamaRouterManager } from "./LlamaRouterManager.js";
import { LocalInferenceService, type KiloCapability } from "./LocalInferenceService.js";
import { LocalModelRegistry, type PersistedLocalModels } from "./LocalModelRegistry.js";
import { readLlamaHost, resolveLlamaExecutable } from "./llamaRuntime.js";
import { createLocalInferenceUsageCollector } from "./resourceUsage.js";

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
		router,
		proxy,
		getKilo: () => mainSdk.plugins.get<KiloCapability>("kilo-server"),
		emit: (event, payload) => mainSdk.events.emit(event, payload),
		logger: mainSdk.logger,
	});

	const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
		try {
			return await operation();
		} catch (error) {
			throw new FeatureError(message(error), "BUSINESS");
		}
	};
	const handlers: LocalInferenceServiceContract = {
		"models.list": async () => service.list(),
		"models.add": (input) => guarded(() => service.add(input)),
		"models.remove": async ({ id }) => {
			if (!service.remove(id)) {
				throw new FeatureError("Local model not found.", "NOT_FOUND");
			}
			return { ok: true };
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
			void service.reconcile();
		}
	});
	mainSdk.onDispose(() => {
		unsubscribe();
		usage.dispose();
		service.dispose();
	});

	await service.initialize().catch((error) => {
		mainSdk.logger.error(`Local inference initialization failed: ${message(error)}`);
	});
	mainSdk.logger.info(
		`Local inference registered with managed provider "${LOCAL_PROVIDER_ID}" and event "${MODELS_CHANGED_EVENT}".`,
	);
}
