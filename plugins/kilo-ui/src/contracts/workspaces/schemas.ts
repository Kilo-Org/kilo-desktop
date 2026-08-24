import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

import { workspaceIdentityColorSchema } from "./identity-color.js";

export {
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	WORKSPACE_IDENTITY_COLORS,
	workspaceIdentityColorSchema,
} from "./identity-color.js";

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
	color: workspaceIdentityColorSchema.optional(),
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

export const createWorkspaceInputSchema = z.object({
	name: z.string().optional(),
	color: workspaceIdentityColorSchema.optional(),
	folders: z.array(workspaceFolderInputSchema).min(1),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = createWorkspaceInputSchema.extend({
	id: z.string().min(1),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const workspacesContract = defineContract({
	list: defineMethod(z.undefined(), z.array(workspaceSchema)),
	get: defineMethod(z.object({ id: z.string().min(1) }), workspaceSchema.nullable()),
	create: defineMethod(createWorkspaceInputSchema, workspaceSchema),
	update: defineMethod(updateWorkspaceInputSchema, workspaceSchema),
	remove: defineMethod(z.object({ id: z.string().min(1) }), z.object({ deleted: z.boolean() })),
});

export type WorkspacesService = InferContract<typeof workspacesContract>;

export interface WorkspaceCapabilityService {
	list(): Promise<Workspace[]>;
	get(id: string): Promise<Workspace | null>;
	create(input: CreateWorkspaceInput): Promise<Workspace>;
	update(input: UpdateWorkspaceInput): Promise<Workspace>;
	remove(id: string): Promise<{ deleted: boolean }>;
}

export interface WorkspaceCapabilities extends Record<string, unknown> {
	workspaceService: WorkspaceCapabilityService;
}
