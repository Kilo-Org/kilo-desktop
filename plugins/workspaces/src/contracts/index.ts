import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { workspaceIdentityColorSchema } from "./identity-color";
import { Vcs } from "./vcs";

export {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	WORKSPACE_IDENTITY_COLORS,
	workspaceIdentityColorSchema,
} from "./identity-color";
export * from "./vcs";
export * from "./session-folders";
export {
	createWorkspaceChangeFilter,
	escapeGlob,
	toPosixPath,
	type WorkspaceSubscriptionOptions,
} from "./change-filter";

/**
 * kilo.workspaces' public surface: registered projects (a name, a colour and
 * one or more folders, the first one primary), the active workspace, a single
 * path authoriser other plugins use instead of their own checks, and file
 * changes inside workspace folders.
 */
export const WORKSPACES_PLUGIN_ID = "kilo.workspaces";

/** True while at least one workspace exists. */
export const HAS_WORKSPACES_KEY = "kilo.workspaces/hasWorkspaces";

/** `<folder>/.kilo/worktrees/<name>` holds the app's managed git worktrees. */
export const KILO_WORKTREE_SEGMENTS = [".kilo", "worktrees"] as const;

export const workspaceFolderInputSchema = z.object({
	path: z.string().min(1),
	isPrimary: z.boolean(),
});

export const workspaceFolderSchema = workspaceFolderInputSchema.extend({
	id: z.string(),
	position: z.number().int().nonnegative(),
});

export const workspaceSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	/** `#RRGGBB`. */
	color: z.string().optional(),
	folders: z.array(workspaceFolderSchema),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export type WorkspaceFolderInput = z.output<typeof workspaceFolderInputSchema>;
export type WorkspaceFolder = z.output<typeof workspaceFolderSchema>;
export type Workspace = z.output<typeof workspaceSchema>;

export const createWorkspaceInputSchema = z.object({
	/** Blank takes the primary folder's name, made unique with " (2)", " (3)"… */
	name: z.string().optional(),
	color: workspaceIdentityColorSchema.optional(),
	folders: z.array(workspaceFolderInputSchema).min(1),
	/** Where it was created, for analytics (e.g. `dialog`, `onboarding`). */
	source: z.string().optional(),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = createWorkspaceInputSchema.extend({
	id: z.string().min(1),
});
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceInputSchema>;

const workspaceChangeSchema = z.object({
	before: workspaceSchema.nullable(),
	after: workspaceSchema.nullable(),
	/** Where a new workspace was created, when given. */
	source: z.string().optional(),
});
export type WorkspaceChange = z.output<typeof workspaceChangeSchema>;

/**
 * How a path must relate to workspace folders:
 * - `folder`: is a workspace folder, or a managed worktree of one;
 * - `primary`: is a primary folder, or a managed worktree of one;
 * - `inside`: is a workspace folder or anything inside one.
 */
export const authorizeRuleSchema = z.enum(["folder", "primary", "inside"]);
export type AuthorizeRule = z.output<typeof authorizeRuleSchema>;

export const authorizationSchema = z.object({
	allowed: z.boolean(),
	/** The workspace that granted it. */
	workspaceId: z.string().optional(),
	/** The workspace folder the path is (or is within). */
	folder: z.string().optional(),
	/** The path, symlinks resolved. */
	path: z.string().optional(),
});
export type Authorization = z.output<typeof authorizationSchema>;

export const workspacesStateSchema = z.object({
	/** Sorted by name. */
	workspaces: z.array(workspaceSchema),
	activeId: z.string().nullable(),
	/** Ids of folders that can't be read right now (moved, deleted, unmounted). */
	unavailableFolderIds: z.array(z.string()),
});
export type WorkspacesState = z.output<typeof workspacesStateSchema>;

/** The registered workspaces, shared by every window. */
export const Workspaces = defineDomain({
	id: "kilo.workspaces/workspace",
	home: "main",
	state: workspacesStateSchema,
	methods: {
		create: method(createWorkspaceInputSchema, workspaceSchema),
		update: method(updateWorkspaceInputSchema, workspaceSchema),
		remove: method(z.object({ id: z.string().min(1) }), z.object({ deleted: z.boolean() })),
		/** Null leaves no workspace active. */
		setActive: method(z.object({ id: z.string().nullable() }), z.undefined()),
		/** Whether `path` may be used under `rule`; resolves symlinks. */
		authorize: method(
			z.object({ path: z.string().min(1), rule: authorizeRuleSchema }),
			authorizationSchema,
		),
		/** Re-checks which folders are available now. */
		checkFolders: method(z.undefined(), z.undefined()),
	},
	events: {
		created: workspaceChangeSchema,
		updated: workspaceChangeSchema,
		deleted: workspaceChangeSchema,
	},
});

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

/** Files in workspace folders: what is being watched, and changes as they happen. */
export const Files = defineDomain({
	id: "kilo.workspaces/file",
	home: "main",
	state: z.object({ watched: z.array(watchedFolderSchema) }),
	methods: {},
	events: {
		/** A coalesced batch of changes under one workspace folder. */
		changed: fileChangeEventSchema,
	},
});

export const WORKSPACES_DEFINITIONS: PluginDefinitions = {
	domains: [Workspaces, Files],
	extensionPoints: [Vcs],
};
