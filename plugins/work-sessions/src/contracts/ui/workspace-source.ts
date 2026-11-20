import type { ComponentType, ReactNode } from "react";
import { z } from "zod";

import { defineExtensionPoint, implementation } from "@kilo-desktop/kernel";

import type { Workspace } from "../model/workspaces";

/** What the new-folder form collects: the folder is made at `<parentPath>/<name>`. */
export interface NewFolderDetails {
	/** The workspace's name, which is also the new folder's. */
	readonly name: string;
	/** `#RRGGBB`. */
	readonly color: string;
	readonly parentPath: string;
}

/**
 * A choice already made on an earlier screen (the repository picked), shown
 * after the chosen source in the line of choices at the top of the screen;
 * clicking it makes the choice again.
 */
export interface WorkspaceSourceChoice {
	readonly label: string;
	readonly icon?: ComponentType<{ className?: string }>;
	/** The accessible name of making it again, e.g. "Choose another repository". */
	readonly changeLabel: string;
	readonly onChange: () => void;
	/** A stable `data-qa-id` for the choice. */
	readonly qaId?: string;
}

/**
 * One screen of a source, which the host draws in its own frame: the New
 * workspace dialog or the onboarding card, under the host's heading and one
 * line of the choices made so far — the source (clicking it returns to the
 * list of sources), then the source's own `choice`.
 */
export interface WorkspaceSourceView {
	/** Shown under the host's heading, e.g. "Choose a repository to clone." */
	readonly description?: string;
	readonly choice?: WorkspaceSourceChoice;
	readonly body: ReactNode;
	/** The screen's action, also run by Enter in a field; null when the body acts itself (picking from a list). */
	readonly primary: {
		readonly label: string;
		readonly disabled?: boolean;
		readonly onClick: () => void;
	} | null;
	/** The action is running; the host disables its frame's buttons. */
	readonly busy?: boolean;
}

/** The new-folder form, as a source fills it in. */
export interface NewFolderFormProps {
	readonly description?: string;
	/** The choice this form follows (the repository being cloned), after the source. */
	readonly choice?: WorkspaceSourceChoice;
	/** Shown above the fields. */
	readonly summary?: ReactNode;
	/** The form's first field, e.g. the URL to clone. */
	readonly leadingField?: ReactNode;
	/** The name to use until the person types one; it may change as other inputs do. */
	readonly suggestedName?: string;
	/** The source's own inputs (a valid URL) are filled in; false keeps Create disabled. */
	readonly ready?: boolean;
	/** The primary button while `create` runs, e.g. "Cloning…". */
	readonly pendingLabel: string;
	/** The heading of a failure `create` rejects with, e.g. "Couldn't clone the repository". */
	readonly errorTitle: string;
	/** Makes the folder and the workspace around it; rejects (with why) when it can't. */
	readonly create: (details: NewFolderDetails) => Promise<Workspace>;
}

/** What a workspace source is given while a host shows it. */
export interface WorkspaceSourceProps {
	/** The workspace exists: the host makes it active and moves on. */
	readonly onCreated: (workspace: Workspace) => void;
	/**
	 * kilo.work-sessions' form for a workspace in a new folder — name (also
	 * the folder's), identity colour and location, starting at
	 * `newFolderLocation` — for sources that make a folder (a clone). It
	 * presents itself through the host and calls `onCreated` once `create`
	 * resolves; render it in place of `children(view)`.
	 */
	readonly NewFolderForm: ComponentType<NewFolderFormProps>;
	/** `filled` is a tinted surface without outlines (onboarding): fields drop their borders. */
	readonly appearance: "outlined" | "filled";
	/** Draws the source's current screen in the host's frame; the source returns what it returns. */
	readonly children: (view: WorkspaceSourceView) => ReactNode;
}

export interface WorkspaceSourceImplementation {
	/** Drawn at `size-4`, in the source's row. */
	readonly icon: ComponentType<{ className?: string }>;
	/** The source's screens, each presented with `children(view)`. */
	readonly Component: ComponentType<WorkspaceSourceProps>;
	/**
	 * Called once each time a host offers the sources (the New workspace
	 * dialog or onboarding opens), before one is chosen, to warm what the
	 * source's screens will read (a slow list). Runs in the background: keep
	 * it cheap when there is nothing to warm, and don't let it reject.
	 */
	readonly prepare?: () => void;
}

/**
 * A way to start a workspace, offered in the New workspace dialog and the
 * onboarding workspace step (highest priority first); choosing one shows its
 * screens in place of the list. kilo.work-sessions' own Local folder source
 * (existing folders, or a new empty one) comes through here too.
 */
export const WorkspaceSource = defineExtensionPoint({
	id: "kilo.work-sessions/workspace-source",
	kind: "additive",
	description: "A way to start a workspace, offered in the New workspace dialog.",
	metadata: z.object({ title: z.string().min(1), description: z.string().min(1) }),
	implementation: implementation<WorkspaceSourceImplementation>("renderer"),
});
