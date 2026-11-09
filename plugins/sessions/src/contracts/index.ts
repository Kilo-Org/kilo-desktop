import type { ComponentType } from "react";
import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	whenSchema,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

/**
 * kilo.sessions' public surface: Work Sessions — the unit in the sidebar,
 * owning a title, a workspace and the agent chats held in it. A session can
 * exist before its first chat; its title follows that chat's until the person
 * renames the session.
 */
export const SESSIONS_PLUGIN_ID = "kilo.sessions";

/** The title of a session nobody has named and no chat has titled yet. */
export const DEFAULT_WORK_SESSION_TITLE = "New session";

export const workSessionSchema = z.object({
	/** `wses_…` — never a chat id. */
	id: z.string(),
	title: z.string(),
	/** Where the title came from: still the default, its first chat, or the person. */
	titleSource: z.enum(["default", "chat", "user"]),
	pinned: z.boolean(),
	archived: z.boolean(),
	/**
	 * When the archived state last changed (ms). A chat archived on the server
	 * after this archives the session; the person's later choice wins. 0 for a
	 * session imported from origin no one has archived or restored here yet.
	 */
	archiveChangedAt: z.number(),
	workspaceId: z.string().nullable(),
	/** The `kilo/…` branch when the session runs in a worktree. */
	worktreeBranch: z.string().nullable(),
	/** Where its chat runs, as the Kilo server reports. */
	directory: z.string().nullable(),
	/** Kilo chat (`ses_…`) ids, oldest first. */
	chatIds: z.array(z.string()),
	createdAt: z.number(),
	updatedAt: z.number(),
	/**
	 * How the session was isolated when it was created. Absent for sessions
	 * adopted from chats, whose directory and branch follow their chats.
	 */
	isolation: z.enum(["local", "new-worktree", "existing-worktree"]).optional(),
	/** The ref a created worktree's branch was cut from. */
	baseRef: z.string().optional(),
	/** True when kilo.sessions created the worktree (not one picked from existing ones). */
	worktreeCreated: z.boolean().optional(),
});
export type WorkSession = z.output<typeof workSessionSchema>;

/**
 * Where a new session works: the workspace's own checkout, a new worktree cut
 * from `baseBranch` (default: the default branch), or an existing worktree.
 */
export const workSessionIsolationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("local") }),
	z.object({ kind: z.literal("new-worktree"), baseBranch: z.string().min(1).optional() }),
	z.object({ kind: z.literal("existing-worktree"), directory: z.string().min(1) }),
]);
export type WorkSessionIsolation = z.output<typeof workSessionIsolationSchema>;

export const isolationOptionsSchema = z.object({
	/** The workspace's primary folder. */
	directory: z.string(),
	currentBranch: z.string().nullable(),
	defaultBranch: z.string().nullable(),
	/** Local branches, then remote-tracking ones; empty for a repository without commits. */
	branches: z.array(
		z.object({
			name: z.string(),
			kind: z.enum(["local", "remote"]),
			ref: z.string(),
			upstream: z.string().nullable(),
		}),
	),
	recentBranches: z.array(z.string()),
	/** The repository's other worktrees inside workspace folders. */
	worktrees: z.array(z.object({ directory: z.string(), name: z.string(), branch: z.string() })),
});
export type IsolationOptions = z.output<typeof isolationOptionsSchema>;

/**
 * True when the session runs in a worktree no other session shares, so
 * deleting it may offer to remove the worktree.
 */
export function isOrphanedWorktreeSession(sessions: readonly WorkSession[], id: string): boolean {
	const own = sessions.find((session) => session.id === id);
	if (!own?.worktreeBranch || !own.directory) return false;
	return sessions.every((other) => other.id === id || other.directory !== own.directory);
}

const sessionIdInput = z.object({ id: z.string().min(1) });

