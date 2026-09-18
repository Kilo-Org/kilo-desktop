import { z } from "zod";

import { defineEvent } from "../contract.js";

export const FEATURE_PORT_WINDOW_MESSAGE = "kilo-desktop:feature-port" as const;

/**
 * One-shot request to attach a transferable MessagePort to a feature-owned
 * main-process handler. The port itself travels in Electron's transfer list;
 * only this structured-cloneable routing envelope is validated here.
 */
export const featurePortPayload = z.object({
	type: z.literal(FEATURE_PORT_WINDOW_MESSAGE),
	featureId: z.string().min(1),
	channel: z.string().min(1),
	args: z.unknown().optional(),
});

export const featurePorts = {
	"feature:port": defineEvent(featurePortPayload),
} as const;
