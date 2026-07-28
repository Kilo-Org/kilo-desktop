import { z } from "zod";

import { defineMethod } from "../contract.js";

export const shellMethods = {
	"shell:open-external": defineMethod(
		z.object({ url: z.string() }),
		z.object({ opened: z.boolean() }),
	),
	"shell:copy-text": defineMethod(z.object({ text: z.string() }), z.undefined()),
} as const;