/** Every Work Session, shared by every window. */
export const WorkSessions = defineDomain({
	id: "kilo.sessions/work-session",
	home: "main",
	state: z.object({ sessions: z.array(workSessionSchema) }),
	methods: {
		/**
		 * Creates a session. With `isolation` it is placed now: a worktree is
		 * created or resolved in the workspace's repository (one it created is
		 * removed again when the session can't be created).
		 */
		create: method(
			z.object({
				workspaceId: z.string().nullable().optional(),
				title: z.string().optional(),
				isolation: workSessionIsolationSchema.optional(),
			}),
			workSessionSchema,
		),
		rename: method(sessionIdInput.extend({ title: z.string().trim().min(1) }), workSessionSchema),
		setPinned: method(sessionIdInput.extend({ pinned: z.boolean() }), workSessionSchema),
		setArchived: method(sessionIdInput.extend({ archived: z.boolean() }), workSessionSchema),
		/**
		 * Records that the session's worktree branch was renamed (its chats keep
		 * their own stamp). Fails for a session without a worktree.
		 */
		setWorktreeBranch: method(
			sessionIdInput.extend({ branch: z.string().min(1) }),
			workSessionSchema,
		),
		/**
		 * Deletes the session and (best effort) its chats on the Kilo server.
		 * `removeWorktree` then removes its worktree when no other session
		 * shares it, after releasing the directory's Kilo instance; a removal
		 * that fails is reported in `worktreeError`, the session staying deleted.
		 */
		remove: method(
			sessionIdInput.extend({ removeWorktree: z.boolean().optional() }),
			z.object({
				deleted: z.boolean(),
				worktreeRemoved: z.boolean().optional(),
				worktreeError: z.string().optional(),
			}),
		),
		/**
		 * What a new session in the workspace can be isolated in: its branches
		 * and existing worktrees. Null without version control or a repository.
		 */
		isolationOptions: method(
			z.object({ workspaceId: z.string().min(1) }),
			isolationOptionsSchema.nullable(),
		),
		/**
		 * Hands over the pins origin kept in the main window's localStorage
		 * (session or chat ids). Applied once; kilo.sessions' own UI only.
		 */
		importLegacyPins: method(z.object({ ids: z.array(z.string()).max(1000) }), z.undefined()),
	},
	events: {
		created: z.object({ session: workSessionSchema }),
		updated: z.object({ before: workSessionSchema, after: workSessionSchema }),
		deleted: z.object({ session: workSessionSchema }),
	},
});

// --- Panes ---

/** How wide a pane starts in a layout (`@kilo-desktop/pane-layout` kinds). */
export const PANE_LAYOUT_KINDS = ["agent", "document", "notebook", "tool"] as const;

export const paneSchema = z.object({
	/** Unique within its session. */
	id: z.string().min(1),
	/** The pane kind's contribution key, e.g. `kilo.terminal/terminal`. */
	kind: z.string().min(1),
	title: z.string(),
	/** Lets a kind vary its icon per pane (a file type). */
	iconKey: z.string().optional(),
	/** The kind's own small facts (a file path, a URL). */
	metadata: z.record(z.string(), z.string()),
	/** 1 for the first pane of its kind in the session, 2 for the next… */
	ordinal: z.number().int().positive(),
});
export type Pane = z.output<typeof paneSchema>;

export const ARRANGEMENTS = ["tiles", "carousel"] as const;
export type PaneArrangement = (typeof ARRANGEMENTS)[number];

export const workSessionPanesSchema = z.object({
	panes: z.array(paneSchema),
	activePaneId: z.string().nullable(),
	/** The serialized pane layout (groups, splits, sizes); null until the canvas saves one. */
	layout: z.string().nullable(),
	arrangement: z.enum(ARRANGEMENTS),
});
export type WorkSessionPanes = z.output<typeof workSessionPanesSchema>;

export const EMPTY_WORK_SESSION_PANES: WorkSessionPanes = {
	panes: [],
	activePaneId: null,
	layout: null,
	arrangement: "tiles",
};

const paneTarget = z.object({ sessionId: z.string().min(1), paneId: z.string().min(1) });

export const openPaneInputSchema = z.object({
	sessionId: z.string().min(1),
	kind: z.string().min(1),
	title: z.string().optional(),
	iconKey: z.string().optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	/** Reuses this pane when it exists (it must be of the same kind). */
	paneId: z.string().min(1).optional(),
	/** Makes it the session's active pane (default true). */
	activate: z.boolean().optional(),
});
export type OpenPaneInput = z.input<typeof openPaneInputSchema>;

const objectRefSchema = z.object({ type: z.string().min(1), id: z.string().min(1) });

/**
 * The panes open in every session, shared by every window. A pane of a kind
 * whose plugin is missing stays listed and renders as unavailable.
 */
