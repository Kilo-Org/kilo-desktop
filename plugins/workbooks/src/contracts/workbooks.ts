import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

import { kickoffInputSchema } from "./sessions";
import { ITEM_TYPES } from "./templates";

/**
 * Where a workbook's content lives. For now every workbook is a Pages Project
 * reached through one of Kilo's MCP servers (the user's `pages` entry); a
 * local Pages server would be another MCP server name.
 */
export const workbookBackendSchema = z.object({
	kind: z.literal("pages-mcp"),
	/** The Kilo MCP server name the Pages tools are called on. */
	server: z.string().min(1),
});
export type WorkbookBackend = z.output<typeof workbookBackendSchema>;

export const workbookSectionRefSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	itemType: z.enum(ITEM_TYPES),
	pageId: z.string().min(1),
});
export type WorkbookSectionRef = z.output<typeof workbookSectionRefSchema>;

/** A workspace a workbook has been used in, and when it last was. */
export const workbookUseSchema = z.object({
	workspaceId: z.string().min(1),
	lastUsedAt: z.string(),
});
export type WorkbookUse = z.output<typeof workbookUseSchema>;

/**
 * A workbook: which template it came from and where each part of it lives.
 * Workbooks belong to the person, not to a workspace; the workspaces it has
 * been used in only order the picker.
 */
export const workbookSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	templateId: z.string().min(1),
	backend: workbookBackendSchema,
	/** The Pages Project; its own document is the Brief. */
	projectId: z.string().min(1),
	url: z.string().optional(),
	guidePageId: z.string().min(1),
	sections: z.array(workbookSectionRefSchema),
	createdAt: z.string(),
	/** When a work session last started on it (its creation, until then). */
	lastUsedAt: z.string(),
	usedIn: z.array(workbookUseSchema),
});
export type Workbook = z.output<typeof workbookSchema>;

/** The workspace a workbook is added or created in, its first use; null for none. */
const originWorkspaceSchema = z.string().min(1).nullable();

export const addWorkbookInputSchema = workbookSchema
	.omit({ id: true, createdAt: true, lastUsedAt: true, usedIn: true })
	.extend({ workspaceId: originWorkspaceSchema });
export type AddWorkbookInput = z.output<typeof addWorkbookInputSchema>;

/** The Kilo MCP server workbooks are created on until a backend can be chosen. */
export const DEFAULT_PAGES_MCP_SERVER = "pages";

export const createWorkbookInputSchema = z.object({
	workspaceId: originWorkspaceSchema,
	templateId: z.string().min(1),
	name: z.string().trim().min(1).max(200),
	/** Brief field values by field id; the template's required fields must be filled. */
	values: z.record(z.string(), z.string()),
});
export type CreateWorkbookInput = z.output<typeof createWorkbookInputSchema>;

export const STEP_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;

/** Where a workbook is at, read from Pages: what a resume view shows. */
export const workbookProgressSchema = z.object({
	whereILeftOff: z.array(z.string()),
	steps: z.array(
		z.object({ number: z.number(), title: z.string(), status: z.enum(STEP_STATUSES) }),
	),
	/** The suggested next step, when there is one. */
	next: z.object({ number: z.number(), title: z.string() }).optional(),
	openTasks: z.number(),
	openQuestions: z.number(),
	openReview: z.number(),
});
export type WorkbookProgress = z.output<typeof workbookProgressSchema>;

/**
 * The person's workbooks, kept by kilo.workbooks (the workbooks themselves
 * live in Pages). Forgetting a workbook removes only the reference. Starting a
 * work session on one (`session-workbooks` `setActive`) records the use.
 */
export const Workbooks = defineDomainObject({
	id: "kilo.workbooks/workbooks",
	home: "main",
	state: z.object({ workbooks: z.array(workbookSchema) }),
	methods: {
		/** Copies a template into a new Pages Project and records it. */
		create: method(createWorkbookInputSchema, workbookSchema),
		/** Adds a reference to a workbook that already exists in Pages. */
		add: method(addWorkbookInputSchema, workbookSchema),
		rename: method(z.object({ id: z.string(), name: z.string().trim().min(1) }), workbookSchema),
		forget: method(z.object({ id: z.string() }), z.object({ forgotten: z.boolean() })),
		/** Where the workbook is at (Where I left off, plan progress, open items), read from Pages. */
		progress: method(z.object({ workbookId: z.string() }), workbookProgressSchema),
		/** The first message for a chat starting work on a workbook, optionally on one item. */
		kickoff: method(kickoffInputSchema, z.string()),
	},
	lookup: (state, id) => state.workbooks.find((workbook) => workbook.id === id),
});

/**
 * Workbooks as the picker lists them: those used in the workspace, most
 * recently used there first, then the rest by when they were last used.
 * Without a workspace, every workbook is elsewhere.
 */
export function workbooksFor(
	workbooks: readonly Workbook[],
	workspaceId: string | null | undefined,
): { here: Workbook[]; elsewhere: Workbook[] } {
	const usedHere = (workbook: Workbook) =>
		workbook.usedIn.find((use) => use.workspaceId === workspaceId)?.lastUsedAt;
	const here = workbooks
		.filter((workbook) => workspaceId && usedHere(workbook))
		.sort((a, b) => usedHere(b)!.localeCompare(usedHere(a)!));
	const elsewhere = workbooks
		.filter((workbook) => !here.includes(workbook))
		.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
	return { here, elsewhere };
}
