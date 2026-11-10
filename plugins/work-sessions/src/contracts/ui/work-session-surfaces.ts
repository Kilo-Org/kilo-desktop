import type { ComponentType, RefObject } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import type { WorkSession } from "../model/work-sessions";

/**
 * Where plugins add to how work sessions are shown: the session list, an open
 * work session's header, and other views of the work sessions (a board).
 */

// --- Menu ---

/** One choice in a menu item's submenu; `checked` marks the current one. */
export interface WorkSessionMenuChoice {
	readonly id: string;
	readonly title: string;
	readonly checked?: boolean;
}

export interface WorkSessionMenuItem {
	/** Runs the item; given the picked choice when the item has `choices`. */
	run(workSession: WorkSession, choiceId?: string): void | Promise<void>;
	/** Hides the item for work sessions it doesn't apply to. */
	appliesTo?(workSession: WorkSession): boolean;
	/** Makes the item a submenu of these choices (e.g. a board's columns). */
	choices?(workSession: WorkSession): readonly WorkSessionMenuChoice[];
}

/** An item in a work session's menu, wherever a work session is shown (the list row, its page). */
export const WorkSessionMenu = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-menu",
	kind: "additive",
	description: "An item in a work session's menu.",
	metadata: z.object({
		title: z.string(),
		/** Destructive items sit apart, at the end. */
		destructive: z.boolean().default(false),
	}),
	implementation: implementation<WorkSessionMenuItem>("renderer"),
});

// --- Decorations ---

export const WORK_SESSION_DECORATION_SLOTS = ["row", "hover", "hover-branch"] as const;
export type WorkSessionDecorationSlot = (typeof WORK_SESSION_DECORATION_SLOTS)[number];

export interface WorkSessionDecorationProps {
	readonly workSession: WorkSession;
	/**
	 * The surface shows the decoration outside its own control (a board card),
	 * so it may be a link or button. Without it the decoration sits inside the
	 * work session row's button and must not be interactive.
	 */
	readonly interactive?: boolean;
}

/**
 * Extra detail for a work session: a badge on its list row (and its board
 * card), or a line in its details on hover — `hover-branch` takes the place
 * of the work session's own branch line, `hover` lines follow the others. A
 * button in the open work session's header is a `work-session-action`.
 */
export const WorkSessionDecoration = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-decoration",
	kind: "additive",
	description: "A badge or hover detail shown with a work session.",
	metadata: z.object({ slot: z.enum(WORK_SESSION_DECORATION_SLOTS) }),
	implementation: implementation<ComponentType<WorkSessionDecorationProps>>("renderer"),
});

// --- Facets ---

/** The facets the session list knows how to filter by. */
export const WORK_SESSION_FACETS = ["pull-request"] as const;
export type WorkSessionFacetId = (typeof WORK_SESSION_FACETS)[number];

/** A work session's pull request, as the session list filters by it. */
export type WorkSessionPullRequestState = "open" | "merged" | "closed";

/** What a work session facet knows, by work session id; work sessions it knows nothing about are absent. */
export interface WorkSessionFacetSource<TValue> {
	get(): Readonly<Record<string, TValue>>;
	subscribe(listener: () => void): () => void;
}

/**
 * Read-only facts about work sessions the session list filters by, from
 * plugins kilo.work-sessions doesn't depend on: `pull-request` gives a work
 * session's pull request state (the "Pull requests" filter shows while one
 * is contributed). The first contribution of a facet wins.
 */
export const WorkSessionFacet = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-facet",
	kind: "additive",
	description: "Read-only facts about work sessions the session list filters by.",
	metadata: z.object({ facet: z.enum(WORK_SESSION_FACETS) }),
	implementation: implementation<WorkSessionFacetSource<WorkSessionPullRequestState>>("renderer"),
});

// --- How work sessions are shown, and other views of them ---

