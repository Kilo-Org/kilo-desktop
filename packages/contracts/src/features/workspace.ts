import { z } from "zod";

import type { InferContract } from "@kilo-desktop/feature-sdk";

import { defineContract, defineEvent, defineMethod } from "../contract.js";

/**
 * Feature id for the built-in workspace watcher. Watches all registered
 * workspace folders with @parcel/watcher and publishes file-change batches
 * on the event bus; main-side features consume it through the "watcher"
 * capability.
 */
export const WORKSPACE_FEATURE_ID = "workspace";

/** Un-namespaced event name the watcher emits via `mainSdk.events.emit(...)`. */
export const WORKSPACE_FILE_CHANGE_EVENT = "file-change";

/** Fully-namespaced event name renderers subscribe to via `sdk.events.on(...)`. */
export const WORKSPACE_FILE_CHANGE_EVENT_NAME =
	`${WORKSPACE_FEATURE_ID}.${WORKSPACE_FILE_CHANGE_EVENT}` as const;

// ─── Event schema ──────────────────────────────────────────────────────────────

export const fileChangeTypeSchema = z.enum(["create", "update", "delete"]);
export type FileChangeType = z.infer<typeof fileChangeTypeSchema>;

export const fileChangeSchema = z.object({
	/** Absolute path of the changed file, in platform-native form (backslash-separated on Windows). */
	path: z.string(),
	type: fileChangeTypeSchema,
});
export type FileChange = z.infer<typeof fileChangeSchema>;

/**
 * One batch of changes for a watched workspace directory. Parcel coalesces
 * raw FSEvents/inotify noise natively (per-path dedup, CREATE+DELETE
 * cancellation); this payload is already the coalesced form. Structured-
 * cloneable so it crosses the feature event bridge unchanged.
 */
export const workspaceFileChangeEventSchema = z.object({
	/** Absolute path of the watched directory the batch belongs to. */
	root: z.string(),
	changes: z.array(fileChangeSchema),
});
export type WorkspaceFileChangeEvent = z.infer<typeof workspaceFileChangeEventSchema>;

export const workspaceEvents = {
	[WORKSPACE_FILE_CHANGE_EVENT_NAME]: defineEvent(workspaceFileChangeEventSchema),
} as const;

// ─── Watcher capability ───────────────────────────────────────────────────────

/**
 * Glob + event-type filters applied to each batch before delivery. Globs are
 * picomatch syntax, always authored with forward slashes; matching is
 * separator-insensitive (vscode-style), so they match native Windows event
 * paths. Normalize native absolute paths with `toPosixPath` (feature-sdk)
 * before escaping and embedding them in a glob.
 */
export const workspaceWatchFilterSchema = z.object({
	/**
	 * picomatch globs — if set, only matching paths fire. Matching is
	 * case-insensitive on Windows and macOS, case-sensitive on Linux
	 * (mirrors vscode's `ignoreCase: !isLinux` behaviour).
	 */
	includes: z.array(z.string()).optional(),
	/**
	 * picomatch globs — matching paths are suppressed. Matching is
	 * case-insensitive on Windows and macOS, case-sensitive on Linux
	 * (mirrors vscode's `ignoreCase: !isLinux` behaviour).
	 */
	excludes: z.array(z.string()).optional(),
	/** Event type filter — if set, only these event types fire. */
	types: z.array(fileChangeTypeSchema).optional(),
});
export type WorkspaceWatchFilter = z.infer<typeof workspaceWatchFilterSchema>;

/**
 * Diagnostic state of a watched directory:
 * - `"starting"` — the native subscription has been requested but has not
 *   resolved yet. Events cannot flow in this state.
 * - `"active"` — the native subscription resolved and can deliver events.
 * - `"retrying"` — the native subscription failed transiently; a bounded
 *   back-off loop is running. The retry loop owns resubscription; `watchDirectory`
 *   on a retrying directory is a no-op.
 * - `"failed"` — retry budget exhausted or non-recoverable error (ENOSPC/EMFILE).
 *   Calling `watchDirectory` again resets the loop (the recovery path).
 *
 * Consumers that must avoid racing the native watcher may poll the status
 * channel until their directory is `"active"`.
 */
export const watcherDirectoryStateSchema = z.enum(["starting", "active", "retrying", "failed"]);
export type WatcherDirectoryState = z.infer<typeof watcherDirectoryStateSchema>;

export const watcherDirectoryStatusSchema = z.object({
	path: z.string(),
	state: watcherDirectoryStateSchema,
	subscriberCount: z.number().int().nonnegative(),
});
export type WatcherDirectoryStatus = z.infer<typeof watcherDirectoryStatusSchema>;

export const workspaceWatcherStatusSchema = z.object({
	directories: z.array(watcherDirectoryStatusSchema),
});
export type WorkspaceWatcherStatus = z.infer<typeof workspaceWatcherStatusSchema>;

export const workspaceContract = defineContract({
	status: defineMethod(z.undefined(), workspaceWatcherStatusSchema),
});
export type WorkspaceServiceContract = InferContract<typeof workspaceContract>;

/**
 * Capability the workspace feature exposes in main via
 * `mainSdk.plugins.expose("watcher", ...)`; other main-side features resolve
 * it with `mainSdk.plugins.get("workspace")?.watcher`.
 */
export interface WorkspaceWatcherCapability {
	/**
	 * Subscribe to file changes in a directory. The directory must be a
	 * registered workspace folder — arbitrary paths are rejected. Returns an
	 * unsubscribe function.
	 */
	subscribe(
		directory: string,
		options: WorkspaceWatchFilter,
		callback: (changes: FileChange[]) => void,
	): () => void;
	/** Current watcher status, including native subscription readiness. */
	status(): WorkspaceWatcherStatus;
}
