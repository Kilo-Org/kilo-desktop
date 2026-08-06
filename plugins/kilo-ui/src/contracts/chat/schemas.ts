import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

export const kiloChatConnectionInputSchema = z.object({
	chatId: z.uuid(),
});

export const kiloWorkspaceConnectionSchema = z.object({
	baseUrl: z.url(),
	username: z.string().min(1),
	password: z.string().min(1),
	version: z.string().min(1),
	directory: z.string().min(1),
});

export type KiloChatConnectionInput = z.infer<typeof kiloChatConnectionInputSchema>;
export type KiloWorkspaceConnection = z.infer<typeof kiloWorkspaceConnectionSchema>;

export const kiloUiChatContract = defineContract({
	"chat.getConnection": defineMethod(kiloChatConnectionInputSchema, kiloWorkspaceConnectionSchema),
});

export type KiloUiChatService = InferContract<typeof kiloUiChatContract>;