export interface WorkSessionRendererProps {
	readonly workSession: WorkSession;
}

export interface WorkSessionGlyphProps extends WorkSessionRendererProps {
	/** Icon only, for surfaces that show the status as text beside it. */
	readonly decorative?: boolean;
}

export interface WorkSessionDecorationsProps extends WorkSessionRendererProps {
	readonly slot: WorkSessionDecorationSlot;
	/** Passed to each decoration; see {@link WorkSessionDecorationProps.interactive}. */
	readonly interactive?: boolean;
}

export interface WorkSessionMenuProps extends WorkSessionRendererProps {
	/** Starts the surface's own inline rename; without it the menu has no Rename item. */
	readonly onRename?: () => void;
	/** Names the work session when many menus share a surface. */
	readonly label?: string;
	readonly side?: "right" | "bottom";
	/** Lets inline rename return focus to the menu that started it. */
	readonly triggerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * How a work session looks wherever it is shown, so a work sessions view
 * (the board's cards) shows it as the session list does: its live state
 * glyph and status label, plugins' decorations for a slot, and its menu (pin,
 * rename, archive or restore, plugins' items, delete with the copy check).
 * kilo.work-sessions hands them to every work sessions view
 * (`WorkSessionsViewProps.renderers`).
 */
export interface WorkSessionRenderers {
	readonly Glyph: ComponentType<WorkSessionGlyphProps>;
	readonly Status: ComponentType<WorkSessionRendererProps>;
	readonly Decorations: ComponentType<WorkSessionDecorationsProps>;
	readonly Menu: ComponentType<WorkSessionMenuProps>;
}

/** What a work sessions view is given wherever it shows: in place or in its own window. */
export interface WorkSessionsViewProps {
	/** The main window's workspace focus: a workspace id, `unscoped`, or null for every work session. */
	readonly focus: string | null;
	/** Opens a work session in the main window (and brings that window forward from a pop-out). */
	readonly openWorkSession: (workSessionId: string) => void;
	/** True in the view's own window. */
	readonly detached: boolean;
	/** How a work session looks, as the session list shows it. */
	readonly renderers: WorkSessionRenderers;
}

export interface WorkSessionsViewImplementation {
	readonly component: ComponentType<WorkSessionsViewProps>;
	/** Actions in the header beside the view's title (kilo.work-sessions adds pop out / dock). */
	readonly headerActions?: ComponentType<WorkSessionsViewProps>;
	/** The width the view's window opens at, measured from the view on screen. */
	readonly preferredWidth?: () => number | undefined;
}

/**
 * Another view of the work sessions, shown in the main area in place of the
 * open work session and toggled from the session list's header (through
 * `WorkSessionsWindow.showView`). A `detachable` view can be popped out:
 * kilo.work-sessions opens it in its own window and docks it back.
 */
export const WorkSessionsView = defineExtensionPoint({
	id: "kilo.work-sessions/work-sessions-view",
	kind: "additive",
	description: "Another view of the work sessions, shown in place of the open work session.",
	metadata: z.object({
		title: z.string(),
		detachable: z.boolean().default(false),
	}),
	implementation: implementation<WorkSessionsViewImplementation>("renderer"),
});

// --- Header buttons ---

export interface WorkSessionActionProps {
	readonly workSession: WorkSession;
}

/**
 * A button in an open work session's header: `start` ones before the pane
 * controls (the carousel toggle and "+"), `end` ones after them.
 */
export const WorkSessionAction = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-action",
	kind: "additive",
	description: "A button in an open work session's header.",
	metadata: z.object({ placement: z.enum(["start", "end"]).default("end") }),
	implementation: implementation<ComponentType<WorkSessionActionProps>>("renderer"),
});

/** A button in the session list's header. */
export const WorkSessionListAction = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-list-action",
	kind: "additive",
	description: "A button in the session list's header.",
	implementation: implementation<ComponentType>("renderer"),
});
