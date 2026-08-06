import { z } from "zod";

import { defineEvent, defineMethod } from "../contract.js";

export const featureFlagMethods = {
	"feature-flag:get-all": defineMethod(z.undefined(), z.record(z.string(), z.unknown())),
	"feature-flag:get": defineMethod(
		z.object({ key: z.string(), defaultValue: z.unknown().optional() }),
		z.unknown(),
	),
} as const;

export const featureFlagEvents = {
	"feature-flag:changed": defineEvent(z.record(z.string(), z.unknown())),
} as const;
