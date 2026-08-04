import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

export const notebookDaemonSchema = z.object({
	version: z.string(),
	socketPath: z.string(),
	isDevMode: z.boolean(),
	blobPort: z.number().int().positive().nullable(),
});
export type NotebookDaemon = z.infer<typeof notebookDaemonSchema>;

/**
 * `daemon` is null whenever the daemon is unreachable — an expected state (it
 * ships as a sidecar that may not be running yet), not an error, so the view
 * can distinguish "no daemon" from "IPC failed".
 */
export const notebookStatusSchema = z.object({
	relayPort: z.number().int().nonnegative(),
	daemon: notebookDaemonSchema.nullable(),
});
export type NotebookStatus = z.infer<typeof notebookStatusSchema>;

export const notebookContract = defineContract({
	status: defineMethod(z.undefined(), notebookStatusSchema),
});

export type NotebookService = InferContract<typeof notebookContract>;
