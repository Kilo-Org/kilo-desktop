import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	defineObjectType,
	implementation,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

import { localModelSettingsSchema } from "../shared/settings/model-settings";
import { localServerSettingsSchema } from "../shared/settings/server-settings";
import {
	modelCatalogSchema,
	modelDownloadIdentitySchema,
	modelDownloadSchema,
	type ModelCatalog,
	type ModelDownloadIdentity,
} from "./catalog";
import { localModelSchema } from "./models";
import { localInferenceStatusSchema } from "./runtime";
import { localInferenceHardwareProfileSchema, localInferenceUsageSchema } from "./system";

export * from "./catalog";
export * from "./models";
export * from "./runtime";
export * from "./system";

export { localModelSettingsSchema, localServerSettingsSchema };
export type { LocalModelSettings } from "../shared/settings/model-settings";
export type { LocalServerSettings } from "../shared/settings/server-settings";

/**
 * kilo.local-inference's public surface: the Local Model Server — GGUF
 * models served by a managed llama.cpp router behind an OpenAI-compatible
 * proxy, offered to Kilo as the `kilo-desktop-model-server` AI provider. Its
 * installed models are `local-models`; the server, its settings and catalog
 * downloads are `model-server`. Where models can be downloaded from
 * (`model-catalog`) and where llama.cpp comes from (`llama-runtime`) are
 * extension points other plugins fill; it knows nothing about Anaconda.
 */
export const LOCAL_INFERENCE_PLUGIN_ID = "kilo.local-inference";

/** The AI provider's id in Kilo's config (origin's), so chats keep their local models. */
export const LOCAL_AI_PROVIDER_ID = "kilo-desktop-model-server";

/** Its `kilo.core/ai-provider` and `kilo.chat/model-source` contribution id. */
export const LOCAL_MODEL_SERVER_CONTRIBUTION = "local-model-server";

/** The settings section (`/settings/local-model-server`, origin's path). */
export const LOCAL_MODEL_SERVER_SETTINGS_SECTION = "local-model-server";

/** The flag that shows the model catalog (origin's; off by default). */
export const MODEL_CATALOG_FLAG = "local-model-catalog";

/** The kernel service that owns the llama.cpp router and the proxy. */
export const ROUTER_SERVICE_KEY = "kilo.local-inference/router";

/** The kernel task that imports Anaconda Desktop's models once. */
export const IMPORT_SERVICE_KEY = "kilo.local-inference/import";

/** Origin's agent tool (`desktop_local_inference_settings_open`): opens the settings section. */
export const OPEN_SETTINGS_TOOL = "settings.open";

/** The status bar view that shows the "Loading model…" toast in every window. */
export const MODEL_LOADING_STATUS_ITEM = "model-loading";

/** The telemetry events kilo.local-inference declares (`kernel/telemetry-event` ids). */
export const LOCAL_INFERENCE_TELEMETRY_EVENTS = {
	modelInstalled: "local-model-installed",
	serverStarted: "local-model-server-started",
	serverStopped: "local-model-server-stopped",
	modelInstallLinkReceived: "model-install-link-received",
	modelInstallLinkRejected: "model-install-link-rejected",
} as const;

/**
 * Its `kilo.shell/deep-link` contribution: web catalog model install links
 * (`kilo-desktop://models/install?model=<id>[&file=…][&source=…]`), opened on
 * the settings page with the action as `modelAction`.
 */
export const MODEL_INSTALL_DEEP_LINK = {
	id: "model-install",
	host: "models",
	pathParam: "modelAction",
	query: ["model", "file", "source"],
} as const;

const ok = z.object({ ok: z.literal(true) });

// --- Installed models ---

/** One installed GGUF model, resolved by `kilo.local-inference/local-models`; keyed by its id. */
export const LocalModelObjectType = defineObjectType({
	id: "kilo.local-inference/local-model",
	description: "A GGUF model installed in the Local Model Server, keyed by its id.",
});

export const localModelsStateSchema = z.object({
	models: z.array(localModelSchema),
});
export type LocalModelsState = z.output<typeof localModelsStateSchema>;

/** The Local Model Server's installed models (origin's registry), and adding, removing and tuning them. */
export const LocalModels = defineDomainObject({
	id: "kilo.local-inference/local-models",
	home: "main",
	description: "The GGUF models installed in the Local Model Server.",
	state: localModelsStateSchema,
	lookup: (state, id) => state.models.find((model) => model.id === id),
	objectType: LocalModelObjectType,
	methods: {
		listModels: method(z.undefined(), z.array(localModelSchema)),
		addModel: method(
			z.object({
				path: z.string().min(1).max(32_768),
				name: z.string().trim().min(1).max(200).optional(),
			}),
			localModelSchema,
		),
		removeModel: method(
			z.object({
				id: z.string().min(1),
				mode: z.enum(["registry-only", "delete-managed-file"]),
			}),
			ok,
		),
		updateModel: method(
			z.object({ id: z.string().min(1), settings: localModelSettingsSchema }),
			localModelSchema,
		),
	},
});

// --- Model catalogs ---

/** Who a model catalog is read for, as its contributor reports it. */
export const modelCatalogAccessSchema = z.discriminatedUnion("status", [
	/** Not known yet. */
	z.object({ status: z.literal("resolving") }),
	/** The catalog needs its account: sign in first. */
	z.object({ status: z.literal("signed-out") }),
	/** `accountKey` changes when the account does, so a cached catalog is never shown to another. */
	z.object({ status: z.literal("signed-in"), accountKey: z.string() }),
	z.object({ status: z.literal("error"), reason: z.string() }),
]);
export type ModelCatalogAccess = z.output<typeof modelCatalogAccessSchema>;

