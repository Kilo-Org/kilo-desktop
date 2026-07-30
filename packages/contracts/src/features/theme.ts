import { z } from "zod";

import { defineEvent, defineIpcMethod } from "../contract.js";

export const themeSourceSchema = z.enum(["system", "light", "dark"]);
export const themeStateSchema = z.object({
	source: themeSourceSchema,
	shouldUseDarkColors: z.boolean(),
});

export type ThemeSource = z.infer<typeof themeSourceSchema>;
export type ThemeState = z.infer<typeof themeStateSchema>;

export const themeMethods = {
	"theme:get": defineIpcMethod(z.undefined(), themeStateSchema),
	"theme:set": defineIpcMethod(z.object({ source: themeSourceSchema }), themeStateSchema),
} as const;

export const themeEvents = {
	"theme:changed": defineEvent(themeStateSchema),
} as const;
