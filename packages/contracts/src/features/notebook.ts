import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

/**
 * Host the notebook bundle is served from on the desktop scheme — a sibling of
 * `app`, not a path under it, which is what makes it a separate origin with its
 * own CSP and storage (docs/notebook-embedding-decisions.md, D1).
 *
 * Lives in contracts because both sides need it: main serves this host, and the
 * renderer builds the iframe `src` from it.
 */
export const NOTEBOOK_HOST = "notebook";

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
 * `incompatible` is that same case with a commit skew: the app and daemon must
 * be built from the same nteract commit, and we cannot displace a daemon that
 * holds the lock.
 */
export const notebookProcessSchema = z.object({
	status: z.enum([
		"idle",
		"starting",
		"external",
		"incompatible",
		"running",
		"restarting",
		"failed",
		"stopped",
	]),
	/** Present only on `failed`, carrying why we gave up. */
	reason: z.string().optional(),
	/** Present only on `incompatible`, naming the two commits that disagree. */
	runningVersion: z.string().optional(),
	bundledVersion: z.string().optional(),
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