/** `cancelled` marks a sign-in the person cancelled — not an error worth reporting. */
export const modelCatalogSignInResultSchema = z.union([
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), reason: z.string(), cancelled: z.boolean().optional() }),
]);
export type ModelCatalogSignInResult = z.output<typeof modelCatalogSignInResultSchema>;

/** A model catalog as `model-server` shows it; null while no catalog is contributed. */
export const modelCatalogStateSchema = z
	.object({
		/** Whose catalog it is ("Anaconda"): "Browse models from Anaconda", "Sign in to Anaconda". */
		title: z.string().min(1),
		access: modelCatalogAccessSchema,
	})
	.nullable();
export type ModelCatalogState = z.output<typeof modelCatalogStateSchema>;

/** What a `model-catalog` contribution implements, in main. */
export interface ModelCatalogSource {
	/** Who the catalog is read for now. */
	access(): ModelCatalogAccess;
	/**
	 * Works out who the catalog is read for, when that is not known yet (e.g.
	 * reads the stored key): called when the catalog is shown, so a catalog
	 * that resolves lazily stays `resolving` until someone looks at it.
	 */
	resolveAccess?(): Promise<void>;
	/** Calls back when `access` or the catalog changes; the cached catalog is dropped. */
	subscribe?(onChange: () => void): () => void;
	/** Every model the catalog offers; rejects (e.g. "sign in first") when it can't be read. */
	list(): Promise<ModelCatalog>;
	/** A URL the chosen quantization downloads from (its size and sha256 come from `list`). */
	downloadUrl(identity: ModelDownloadIdentity, signal: AbortSignal): Promise<string>;
	/** Signs in to the catalog's account, in the browser. */
	signIn?(): Promise<ModelCatalogSignInResult>;
	cancelSignIn?(): Promise<void>;
}

/**
 * A browsable list of GGUF models to download into the Local Model Server:
 * its models, who it is read for (sign in first) and the download. A catalog
 * contributes data and access, not UI: kilo.local-inference draws it. The
 * highest-priority contribution is the one shown.
 */
export const ModelCatalogPoint = defineExtensionPoint({
	id: "kilo.local-inference/model-catalog",
	kind: "additive",
	description: "A browsable list of GGUF models to download into the Local Model Server.",
	metadata: z.object({ title: z.string().min(1) }),
	implementation: implementation<ModelCatalogSource>("main"),
});

// --- llama.cpp ---

/** What a `llama-runtime` contribution implements, in main. */
export interface LlamaRuntimeSource {
	/** The `llama-server` executable, installed first if needed; rejects when it can't provide one. */
	resolveExecutable(): Promise<string>;
}

/**
 * A way to get the llama.cpp server binary (e.g. from a conda environment).
 * `LOCAL_LLAMA_SERVER_PATH` wins; otherwise contributions are tried by
 * priority and the first that resolves is used.
 */
export const LlamaRuntime = defineExtensionPoint({
	id: "kilo.local-inference/llama-runtime",
	kind: "additive",
	description: "A way to get the llama.cpp server binary, tried by priority.",
	metadata: z.object({ title: z.string().min(1) }),
	implementation: implementation<LlamaRuntimeSource>("main"),
});

// --- The server ---

export const modelServerStateSchema = z.object({
	status: localInferenceStatusSchema,
	downloads: z.array(modelDownloadSchema),
	catalog: modelCatalogStateSchema,
});
export type ModelServerState = z.output<typeof modelServerStateSchema>;

/**
 * The Local Model Server: its status, catalog downloads and the catalog's
 * access (state), what can be done with them (origin's contract, one method
 * per channel), and `prepare`, which loads a model before a prompt uses it.
 */
export const ModelServer = defineDomainObject({
	id: "kilo.local-inference/model-server",
	home: "main",
	description: "The Local Model Server: status, settings, the model catalog and its downloads.",
	state: modelServerStateSchema,
	methods: {
		status: method(z.undefined(), localInferenceStatusSchema),
		prepare: method(z.object({ modelId: z.string().min(1) }), ok),
		connect: method(z.undefined(), ok),
		disconnect: method(z.undefined(), ok),
		retry: method(z.undefined(), ok),
		settings: method(z.undefined(), localServerSettingsSchema),
		updateSettings: method(localServerSettingsSchema, localServerSettingsSchema),
		usage: method(z.undefined(), localInferenceUsageSchema),
		hardwareProfile: method(z.undefined(), localInferenceHardwareProfileSchema),
		listCatalog: method(z.undefined(), modelCatalogSchema),
		/** Asks the catalog to work out its access (the catalog UI calls it when shown). */
		resolveCatalogAccess: method(z.undefined(), z.undefined()),
		signInToCatalog: method(z.undefined(), modelCatalogSignInResultSchema),
		cancelCatalogSignIn: method(z.undefined(), z.undefined()),
		listDownloads: method(z.undefined(), z.array(modelDownloadSchema)),
		startDownload: method(modelDownloadIdentitySchema, modelDownloadSchema),
		cancelDownload: method(modelDownloadIdentitySchema, modelDownloadSchema),
	},
});

export const LOCAL_INFERENCE_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [ModelCatalogPoint, LlamaRuntime],
	domainObjects: [LocalModels, ModelServer],
	objectTypes: [LocalModelObjectType],
};
