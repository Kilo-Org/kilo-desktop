import { z } from "zod";

import { defineMethod } from "../contract.js";

export * from "./theme-tokens.js";

export const themeSourceSchema = z.enum(["system", "light", "dark"]);
export const themeStateSchema = z.object({
	source: themeSourceSchema,
	shouldUseDarkColors: z.boolean(),
});

export type ThemeSource = z.infer<typeof themeSourceSchema>;
export type ThemeState = z.infer<typeof themeStateSchema>;

export const themeMethods = {
	"theme:sync": defineMethod(themeStateSchema, z.undefined()),
} as const;
