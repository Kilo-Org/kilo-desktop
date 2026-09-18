import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

import { workspaceFolderInputSchema } from "../workspaces/schemas.js";

export const kiloSessionPreparationInputSchema = z.object({
	workspaceId: z.string().min(1).optional(),
});

export const kiloGlobalConnectionSchema = z.object({
	baseUrl: z.url(),
	username: z.string().min(1),
	password: z.string().min(1),
	version: z.string().min(1),
	globalDirectory: z.string().min(1),
});

export const kiloSessionPreparationSchema = z.object({
	directory: z.string().min(1),
	workspaceId: z.string().min(1).optional(),
	workspaceFolders: z.array(workspaceFolderInputSchema),
});

export type KiloGlobalConnection = z.infer<typeof kiloGlobalConnectionSchema>;
export type KiloSessionPreparation = z.infer<typeof kiloSessionPreparationSchema>;

export const kiloUiChatContract = defineContract({
	"chat.getConnection": defineMethod(z.undefined(), kiloGlobalConnectionSchema),
	"chat.prepareSession": defineMethod(
		kiloSessionPreparationInputSchema,
		kiloSessionPreparationSchema,
	),
});

export type KiloUiChatService = InferContract<typeof kiloUiChatContract>;
