import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const mcpAppResourceSchema = z.object({
	uri: z.string().min(1),
	mimeType: z.literal("text/html;profile=mcp-app"),
	html: z.string(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

export type McpAppResource = z.infer<typeof mcpAppResourceSchema>;

export const mcpAppsContract = defineContract({
	"mcpApps.readAppResource": defineMethod(
		z.object({ uri: z.string().min(1), serverId: z.string().min(1).optional() }),
		mcpAppResourceSchema,
	),
	"mcpApps.callTool": defineMethod(
		z.object({
			name: z.string().min(1),
			arguments: z.record(z.string(), z.unknown()).optional(),
			serverId: z.string().min(1).optional(),
		}),
		z.unknown(),
	),
	"mcpApps.readResource": defineMethod(
		z.object({ uri: z.string().min(1), serverId: z.string().min(1).optional() }),
		z.unknown(),
	),
	"mcpApps.listResources": defineMethod(
		z.object({ serverId: z.string().min(1).optional() }).optional(),
		z.unknown(),
	),
});

export type McpAppsService = InferContract<typeof mcpAppsContract>;
