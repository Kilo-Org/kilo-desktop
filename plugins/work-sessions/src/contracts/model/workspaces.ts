import { z } from "zod";

import { defineDomainObject, defineObjectType, method } from "@kilo-desktop/kernel";

import { workspaceIdentityColorSchema } from "./identity-color";

/** True while at least one workspace exists. */
export const HAS_WORKSPACES_KEY = "kilo.work-sessions/hasWorkspaces";

/** `<folder>/.kilo/worktrees/<name>` holds the app's managed copies (git worktrees). */
export const KILO_WORKTREE_SEGMENTS = [".kilo", "worktrees"] as const;

/** One workspace, resolved by `kilo.work-sessions/workspaces`; keyed by its id. */
export const WorkspaceObjectType = defineObjectType({
	id: "kilo.work-sessions/workspace",
	description: "A workspace: a named project of one or more folders, keyed by its id.",
});

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
 * - `folder`: is a workspace folder, or a managed copy of one;
 * - `primary`: is a primary folder, or a managed copy of one;
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

/**
 * The registered workspaces, shared by every window: named projects with one
 * or more folders (one primary), the active one, which folders are
 * unavailable, and the one path authoriser every plugin uses instead of its
 * own checks.
 */
export const Workspaces = defineDomainObject({
	id: "kilo.work-sessions/workspaces",
	home: "main",
	description: "Workspaces, the active one, folder availability and path authorisation.",
	state: workspacesStateSchema,
	lookup: (state, id) => state.workspaces.find((workspace) => workspace.id === id),
	objectType: WorkspaceObjectType,
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
