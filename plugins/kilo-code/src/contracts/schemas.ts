import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

export const kiloServerConnectionSchema = z.object({
	baseUrl: z.url(),
	username: z.string().min(1),
	password: z.string().min(1),
	version: z.string().min(1),
});

export const kiloWorkspaceConnectionSchema = kiloServerConnectionSchema.extend({
	directory: z.string().min(1),
});

export const kiloServerStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("stopped") }),
	z.object({ status: z.literal("starting") }),
	z.object({
		status: z.literal("ready"),
		baseUrl: z.url(),
		version: z.string().min(1),
	}),
	z.object({ status: z.literal("error"), message: z.string().min(1) }),
	z.object({ status: z.literal("unavailable"), message: z.string().min(1) }),
]);

export type KiloServerConnection = z.infer<typeof kiloServerConnectionSchema>;
export type KiloWorkspaceConnection = z.infer<typeof kiloWorkspaceConnectionSchema>;
export type KiloServerStatus = z.infer<typeof kiloServerStatusSchema>;

/** Connection request: unscoped app directory, or a workspace's primary folder. */
export const kiloGetConnectionInputSchema = z.union([
	z.object({ scope: z.literal("unscoped") }),
	z.object({ workspaceId: z.string().min(1) }),
]);

export type KiloGetConnectionInput = z.infer<typeof kiloGetConnectionInputSchema>;

export const kiloCodeContract = defineContract({
	"server.getConnection": defineMethod(kiloGetConnectionInputSchema, kiloWorkspaceConnectionSchema),
	"server.restart": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.status": defineMethod(z.undefined(), kiloServerStatusSchema),
});

export type KiloCodeService = InferContract<typeof kiloCodeContract>;
