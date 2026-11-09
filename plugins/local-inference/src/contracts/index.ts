import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { localModelSettingsSchema } from "../shared/settings/model-settings.js";
import { localServerSettingsSchema } from "../shared/settings/server-settings.js";
import { modelCatalogSchema, modelDownloadIdentitySchema, modelDownloadSchema } from "./catalog.js";
import { localModelSchema } from "./models.js";
import { localInferenceStatusSchema } from "./runtime.js";
import { localInferenceHardwareProfileSchema, localInferenceUsageSchema } from "./system.js";

export * from "./schemas.js";

/**
 * kilo.local-inference's public surface: the Local Model Server — GGUF
 * models served by a managed llama.cpp router behind an OpenAI-compatible
 * proxy, published to Kilo as the `kilo-desktop-model-server` provider — as
 * the `local-inference` domain object in main.
 */
export const LOCAL_INFERENCE_PLUGIN_ID = "kilo.local-inference";

/** The provider's id in Kilo's config (origin's), so chats keep their local models. */
export const LOCAL_PROVIDER_ID = "kilo-desktop-model-server";

/** The settings section (`/settings/local-model-server`, origin's path). */
export const LOCAL_MODEL_SERVER_SETTINGS_SECTION = "local-model-server";

/** kilo.flags flag that shows the model catalog (origin's; off by default). */
export const MODEL_CATALOG_FLAG = "local-model-catalog";

/** The kernel service that owns the llama.cpp router and the proxy. */
export const ROUTER_SERVICE_KEY = "kilo.local-inference/router";

const ok = z.object({ ok: z.literal(true) });

export const localInferenceStateSchema = z.object({
	status: localInferenceStatusSchema,
	models: z.array(localModelSchema),
	downloads: z.array(modelDownloadSchema),
});
export type LocalInferenceState = z.output<typeof localInferenceStateSchema>;

/**
 * The Local Model Server: its status, models and catalog downloads (state),
 * what can be done with them (origin's contract, one method per channel), and
 * `prepare`, which loads a model before a prompt uses it. `settings-requested`
 * is the agent asking for the settings section (main windows open it).
 */
export const LocalInference = defineDomain({
	id: "kilo.local-inference/local-inference",
	home: "main",
	state: localInferenceStateSchema,
	methods: {
		status: method(z.undefined(), localInferenceStatusSchema),
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
		prepare: method(z.object({ modelId: z.string().min(1) }), ok),
		connect: method(z.undefined(), ok),
		disconnect: method(z.undefined(), ok),
		retry: method(z.undefined(), ok),
		settings: method(z.undefined(), localServerSettingsSchema),
		updateSettings: method(localServerSettingsSchema, localServerSettingsSchema),
		usage: method(z.undefined(), localInferenceUsageSchema),
		hardwareProfile: method(z.undefined(), localInferenceHardwareProfileSchema),
		listCatalog: method(z.undefined(), modelCatalogSchema),
		listDownloads: method(z.undefined(), z.array(modelDownloadSchema)),
		startDownload: method(modelDownloadIdentitySchema, modelDownloadSchema),
		cancelDownload: method(modelDownloadIdentitySchema, modelDownloadSchema),
	},
	events: {
		"settings-requested": z.object({}),
	},
});

export const LOCAL_INFERENCE_DEFINITIONS: PluginDefinitions = {
	domains: [LocalInference],
};
