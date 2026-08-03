import { z } from "zod";

import { defineEvent } from "../contract.js";

/**
 * Transport envelope for the symmetric feature event bridge. `name` is
 * unqualified; the SDK/shell stamps it as `${featureId}.${name}` when it is
 * delivered. `payload` must be structured-cloneable (guarded by feature-sdk
 * before the envelope reaches Electron).
 */
export const featureEventPayload = z.object({
	featureId: z.string().min(1),
	name: z.string().min(1),
	payload: z.unknown().optional(),
});

const featureEventContract = defineEvent(featureEventPayload);

/** Main-to-renderer push channels. */
export const featureEvents = {
	"feature:event": featureEventContract,
} as const;

/** Renderer-to-main fire-and-forget channels. */
export const featureMessages = {
	"feature:event": featureEventContract,
} as const;

export type FeatureEventPayload = z.output<typeof featureEventPayload>;
