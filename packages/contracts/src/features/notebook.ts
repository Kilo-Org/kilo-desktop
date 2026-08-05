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
 * Lifecycle of the daemon *process*, as distinct from its reachability.
 * `external` means a daemon we did not spawn was already listening — expected,
 * since a user may run nteract's own service-installed daemon of the same
 * channel, which owns the singleton lock we would otherwise contend for.
 */
export const notebookProcessSchema = z.object({
	status: z.enum(["idle", "starting", "external", "running", "restarting", "failed", "stopped"]),
	/** Present only on `failed`, carrying why we gave up. */
	reason: z.string().optional(),
});
export type NotebookProcess = z.infer<typeof notebookProcessSchema>;

/**
 * `daemon` is null whenever the daemon is unreachable — an expected state (it
 * ships as a sidecar that may not be running yet), not an error, so the view
 * can distinguish "no daemon" from "IPC failed". `process` explains *why* it is
 * null: no bundled binary, a failed spawn, or a restart in flight.
 */
export const notebookStatusSchema = z.object({
	relayPort: z.number().int().nonnegative(),
	process: notebookProcessSchema,
	daemon: notebookDaemonSchema.nullable(),
});
export type NotebookStatus = z.infer<typeof notebookStatusSchema>;

export const notebookContract = defineContract({
	status: defineMethod(z.undefined(), notebookStatusSchema),
});

export type NotebookService = InferContract<typeof notebookContract>;
