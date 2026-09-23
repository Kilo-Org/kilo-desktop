import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

import { localModelSettingsSchema } from "../shared/settings/model-settings.js";
import { localServerSettingsSchema } from "../shared/settings/server-settings.js";
import { modelCatalogSchema, modelDownloadIdentitySchema, modelDownloadSchema } from "./catalog.js";
import { localModelSchema } from "./models.js";
import { localInferenceStatusSchema } from "./runtime.js";
import { localInferenceHardwareProfileSchema, localInferenceUsageSchema } from "./system.js";

export * from "./catalog.js";
export * from "./events.js";
export * from "./models.js";
export * from "./runtime.js";
export * from "./system.js";

export { localModelSettingsSchema, localServerSettingsSchema };
export type { LocalModelSettings } from "../shared/settings/model-settings.js";
export type { LocalServerSettings } from "../shared/settings/server-settings.js";

export const localInferenceContract = defineContract({
	"catalog.list": defineMethod(z.undefined(), modelCatalogSchema),
	"catalog.download.start": defineMethod(modelDownloadIdentitySchema, modelDownloadSchema),
	"catalog.download.cancel": defineMethod(modelDownloadIdentitySchema, modelDownloadSchema),
	"catalog.downloads.list": defineMethod(z.undefined(), z.array(modelDownloadSchema)),
	"hardware.profile": defineMethod(z.undefined(), localInferenceHardwareProfileSchema),
	"models.list": defineMethod(z.undefined(), z.array(localModelSchema)),
	"models.add": defineMethod(
		z.object({
			path: z.string().min(1).max(32_768),
			name: z.string().trim().min(1).max(200).optional(),
		}),
		localModelSchema,
	),
	"models.remove": defineMethod(
		z.object({
			id: z.string().min(1),
			mode: z.enum(["registry-only", "delete-managed-file"]),
		}),
		z.object({ ok: z.literal(true) }),
	),
	"models.update": defineMethod(
		z.object({
			id: z.string().min(1),
			settings: localModelSettingsSchema,
		}),
		localModelSchema,
	),
	"models.prepare": defineMethod(
		z.object({ modelId: z.string().min(1) }),
		z.object({ ok: z.literal(true) }),
	),
	"runtime.retry": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"runtime.disconnect": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"runtime.connect": defineMethod(z.undefined(), z.object({ ok: z.literal(true) })),
	"settings.get": defineMethod(z.undefined(), localServerSettingsSchema),
	"settings.update": defineMethod(localServerSettingsSchema, localServerSettingsSchema),
	"status.get": defineMethod(z.undefined(), localInferenceStatusSchema),
	"usage.get": defineMethod(z.undefined(), localInferenceUsageSchema),
});

export type LocalInferenceServiceContract = InferContract<typeof localInferenceContract>;

export interface LocalInferenceCapabilities extends Record<string, unknown> {
	localInference: {
		prepareModel(modelId: string): Promise<void>;
		connect(): Promise<void>;
	};
}