export const Panes = defineDomain({
	id: "kilo.sessions/pane",
	home: "main",
	state: z.object({ bySession: z.record(z.string(), workSessionPanesSchema) }),
	methods: {
		/** Opens a pane; a singleton kind's existing pane is activated instead. */
		open: method(openPaneInputSchema, paneSchema),
		/** Opens an object (a file, a URL) in the pane kind whose opener matches it first. */
		openObject: method(
			z.object({ sessionId: z.string().min(1), ref: objectRefSchema }),
			paneSchema.nullable(),
		),
		activate: method(paneTarget, z.undefined()),
		update: method(
			paneTarget.extend({
				title: z.string().optional(),
				iconKey: z.string().optional(),
				metadata: z.record(z.string(), z.string()).optional(),
			}),
			paneSchema,
		),
		close: method(paneTarget, z.object({ closed: z.boolean() })),
		setLayout: method(
			z.object({
				sessionId: z.string().min(1),
				layout: z.string().max(200_000),
				activePaneId: z.string().nullable().optional(),
			}),
			z.undefined(),
		),
		setArrangement: method(
			z.object({ sessionId: z.string().min(1), arrangement: z.enum(ARRANGEMENTS) }),
			z.undefined(),
		),
		/**
		 * Hands over the panes origin kept in the main window's localStorage.
		 * Applied once; kilo.sessions' own UI only.
		 */
		importLegacy: method(z.object({ state: z.unknown() }), z.undefined()),
	},
	events: {
		opened: z.object({ sessionId: z.string(), pane: paneSchema }),
		closed: z.object({ sessionId: z.string(), pane: paneSchema }),
	},
});

/** What a pane kind's component is given. */
export interface PaneProps {
	readonly sessionId: string;
	readonly pane: Pane;
	/** The session's workspace, when it has one. */
	readonly workspaceId: string | null;
	/** Where the session works: its worktree, else its workspace's primary folder. */
	readonly directory: string | null;
	/** True while the pane is the one shown in its group. */
	readonly visible: boolean;
}

export interface PaneImplementation {
	readonly component: ComponentType<PaneProps>;
	readonly icon?: ComponentType<{ className?: string; iconKey?: string }>;
	/**
	 * Asked before the person closes one of its panes (unsaved changes);
	 * false keeps it open. Closing fails open: a guard that rejects closes it.
	 */
	readonly canClose?: (input: {
		readonly sessionId: string;
		readonly pane: Pane;
	}) => Promise<boolean>;
}

/** A kind of pane a session can hold: terminal, agent, browser… */
export const PaneKind = defineExtensionPoint({
	id: "kilo.sessions/pane-kind",
	kind: "additive",
	description: "A kind of pane a session can hold.",
	metadata: z.object({
		title: z.string(),
		description: z.string().optional(),
		/**
		 * Where it can be started: the launcher of a new session, the "+" in a
		 * session, or its own button in the session header (instead of the
		 * header's "+" menu) for a kind people open all the time. `tabGroup:
		 * false` keeps an in-session kind out of tab groups' "+" (e.g. one that
		 * belongs in its own column).
		 */
		launch: z
			.object({
				newSession: z.boolean().default(false),
				inSession: z.boolean().default(true),
				sessionHeader: z.boolean().default(false),
				tabGroup: z.boolean().default(true),
			})
			.default({ newSession: false, inSession: true, sessionHeader: false, tabGroup: true }),
		/** At most one per session; opening it again shows the existing one. */
		singleton: z.boolean().default(false),
		/** Stays mounted while hidden (terminals, web pages). */
		keepAlive: z.boolean().default(false),
		layoutKind: z.enum(PANE_LAYOUT_KINDS).default("tool"),
		/** Where it is listed (the launcher, the "+" menus): lower first; ties keep plugin order. */
		order: z.number().default(100),
		/** Listed, but not startable, unless this holds (e.g. signed in). */
		availableWhen: whenSchema.optional(),
		/** Why it can't be started while `availableWhen` doesn't hold. */
		unavailableHint: z.string().optional(),
	}),
	// Listed without one, so main applies a kind's manifest rules and a kind whose
	// plugin fails to load still names its panes.
	implementation: implementation<PaneImplementation>("renderer", { required: false }),
});

/** Opens objects of a type (optionally matching a glob on their id) in a pane kind. */
export const PaneOpener = defineExtensionPoint({
	id: "kilo.sessions/opener",
	kind: "additive",
	description: "Opens an object (a file, a URL) in a pane kind.",
	metadata: z.object({
		match: z.object({
			/** A domain object type, e.g. `kilo.workspaces/file`. */
			type: z.string().min(1),
			/** A glob on the object's id, e.g. `*.ipynb`. */
			pattern: z.string().optional(),
		}),
		/** The pane kind's contribution key. */
		pane: z.string().min(1),
	}),
});

export const SESSIONS_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [PaneKind, PaneOpener],
	domains: [WorkSessions, Panes],
};
