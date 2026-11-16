import { z } from "zod";

import { defineDomainObject } from "@kilo-desktop/kernel";

export const fileChangeSchema = z.object({
	path: z.string(),
	type: z.enum(["create", "update", "delete"]),
});
export type FileChange = z.output<typeof fileChangeSchema>;

export const fileChangeEventSchema = z.object({
	/** The workspace folder the changes are under. */
	root: z.string(),
	changes: z.array(fileChangeSchema),
});
export type FileChangeEvent = z.output<typeof fileChangeEventSchema>;

/** Narrows file-change events, e.g. to one folder or file type (see `createWorkspaceChangeFilter`). */
export const watchFilterSchema = z.object({
	/** Globs (forward slashes) a path must match. */
	includes: z.array(z.string()).optional(),
	excludes: z.array(z.string()).optional(),
	types: z.array(fileChangeSchema.shape.type).optional(),
});
export type WatchFilter = z.output<typeof watchFilterSchema>;

export const watchedFolderSchema = z.object({
	path: z.string(),
	state: z.enum(["starting", "active", "retrying", "failed"]),
	error: z.string().optional(),
});
export type WatchedFolder = z.output<typeof watchedFolderSchema>;

/**
 * File changes in workspace folders: what is being watched (by the
 * `file-watcher` service), and changes as they happen.
 */
export const FileWatcher = defineDomainObject({
	id: "kilo.work-sessions/file-watcher",
	home: "main",
	description: "Watched workspace folders and the file changes in them.",
	state: z.object({ watched: z.array(watchedFolderSchema) }),
	events: {
		/** A coalesced batch of changes under one workspace folder. */
		changed: fileChangeEventSchema,
	},
});
