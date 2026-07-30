import { z } from "zod";

import { defineMethod } from "../contract.js";

/**
 * Generic channel for feature-scoped handler invocation.
 * The shell routes this by featureId to the correct handler.
 * Features never add their own channels to ipcMethods — they all go through this one.
 */
export const featureInvokeInput = z.object({
	featureId: z.string().min(1),
	channel: z.string().min(1),
	args: z.unknown().optional(),
});

export const featureMethods = {
	"feature:invoke": defineMethod(featureInvokeInput, z.unknown()),
} as const;
