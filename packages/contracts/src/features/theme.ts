import { z } from "zod";

import { defineMethod } from "../contract.js";
import { THEME_SOURCES } from "./theme-tokens.js";

export * from "./theme-tokens.js";

export const themeSourceSchema = z.enum(THEME_SOURCES);
export const themeStateSchema = z.object({
	source: themeSourceSchema,
	themeId: z.string(),
});

export type ThemeState = z.infer<typeof themeStateSchema>;

export const themeMethods = {
	"theme:sync": defineMethod(themeStateSchema, z.undefined()),
} as const;
