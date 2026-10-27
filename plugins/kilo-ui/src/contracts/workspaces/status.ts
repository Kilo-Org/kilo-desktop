import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const workspaceFolderStatusSchema = z.object({
	workspaceId: z.string(),
	unavailableFolders: z.array(z.string()),
});

export type WorkspaceFolderStatus = z.infer<typeof workspaceFolderStatusSchema>;

export const workspaceStatusContract = defineContract({
	"workspaceStatus.list": defineMethod(z.undefined(), z.array(workspaceFolderStatusSchema)),
});

export type WorkspaceStatusService = InferContract<typeof workspaceStatusContract>;
