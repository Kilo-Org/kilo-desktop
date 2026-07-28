import { z } from "zod";

import { defineEvent, defineMethod } from "../contract.js";

export const themeSourceSchema = z.enum(["system", "light", "dark"]);
export const themeStateSchema = z.object({
	source: themeSourceSchema,
	shouldUseDarkColors: z.boolean(),
});

export const themeMethods = {
	"theme:get": defineMethod(z.undefined(), themeStateSchema),
	"theme:set": defineMethod(z.object({ source: themeSourceSchema }), themeStateSchema),
} as const;

export const themeEvents = {
	"theme:changed": defineEvent(themeStateSchema),
} as const;
