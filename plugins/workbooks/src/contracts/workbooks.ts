import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

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

/** A workbook in a workspace: which template it came from and where each part of it lives. */
export const workbookSchema = z.object({
	id: z.string().min(1),
	workspaceId: z.string().min(1),
	name: z.string().min(1),
	templateId: z.string().min(1),
	backend: workbookBackendSchema,
	/** The Pages Project; its own document is the Brief. */
	projectId: z.string().min(1),
	url: z.string().optional(),
	guidePageId: z.string().min(1),
	sections: z.array(workbookSectionRefSchema),
	createdAt: z.string(),
});
export type Workbook = z.output<typeof workbookSchema>;

export const addWorkbookInputSchema = workbookSchema.omit({ id: true, createdAt: true });
export type AddWorkbookInput = z.output<typeof addWorkbookInputSchema>;

/** The Kilo MCP server workbooks are created on until a backend can be chosen. */
export const DEFAULT_PAGES_MCP_SERVER = "pages";

export const createWorkbookInputSchema = z.object({
	workspaceId: z.string().min(1),
	templateId: z.string().min(1),
	name: z.string().trim().min(1).max(200),
	/** Brief field values by field id; the template's required fields must be filled. */
	values: z.record(z.string(), z.string()),
});
export type CreateWorkbookInput = z.output<typeof createWorkbookInputSchema>;

/**
 * Every workspace's workbooks, kept by kilo.workbooks (the workbooks
 * themselves live in Pages). Forgetting a workbook removes only the reference.
 */
export const Workbooks = defineDomainObject({
	id: "kilo.workbooks/workbooks",
	home: "main",
	state: z.object({ workbooks: z.array(workbookSchema) }),
	methods: {
		/** Copies a template into a new Pages Project and adds it to the workspace. */
		create: method(createWorkbookInputSchema, workbookSchema),
		/** Adds a reference to a workbook that already exists in Pages. */
		add: method(addWorkbookInputSchema, workbookSchema),
		rename: method(z.object({ id: z.string(), name: z.string().trim().min(1) }), workbookSchema),
		forget: method(z.object({ id: z.string() }), z.object({ forgotten: z.boolean() })),
	},
	lookup: (state, id) => state.workbooks.find((workbook) => workbook.id === id),
});

/** A workspace's workbooks, newest first. */
export function workbooksIn(
	workbooks: readonly Workbook[],
	workspaceId: string | null | undefined,
): Workbook[] {
	return workbooks
		.filter((workbook) => workbook.workspaceId === workspaceId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
