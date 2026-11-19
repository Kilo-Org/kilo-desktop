import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	defineObjectType,
	isQualifiedId,
	method,
	whenSchema,
	type ObjectRef,
	type QualifiedId,
} from "@kilo-desktop/kernel";

/** One pane of a work session, resolved by `kilo.work-sessions/panes`; keyed `<workSessionId>/<paneId>`. */
export const PaneObjectType = defineObjectType({
	id: "kilo.work-sessions/pane",
	description: "A pane open in a work session, keyed <workSessionId>/<paneId>.",
});

/** The `kilo.work-sessions/panes` lookup key of a pane. */
export function paneKey(workSessionId: string, paneId: string): string {
	return `${workSessionId}/${paneId}`;
}

/** How wide a pane starts in a layout (`@kilo-desktop/pane-layout` kinds). */
export const PANE_LAYOUT_KINDS = ["agent", "document", "notebook", "tool"] as const;

/** A reference to any object by its type (`kilo.work-sessions/file`, `kilo.core/chat`…) and id. */
export const objectRefSchema: z.ZodType<ObjectRef, ObjectRef> = z.object({
	type: z.custom<QualifiedId>(
		(value) => typeof value === "string" && isQualifiedId(value),
		"Expected a qualified object type: <owner>/<name>",
	),
	id: z.string().min(1),
});

/** What a pane's tab says: working, waiting for the person, or finished while not on screen. */
export const PANE_STATUSES = ["busy", "attention", "unread"] as const;
export type PaneStatus = (typeof PANE_STATUSES)[number];

