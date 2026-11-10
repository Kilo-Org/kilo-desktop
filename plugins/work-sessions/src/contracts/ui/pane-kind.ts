import type { ComponentType } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import { paneKindMetadataSchema, type Pane } from "../model/panes";
import type { WorkSession } from "../model/work-sessions";

/** What a pane kind's component is given. */
export interface PaneProps {
	readonly workSessionId: string;
	readonly pane: Pane;
	/** The work session's workspace, when it has one. */
	readonly workspaceId: string | null;
	/** Where the work session works: its copy, else its workspace's primary folder. */
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
		readonly workSessionId: string;
		readonly pane: Pane;
	}) => Promise<boolean>;
}

/**
 * A kind of pane a work session can hold: terminal, agent, browser… The
 * kind's id is its contribution key (`kilo.terminal/terminal`).
 */
export const PaneKind = defineExtensionPoint({
	id: "kilo.work-sessions/pane-kind",
	kind: "additive",
	description: "A kind of pane a work session can hold.",
	metadata: paneKindMetadataSchema,
	// Listed without one, so main applies a kind's manifest rules and a kind whose
	// plugin fails to load still names its panes.
	implementation: implementation<PaneImplementation>("renderer", { required: false }),
});

export interface PaneKindMenuProps {
	readonly workSession: WorkSession;
}

/**
 * Entries in the menu of a pane kind pinned to the work session header
 * (`pane-kind` `launch.sessionHeader`), under its "New <kind>" item: with
 * one, clicking the pinned button opens the menu instead of launching. The
 * component renders menu items (`DropdownMenuSeparator`, then
 * `DropdownMenuGroup`s), or nothing when it has none, for `paneKind`: e.g.
 * the agent kind's chats, to reopen a closed one.
 */
export const PaneKindMenu = defineExtensionPoint({
	id: "kilo.work-sessions/pane-kind-menu",
	kind: "additive",
	description: "Entries in the header menu of a pinned pane kind.",
	metadata: z.object({ paneKind: z.string() }),
	implementation: implementation<ComponentType<PaneKindMenuProps>>("renderer"),
});
