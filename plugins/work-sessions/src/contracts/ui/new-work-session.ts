import type { ComponentType } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import type { WorkSessionIsolation } from "../model/work-sessions";

/** What a New Session page option is given while the page shows it. */
export interface NewWorkSessionOptionProps {
	readonly workspaceId: string;
	/** The repository's own checkout: the workspace's primary folder. */
	readonly repositoryDirectory: string;
	/** Where the new work session would work: the checkout, or the existing copy picked. */
	readonly directory: string;
	/** Changes where the new work session works, e.g. to the copy a branch is checked out in. */
	readonly onIsolationChange: (isolation: WorkSessionIsolation) => void;
	/** Something the page shows changed (a branch was checked out); reads it again. */
	readonly onChanged: () => void;
	readonly disabled: boolean;
}

/**
 * A choice on the New Session page; the first contribution by priority wins
 * each slot.
 * - `branch`: takes the place of the read-only branch beside the isolation
 *   control (local and existing-copy modes).
 * - `setup`: in place of the isolation control while the workspace has
 *   nothing to choose (not under version control). Given the primary folder
 *   as both directories; calls `onChanged` once there is something to choose.
 */
export const NewWorkSessionOption = defineExtensionPoint({
	id: "kilo.work-sessions/new-work-session-option",
	kind: "additive",
	description: "A choice on the New Session page, beside where the session runs.",
	metadata: z.object({ slot: z.enum(["branch", "setup"]) }),
	implementation: implementation<ComponentType<NewWorkSessionOptionProps>>("renderer"),
});

/** A work session the starter's first send created, not yet shown. */
export interface StartedWorkSession {
	readonly workSessionId: string;
	/** Where it works: its copy, or the workspace's primary folder; null without a folder. */
	readonly directory: string | null;
	readonly workspaceId: string | null;
	readonly branch: string | null;
	/**
	 * Opens the work session in the window (the starter calls it once its
	 * first message is on its way). The starter must end every start with
	 * `open` or `discard`: the New Session page takes no input until it does.
	 */
	open(): Promise<void>;
	/** Deletes the work session again (and a copy it created) when the starter couldn't use it. */
	discard(): Promise<void>;
}

/** What the work session starter is given on the New Session page. */
export interface WorkSessionStarterProps {
	/** The workspace a work session would start in; null for none. */
	readonly workspaceId: string | null;
	/** Where the agent would work: the workspace's primary folder, or null. */
	readonly directory: string | null;
	/** True from `start()` until the started work session is opened or discarded. */
	readonly starting: boolean;
	/**
	 * Changes each time a person asks for the New Session page (New session,
	 * ⌘N) — take keyboard focus then, from the button that asked. 0 (or
	 * absent) when the page shows for another reason.
	 */
	readonly focusRequest?: number;
	/**
	 * Creates the work session in the workspace with the isolation chosen
	 * above the starter, without opening it. Rejects (having said why) when it
	 * can't.
	 */
	start(): Promise<StartedWorkSession>;
}

/**
 * The New Session page's body: what a person types or picks to start a work
 * session (kilo.chat's composer, whose first send creates it).
 * kilo.work-sessions draws the welcome headline and where the work session
 * runs (workspace, isolation, branch) above it, and under it the tools a
 * work session can start with instead (leaving out `paneKind`, the one the
 * starter opens) and an empty session.
 */
export const WorkSessionStarter = defineExtensionPoint({
	id: "kilo.work-sessions/work-session-starter",
	kind: "exclusive",
	description: "The New Session page's body: how a person starts a session.",
	metadata: z.object({
		title: z.string().min(1),
		/** The `kilo.work-sessions/pane-kind` kind the starter opens in the work session it starts. */
		paneKind: z.string().optional(),
	}),
	implementation: implementation<ComponentType<WorkSessionStarterProps>>("renderer"),
});
