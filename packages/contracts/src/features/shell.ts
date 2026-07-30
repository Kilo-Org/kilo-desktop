import { z } from "zod";

import { defineIpcMethod } from "../contract.js";

export const shellMethods = {
	"shell:open-external": defineIpcMethod(
		z.object({ url: z.string() }),
		z.object({ opened: z.boolean() }),
	),
	"shell:copy-text": defineIpcMethod(z.object({ text: z.string() }), z.undefined()),
} as const;