export const paneSchema = z.object({
	/** Unique within its work session. */
	id: z.string().min(1),
	/** The pane kind's contribution key, e.g. `kilo.terminal/terminal`. */
	kind: z.string().min(1),
	title: z.string(),
	/** Lets a kind vary its icon per pane (a file type). */
	iconKey: z.string().optional(),
	/** What the pane shows (a file, a URL, a chat), resolvable by its type. */
	object: objectRefSchema.optional(),
	/** The kind's own small facts. */
	metadata: z.record(z.string(), z.string()),
	/** 1 for the first pane of its kind in the work session, 2 for the next… */
	ordinal: z.number().int().positive(),
	/** A badge for its tab; absent when there is nothing to say. */
	status: z.enum(PANE_STATUSES).optional(),
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

const paneTarget = z.object({ workSessionId: z.string().min(1), paneId: z.string().min(1) });

export const openPaneInputSchema = z.object({
	workSessionId: z.string().min(1),
	kind: z.string().min(1),
	title: z.string().optional(),
	iconKey: z.string().optional(),
	object: objectRefSchema.optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	/** Reuses this pane when it exists (it must be of the same kind). */
	paneId: z.string().min(1).optional(),
	/** Makes it the work session's active pane (default true). */
	activate: z.boolean().optional(),
	/**
	 * Where a new pane goes: `tab` joins the active pane's group (what a
	 * person picking a pane expects); `group`, the default, leaves it to the
	 * canvas, which gives it its own column beside the others (an agent's
	 * pane, so the chat stays in view).
	 */
	placement: z.enum(["tab", "group"]).optional(),
	/**
	 * With `tab`, the group the tab joins instead of the active pane's (a
	 * group's own "+"). Placing it here rather than moving it after it opens
	 * keeps the canvas from showing it in a column of its own for a frame.
	 */
	groupId: z.string().min(1).optional(),
});
export type OpenPaneInput = z.input<typeof openPaneInputSchema>;

export const updatePaneInputSchema = paneTarget.extend({
	title: z.string().optional(),
	iconKey: z.string().optional(),
	/** Null clears it. */
	object: objectRefSchema.nullable().optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	/** Null clears it. */
	status: z.enum(PANE_STATUSES).nullable().optional(),
});
export type UpdatePaneInput = z.input<typeof updatePaneInputSchema>;

export const panesStateSchema = z.object({
	byWorkSession: z.record(z.string(), workSessionPanesSchema),
});
export type PanesState = z.output<typeof panesStateSchema>;

/**
 * The panes open in every work session, with each work session's layout,
 * arrangement and active pane, shared by every window. A pane of a kind
 * whose plugin is missing stays listed and renders as unavailable.
 */
export const Panes = defineDomainObject({
	id: "kilo.work-sessions/panes",
	home: "main",
	description: "The panes open in every work session, their layout and arrangement.",
	state: panesStateSchema,
	lookup: (state, key) => {
		const slash = key.indexOf("/");
		if (slash <= 0) return undefined;
		return state.byWorkSession[key.slice(0, slash)]?.panes.find(
			(pane) => pane.id === key.slice(slash + 1),
		);
	},
	objectType: PaneObjectType,
	methods: {
		/** Opens a pane; a singleton kind's existing pane is activated instead. */
		open: method(openPaneInputSchema, paneSchema),
		/**
		 * Opens an object (a file, a URL) in the pane kind of the
		 * highest-priority `opener` whose type and glob match it, reusing the
		 * pane already showing it. Null when no opener matches.
		 */
		openObject: method(
			z.object({
				workSessionId: z.string().min(1),
				ref: objectRefSchema,
				/** Makes it the work session's active pane (default true). */
				activate: z.boolean().optional(),
			}),
			paneSchema.nullable(),
		),
		activate: method(paneTarget, z.undefined()),
		update: method(updatePaneInputSchema, paneSchema),
		close: method(paneTarget, z.object({ closed: z.boolean() })),
		setLayout: method(
			z.object({
				workSessionId: z.string().min(1),
				layout: z.string().max(200_000),
				activePaneId: z.string().nullable().optional(),
			}),
			z.undefined(),
		),
		setArrangement: method(
			z.object({ workSessionId: z.string().min(1), arrangement: z.enum(ARRANGEMENTS) }),
			z.undefined(),
		),
	},
	events: {
		opened: z.object({ workSessionId: z.string(), pane: paneSchema }),
		closed: z.object({ workSessionId: z.string(), pane: paneSchema }),
	},
});

/**
 * Opens objects of a type (optionally matching a glob on their id) in a pane
 * kind. The contribution's `priority` orders openers that match the same
 * object, higher first: a general opener (kilo.files, any file) takes a low
 * one so specific ones (`*.ipynb`) win.
 */
export const Opener = defineExtensionPoint({
	id: "kilo.work-sessions/opener",
	kind: "additive",
	description: "Opens an object (a file, a URL) in a pane kind.",
	metadata: z.object({
		match: z.object({
			/** An object type, e.g. `kilo.work-sessions/file`. */
			type: z.string().min(1),
			/** A glob on the object's id, e.g. `*.ipynb`. */
			pattern: z.string().optional(),
		}),
		/** The pane kind's contribution key. */
		pane: z.string().min(1),
	}),
});

/**
 * What a `pane-kind` contribution declares in its manifest. Main applies the
 * rules (`singleton`), so they are data, readable without the renderer.
 */
export const paneKindMetadataSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	/**
	 * Where it can be started: the New Session page, the "+" in a work
	 * session, or its own button in the work session's header (instead of the
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
	/** At most one per work session; opening it again shows the existing one. */
	singleton: z.boolean().default(false),
	/** Stays mounted while hidden (terminals, web pages). */
	keepAlive: z.boolean().default(false),
	layoutKind: z.enum(PANE_LAYOUT_KINDS).default("tool"),
	/** Where it is listed (the New Session page, the "+" menus): lower first; ties keep plugin order. */
	order: z.number().default(100),
	/** Listed, but not startable, unless this holds (e.g. signed in). */
	availableWhen: whenSchema.optional(),
	/** Why it can't be started while `availableWhen` doesn't hold. */
	unavailableHint: z.string().optional(),
	/** The command that opens it (`kilo.terminal/open`); its shortcut is shown where the kind is offered. */
	openCommand: z.string().optional(),
});
export type PaneKindMetadata = z.output<typeof paneKindMetadataSchema>;
