import type { ComponentType } from "react";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import { paneKindMetadataSchema, type Pane, type PaneStatus } from "../model/panes";
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
	/** The tab's icon; `status` lets a kind change its shape (the tab colours it by status). */
	readonly icon?: ComponentType<{ className?: string; iconKey?: string; status?: PaneStatus }>;
	/**
	 * Asked before the person closes one of its panes (unsaved changes);
	 * false keeps it open. Closing fails open: a guard that rejects closes it.
	 */
	readonly canClose?: (input: {
		readonly workSessionId: string;
		readonly pane: Pane;
	}) => Promise<boolean>;
	/**
	 * Called when the person shows they mean to open a work session holding
	 * one of its panes (they rest the pointer on its row): load ahead what the
	 * pane would load once shown, so opening is instant. Best effort and
	 * possibly repeated; the work session may never open.
	 */
	readonly prefetch?: (input: PanePrefetchInput) => void;
	/**
	 * The absolute path of the file one of its panes shows, if any: what the
	 * tab menu's "Copy path" copies. Without it, a pane that opened a
	 * `kilo.work-sessions/file` object uses that file's path.
	 */
	readonly path?: (pane: Pane) => string | undefined;
}

export interface PanePrefetchInput {
	readonly workSession: WorkSession;
	readonly pane: Pane;
	/** Every pane in the work session, in order. */
	readonly panes: readonly Pane[];
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
