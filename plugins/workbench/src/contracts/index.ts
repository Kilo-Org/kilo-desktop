import type { ComponentType, ReactNode, RefObject } from "react";
import { z } from "zod";

import {
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";
import type { WorkSession, WorkSessionIsolation } from "@kilo-desktop/plugin-sessions/contracts";

/**
 * kilo.workbench's public surface: each window's view of the Work Sessions
 * (`Workbench`) and the places plugins add actions to.
 */
export const WORKBENCH_PLUGIN_ID = "kilo.workbench";

/** True in a window while a session is open. */
export const SESSION_ACTIVE_KEY = "kilo.workbench/sessionActive";
/** True in a window while the session list is focused on one workspace. */
export const WORKSPACE_ACTIVE_KEY = "kilo.workbench/workspaceActive";

/** Focus for sessions with no workspace (workspace ids are UUIDs, so it can't collide). */
export const UNSCOPED_WORKSPACE_FOCUS = "unscoped";

export const workbenchStateSchema = z.object({
	/** A workspace id, `unscoped`, or null for every session. */
	focus: z.string().nullable(),
	activeSessionId: z.string().nullable(),
	/** The sessions view shown in place of the open session (its contribution key), or null. */
	view: z.string().nullable(),
	/** Sessions views this window popped out into their own windows. */
	detachedViews: z.array(z.string()),
});
export type WorkbenchState = z.output<typeof workbenchStateSchema>;

/**
 * This window's view of the Work Sessions: the workspace the session list is
 * focused on, the open session or the sessions view shown in its place, and
 * opening panes in the open session as a person does. Each window has its
 * own; only the main window shows sessions.
 *
 * Moving within the home view is the workbench's; leaving it (Settings, a
 * deep-linked page) is kilo.shell's `Navigation`. Opening a session or a
 * sessions view brings the window back to the home view.
 */
export const Workbench = defineDomain({
	id: "kilo.workbench/workbench",
	home: "renderer",
	state: workbenchStateSchema,
	methods: {
		setFocus: method(z.object({ focus: z.string().nullable() }), z.undefined()),
		/** Opens a session, leaving any sessions view. */
		openSession: method(z.object({ sessionId: z.string() }), z.undefined()),
		/** Back to the home view with no session open. */
		closeSession: method(z.undefined(), z.undefined()),
		/**
		 * Shows a sessions view in place of the open session, or null to go
		 * back to it; a popped-out view's window comes to the front instead.
		 */
		showView: method(z.object({ view: z.string().nullable() }), z.undefined()),
		/**
		 * Opens a pane of a kind in the open session the way a person does from
		 * "+": shows the session's last pane of the kind (bringing its pop-out
		 * window forward) or opens one. Does nothing with no session open.
		 * Plugins' "Open Files" / "Open Terminal" commands use it.
		 */
		openPane: method(z.object({ kind: z.string().min(1) }), z.undefined()),
	},
});

// --- How sessions are shown ---

/** One choice in a menu item's submenu; `checked` marks the current one. */
export interface SessionMenuChoice {
	readonly id: string;
	readonly title: string;
	readonly checked?: boolean;
}

export interface SessionMenuItem {
	/** Runs the item; given the picked choice when the item has `choices`. */
	run(session: WorkSession, choiceId?: string): void | Promise<void>;
	/** Hides the item for sessions it doesn't apply to. */
	appliesTo?(session: WorkSession): boolean;
	/** Makes the item a submenu of these choices (e.g. a board's columns). */
	choices?(session: WorkSession): readonly SessionMenuChoice[];
}

/** An item in a session's menu, wherever a session is shown (the list row, its page). */
export const SessionMenu = defineExtensionPoint({
	id: "kilo.workbench/session-menu",
	kind: "additive",
	description: "An item in a session's menu.",
	metadata: z.object({
		title: z.string(),
		/** Destructive items sit apart, at the end. */
		destructive: z.boolean().default(false),
	}),
	implementation: implementation<SessionMenuItem>("renderer"),
});

export const SESSION_DECORATION_SLOTS = ["row", "hover", "hover-branch"] as const;
export type SessionDecorationSlot = (typeof SESSION_DECORATION_SLOTS)[number];

export interface SessionDecorationProps {
	readonly session: WorkSession;
	/**
	 * The surface shows the decoration outside its own control (a board card),
	 * so it may be a link or button. Without it the decoration sits inside the
	 * session row's button and must not be interactive.
	 */
	readonly interactive?: boolean;
}

/**
 * Extra detail for a session: a badge on its list row (and its board card),
 * or a line in its details on hover — `hover-branch` takes the place of the
 * session's own branch line, `hover` lines follow the others. A button in
 * the open session's header is a `session-action`.
 */
export const SessionDecoration = defineExtensionPoint({
	id: "kilo.workbench/session-decoration",
	kind: "additive",
	description: "A badge or hover detail shown with a session.",
	metadata: z.object({ slot: z.enum(SESSION_DECORATION_SLOTS) }),
	implementation: implementation<ComponentType<SessionDecorationProps>>("renderer"),
});

export interface SessionRendererProps {
	readonly session: WorkSession;
}

export interface SessionGlyphProps extends SessionRendererProps {
	/** Icon only, for surfaces that show the status as text beside it. */
	readonly decorative?: boolean;
}

export interface SessionDecorationsProps extends SessionRendererProps {
	readonly slot: SessionDecorationSlot;
	/** Passed to each decoration; see {@link SessionDecorationProps.interactive}. */
	readonly interactive?: boolean;
}

export interface SessionMenuProps extends SessionRendererProps {
	/** Starts the surface's own inline rename; without it the menu has no Rename item. */
	readonly onRename?: () => void;
	/** Names the session when many menus share a surface. */
	readonly label?: string;
	readonly side?: "right" | "bottom";
	/** Lets inline rename return focus to the menu that started it. */
	readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * How a session looks wherever it is shown, so a sessions view (the board's
 * cards) shows it as the session list does: its live state glyph and status
 * label, plugins' decorations for a slot, and its menu (pin, rename, archive
 * or restore, plugins' items, delete with the worktree check). The workbench
 * hands them to every sessions view (`SessionsViewProps.renderers`).
 */
export interface SessionRenderers {
	readonly Glyph: ComponentType<SessionGlyphProps>;
	readonly Status: ComponentType<SessionRendererProps>;
	readonly Decorations: ComponentType<SessionDecorationsProps>;
	readonly Menu: ComponentType<SessionMenuProps>;
}

/** Runs in the main window: opens a session there (from any window). */
export const OPEN_SESSION_COMMAND = "kilo.workbench/open-session";
/** Runs in the main window: shows a sessions view there (from any window). */
export const SHOW_SESSIONS_VIEW_COMMAND = "kilo.workbench/show-sessions-view";

/** What a sessions view is given wherever it shows: in place or in its own window. */
export interface SessionsViewProps {
	/** The main window's workspace focus: a workspace id, `unscoped`, or null for every session. */
	readonly focus: string | null;
	/** Opens a session in the main window (and brings that window forward from a pop-out). */
	readonly openSession: (sessionId: string) => void;
	/** True in the view's own window. */
	readonly detached: boolean;
	/** How a session looks, as the session list shows it. */
	readonly renderers: SessionRenderers;
}

export interface SessionsViewImplementation {
	readonly component: ComponentType<SessionsViewProps>;
	/** Actions in the header beside the view's title (the workbench adds pop out / dock). */
	readonly headerActions?: ComponentType<SessionsViewProps>;
	/** The width the view's window opens at, measured from the view on screen. */
	readonly preferredWidth?: () => number | undefined;
}

/**
 * Another view of the session collection, shown in the main area in place of
 * the open session and toggled from the session list's header (through
 * `Workbench.showView`). A `detachable` view can be popped out: the
 * workbench opens it in its own window and docks it back.
 */
export const SessionsView = defineExtensionPoint({
	id: "kilo.workbench/sessions-view",
	kind: "additive",
	description: "Another view of the sessions, shown in place of the open session.",
	metadata: z.object({
		title: z.string(),
		detachable: z.boolean().default(false),
	}),
	implementation: implementation<SessionsViewImplementation>("renderer"),
});

export interface SessionActionProps {
	readonly session: WorkSession;
}

/**
 * A button in an open session's header: `start` ones before the pane
 * controls (the carousel toggle and "+"), `end` ones after them.
 */
export const SessionAction = defineExtensionPoint({
	id: "kilo.workbench/session-action",
	kind: "additive",
	description: "A button in an open session's header.",
	metadata: z.object({ placement: z.enum(["start", "end"]).default("end") }),
	implementation: implementation<ComponentType<SessionActionProps>>("renderer"),
});

/** A session's pull request, as the session list filters by it. */
export type SessionPullRequestState = "open" | "merged" | "closed";

/** What a session facet knows, by session id; sessions it knows nothing about are absent. */
export interface SessionFacetSource<TValue> {
	get(): Readonly<Record<string, TValue>>;
	subscribe(listener: () => void): () => void;
}

/**
 * Read-only facts about sessions the session list filters by, from plugins
 * the workbench doesn't depend on: `pull-request` gives a session's pull
 * request state (the "Pull requests" filter shows while one is contributed).
 * The first contribution of a facet wins.
 */
export const SessionFacet = defineExtensionPoint({
	id: "kilo.workbench/session-facet",
	kind: "additive",
	description: "Read-only facts about sessions the session list filters by.",
	metadata: z.object({ facet: z.enum(["pull-request"]) }),
	implementation: implementation<SessionFacetSource<SessionPullRequestState>>("renderer"),
});

/** A button in the session list's header. */
export const NavigatorAction = defineExtensionPoint({
	id: "kilo.workbench/navigator-action",
	kind: "additive",
	description: "A button in the session list's header.",
	implementation: implementation<ComponentType>("renderer"),
});

/** What a launcher option is given while the launcher shows it. */
export interface LauncherOptionProps {
	readonly workspaceId: string;
	/** The repository's own checkout: the workspace's primary folder. */
	readonly repositoryDirectory: string;
	/** Where the new session would work: the checkout, or the existing worktree picked. */
	readonly directory: string;
	/** Changes where the new session works, e.g. to the worktree a branch is checked out in. */
	readonly onIsolationChange: (isolation: WorkSessionIsolation) => void;
	/** Something the launcher shows changed (a branch was checked out); reads it again. */
	readonly onChanged: () => void;
	readonly disabled: boolean;
}

/**
 * A session-creation option on the New Session page. `branch` takes the
 * place of the read-only branch beside the isolation control (local and
 * existing-worktree modes); the first contribution by priority wins.
 */
export const LauncherOption = defineExtensionPoint({
	id: "kilo.workbench/launcher-option",
	kind: "additive",
	description: "A session-creation option under the launcher's buttons.",
	metadata: z.object({ slot: z.enum(["branch"]) }),
	implementation: implementation<ComponentType<LauncherOptionProps>>("renderer"),
});

/** A session the starter's first send created, not yet shown. */
export interface StartedSession {
	readonly sessionId: string;
	/** Where it works: its worktree, or the workspace's primary folder; null without a folder. */
	readonly directory: string | null;
	readonly workspaceId: string | null;
	readonly worktreeBranch: string | null;
	/** Opens the session in the window (the starter calls it once its first message is on its way). */
	open(): Promise<void>;
	/** Deletes the session again (and a worktree it created) when the starter couldn't use it. */
	discard(): Promise<void>;
}

/** What the session starter is given on the New Session page. */
export interface SessionStarterProps {
	/** The workspace a session would start in; null for none. */
	readonly workspaceId: string | null;
	/** Where the agent would work: the workspace's primary folder, or null. */
	readonly directory: string | null;
	/**
	 * kilo.workbench's controls for where the session runs (workspace,
	 * isolation, branch). Draw them under the starter's input.
	 */
	readonly footer: ReactNode;
	/** True while a session is being started (a worktree may take a while). */
	readonly starting: boolean;
	/**
	 * Creates the session in the workspace with the isolation chosen in the
	 * footer, without opening it. Rejects (having said why) when it can't.
	 */
	start(): Promise<StartedSession>;
}

/**
 * The New Session page's body: what a person types or picks to start a
 * session (kilo.chat's composer, whose first send creates the session).
 * kilo.workbench draws the welcome headline above it. Without a starter the
 * page offers a button per pane kind a session can start with; with one,
 * behind the `new-session-pane-kinds` flag, a quiet row of the others
 * (leaving out `paneKind`, the one the starter opens).
 */
export const SessionStarter = defineExtensionPoint({
	id: "kilo.workbench/session-starter",
	kind: "exclusive",
	description: "The New Session page's body: how a person starts a session.",
	metadata: z.object({
		title: z.string().min(1),
		/** The `kilo.sessions/pane` kind the starter opens in the session it starts. */
		paneKind: z.string().optional(),
	}),
	implementation: implementation<ComponentType<SessionStarterProps>>("renderer"),
});

// --- Layout presets ---

const presetId = z.string().trim().min(1).max(128);
const presetName = z.string().trim().min(1).max(100);

/**
 * A saved arrangement of panes: slots name a pane kind, groups place them as
 * the canvas does (columns, tabs, vertical stacks, widths, pins).
 */
export const layoutTemplateSchema = z
	.object({
		version: z.literal(2),
		arrangement: z.enum(["tiles", "carousel"]),
		activePaneId: presetId.optional(),
		slots: z.array(z.object({ id: presetId, kind: z.string().min(1).max(256) })).max(64),
		groups: z
			.array(
				z.object({
					id: presetId,
					tabs: z.array(presetId).min(1).max(64),
					activePaneId: presetId,
					width: z.number().positive().max(100_000),
					pinned: z.boolean(),
					stackId: z
						.string()
						.regex(/^[a-zA-Z0-9:_-]{1,128}$/)
						.optional(),
					stackWeight: z.number().positive().max(1).optional(),
				}),
			)
			.max(64),
	})
	.superRefine((template, ctx) => {
		const issue = (message: string) => ctx.addIssue({ code: "custom", message });
		const slots = new Set(template.slots.map((slot) => slot.id));
		if (slots.size !== template.slots.length) issue("Slot IDs must be unique.");
		if (new Set(template.groups.map((group) => group.id)).size !== template.groups.length) {
			issue("Group IDs must be unique.");
		}
		const placed = new Set<string>();
		const stacks = new Map<string, (typeof template.groups)[number][]>();
		for (const [index, group] of template.groups.entries()) {
			for (const tab of group.tabs) {
				if (!slots.has(tab) || placed.has(tab)) issue("Each tab must reference a unique slot.");
				placed.add(tab);
			}
			if (!group.tabs.includes(group.activePaneId)) issue("The active pane must be in its group.");
			if (group.stackId !== undefined) {
				const stack = stacks.get(group.stackId) ?? [];
				if (stack.length > 0 && template.groups[index - 1]?.stackId !== group.stackId) {
					issue("Stack groups must be contiguous.");
				}
				stack.push(group);
				stacks.set(group.stackId, stack);
			} else if (group.stackWeight !== undefined) {
				issue("Stack weights require a stack ID.");
			}
		}
		if (placed.size !== slots.size) issue("Each slot must be placed once.");
		if (template.activePaneId !== undefined && !slots.has(template.activePaneId)) {
			issue("The active pane must reference a layout slot.");
		}
		for (const stack of stacks.values()) {
			if (stack.length < 2) issue("A stack needs at least two groups.");
			if (stack.some((group) => group.pinned !== stack[0]!.pinned))
				issue("Stack pinning must agree.");
			const weights = stack.flatMap((group) =>
				group.stackWeight === undefined ? [] : [group.stackWeight],
			);
			if (
				weights.length > 0 &&
				(weights.length !== stack.length ||
					Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-6)
			) {
				issue("Stack weights must all be supplied and sum to one, or all be omitted.");
			}
		}
	});
export type LayoutTemplate = z.output<typeof layoutTemplateSchema>;

export const layoutPresetSchema = z.object({
	id: presetId,
	name: presetName,
	template: layoutTemplateSchema,
});
export type LayoutPreset = z.output<typeof layoutPresetSchema>;

export const layoutsStateSchema = z.object({
	presets: z.array(layoutPresetSchema).max(100),
	/** Applied to each new session; null for none. */
	defaultPresetId: presetId.nullable(),
});
export type LayoutsState = z.output<typeof layoutsStateSchema>;

/** Saved layout presets and the default one, shared by every window. */
export const Layouts = defineDomain({
	id: "kilo.workbench/layouts",
	home: "main",
	state: layoutsStateSchema,
	methods: {
		save: method(
			z.object({
				id: presetId.optional(),
				name: presetName,
				template: layoutTemplateSchema,
				makeDefault: z.boolean().optional(),
			}),
			layoutPresetSchema,
		),
		rename: method(z.object({ id: presetId, name: presetName }), z.undefined()),
		remove: method(z.object({ id: presetId }), z.undefined()),
		setDefault: method(z.object({ id: presetId.nullable() }), z.undefined()),
	},
});

export const WORKBENCH_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		SessionMenu,
		SessionDecoration,
		SessionAction,
		NavigatorAction,
		LauncherOption,
		SessionStarter,
		SessionFacet,
		SessionsView,
	],
	domains: [Workbench, Layouts],
};
