import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "../contract.js";

export const workspaceFolderInputSchema = z.object({
	path: z.string().min(1),
	isPrimary: z.boolean(),
});

export const workspaceFolderSchema = workspaceFolderInputSchema.extend({
	id: z.string(),
	position: z.number().int().nonnegative(),
});

export const workspaceSchema = z.object({
	id: z.string(),
	name: z.string().min(1),
	folders: z.array(workspaceFolderSchema),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export type WorkspaceFolderInput = z.infer<typeof workspaceFolderInputSchema>;
export type WorkspaceFolder = z.infer<typeof workspaceFolderSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceChangeSchema = z.object({
	before: workspaceSchema.nullable(),
	after: workspaceSchema.nullable(),
});
export type WorkspaceChange = z.infer<typeof workspaceChangeSchema>;

export const workspacesContract = defineContract({
	list: defineMethod(z.undefined(), z.array(workspaceSchema)),
	get: defineMethod(z.object({ id: z.string().min(1) }), workspaceSchema),
	create: defineMethod(
		z.object({
			name: z.string().optional(),
			folders: z.array(workspaceFolderInputSchema).min(1),
		}),
		workspaceSchema,
	),
	update: defineMethod(
		z.object({
			id: z.string().min(1),
			name: z.string().optional(),
			folders: z.array(workspaceFolderInputSchema).min(1),
		}),
		workspaceSchema,
	),
	remove: defineMethod(z.object({ id: z.string().min(1) }), z.object({ deleted: z.boolean() })),
});

export type WorkspacesService = InferContract<typeof workspacesContract>;

export interface WorkspaceCapabilities extends Record<string, unknown> {
	workspaceService: WorkspacesService;
}
