import { z } from "zod";

import { defineMethod } from "../contract.js";

export const shellMethods = {
	"shell:open-external": defineMethod(
		z.object({ url: z.string() }),
		z.object({ opened: z.boolean() }),
	),
	"shell:copy-text": defineMethod(z.object({ text: z.string() }), z.undefined()),
	"shell:show-item-in-folder": defineMethod(
		z.object({ path: z.string().min(1) }),
		z.object({ revealed: z.boolean() }),
	),
	"shell:show-open-dialog": defineMethod(
		z.object({ kind: z.literal("directory"), multiple: z.boolean().optional() }),
		z.object({ canceled: z.boolean(), paths: z.array(z.string()) }),
	),
} as const;
