import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Host the notebook bundle is served from on the desktop scheme — a sibling of
 * `app`, not a path under it, which is what makes it a separate origin with its
 * own CSP and storage (../../docs/embedding-decisions.md, D1).
 *
 * Lives in contracts because both sides need it: main serves this host, and the
 * renderer builds the iframe `src` from it.
 */
export const NOTEBOOK_HOST = "notebook";
export const NTERACT_ELECTRON_HOST_PROTOCOL_VERSION = 1;

export const notebookDaemonSchema = z.object({
	version: z.string(),
	socketPath: z.string(),
	isDevMode: z.boolean(),
	blobPort: z.number().int().positive().nullable(),
});
export type NotebookDaemon = z.infer<typeof notebookDaemonSchema>;

/** Agentic Desktop attaches to the user-owned singleton; it never owns its process. */
export const notebookDaemonAvailabilitySchema = z.object({
	status: z.enum(["available", "unavailable"]),
	/** Present on `unavailable`, with an actionable runtime prerequisite. */
	reason: z.string().optional(),
});
export type NotebookDaemonAvailability = z.infer<typeof notebookDaemonAvailabilitySchema>;

/**
 * `daemon` is null whenever the externally installed singleton is unreachable.
 * `availability` keeps that expected prerequisite state distinct from IPC failure.
 */
export const notebookStatusSchema = z.object({
	availability: notebookDaemonAvailabilitySchema,
	daemon: notebookDaemonSchema.nullable(),
});
export type NotebookStatus = z.infer<typeof notebookStatusSchema>;

export const notebookContract = defineContract({
	status: defineMethod(z.undefined(), notebookStatusSchema),
});

export type NotebookService = InferContract<typeof notebookContract>;
