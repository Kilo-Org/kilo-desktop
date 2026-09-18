import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const environmentsStatusResultSchema = z.object({
	/** Whether at least one environment provider booted successfully. */
	providersAvailable: z.boolean(),
});
export type EnvironmentsStatusResult = z.infer<typeof environmentsStatusResultSchema>;

/**
 * Plugin-level status contract. Registered before the feature-flag
 * gate so the channel always exists — the renderer calls `useSdkQuery`
 * unconditionally (React hook rules) and must never hit an
 * unregistered channel.
 */
export const environmentsStatusContract = defineContract({
	"environments.status": defineMethod(z.undefined(), environmentsStatusResultSchema),
});

export type EnvironmentsStatusService = InferContract<typeof environmentsStatusContract>;
