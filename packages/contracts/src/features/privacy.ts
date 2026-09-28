import { z } from "zod";
import type { InferContract } from "@kilo-desktop/feature-sdk";
import { defineContract, defineMethod } from "../contract.js";

export const PRIVACY_FEATURE_ID = "privacy";
export const PRIVACY_CHANGED_EVENT = "privacy.changed";
export const privacySettingsSchema = z.object({ allowDataCollection: z.boolean() });
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const privacyChannels = defineContract({
	get: defineMethod(z.undefined(), privacySettingsSchema),
	set: defineMethod(privacySettingsSchema, privacySettingsSchema),
});

export type PrivacyService = InferContract<typeof privacyChannels>;
