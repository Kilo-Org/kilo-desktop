import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

export const marketplaceTypeSchema = z.enum(["agent", "skill", "mcp"]);
export type MarketplaceType = z.infer<typeof marketplaceTypeSchema>;

export const marketplaceScopeSchema = z.enum(["global", "workspace"]);
export type MarketplaceScope = z.infer<typeof marketplaceScopeSchema>;

export const mcpParameterSchema = z.object({
	name: z.string().min(1),
	key: z.string().min(1),
	placeholder: z.string().optional(),
	optional: z.boolean().optional(),
});
export type McpParameter = z.infer<typeof mcpParameterSchema>;

export const mcpMethodSchema = z.object({
	name: z.string().min(1),
	content: z.string().min(1),
	parameters: z.array(mcpParameterSchema).optional(),
	prerequisites: z.array(z.string()).optional(),
});
export type McpMethod = z.infer<typeof mcpMethodSchema>;

export const marketplaceIconSchema = z.object({
	src: z.url(),
	mimeType: z.string().optional(),
	sizes: z.array(z.string()).optional(),
	theme: z.enum(["light", "dark"]).optional(),
});

const itemBase = {
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	category: z.string().min(1),
	author: z.string().optional(),
	authorUrl: z.url().optional(),
	prerequisites: z.array(z.string()).optional(),
};

export const agentMarketplaceItemSchema = z.object({
	...itemBase,
	type: z.literal("agent"),
	content: z.object({
		mode: z.enum(["primary", "subagent", "all"]),
		description: z.string(),
		prompt: z.string(),
		options: z.record(z.string(), z.unknown()).optional(),
		permission: z.record(z.string(), z.unknown()).optional(),
	}),
});
export type AgentMarketplaceItem = z.infer<typeof agentMarketplaceItemSchema>;

export const skillMarketplaceItemSchema = z.object({
	...itemBase,
	type: z.literal("skill"),
	content: z.url(),
	githubUrl: z.url(),
});
export type SkillMarketplaceItem = z.infer<typeof skillMarketplaceItemSchema>;

export const mcpMarketplaceItemSchema = z.object({
	...itemBase,
	type: z.literal("mcp"),
	url: z.url(),
	icons: z.array(marketplaceIconSchema).optional(),
	iconDataUrl: z.string().startsWith("data:image/").optional(),
	content: z.union([z.string().min(1), z.array(mcpMethodSchema).min(1)]),
	parameters: z.array(mcpParameterSchema).optional(),
});
export type McpMarketplaceItem = z.infer<typeof mcpMarketplaceItemSchema>;

export const marketplaceItemSchema = z.discriminatedUnion("type", [
	agentMarketplaceItemSchema,
	skillMarketplaceItemSchema,
	mcpMarketplaceItemSchema,
]);
export type MarketplaceItem = z.infer<typeof marketplaceItemSchema>;

export const marketplaceItemRefSchema = z.object({
	type: marketplaceTypeSchema,
	id: z.string().min(1),
});
export type MarketplaceItemRef = z.infer<typeof marketplaceItemRefSchema>;

export const marketplaceTargetSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	directory: z.string().min(1),
	color: z.string().optional(),
});
export type MarketplaceTarget = z.infer<typeof marketplaceTargetSchema>;

export const marketplaceInstalledSchema = marketplaceItemRefSchema.extend({
	scope: marketplaceScopeSchema,
	workspaceId: z.string().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	installedIn: z.string().optional(),
	url: z.url().optional(),
	iconDataUrl: z.string().startsWith("data:image/").optional(),
});
export type MarketplaceInstalled = z.infer<typeof marketplaceInstalledSchema>;

export const marketplaceIncludedItemSchema = z.object({
	type: marketplaceTypeSchema,
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	category: z.string().min(1),
	installedIn: z.string().min(1),
	iconDataUrl: z.string().startsWith("data:image/").optional(),
});
export type MarketplaceIncludedItem = z.infer<typeof marketplaceIncludedItemSchema>;

export const marketplaceMcpStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("connected") }),
	z.object({ status: z.literal("disabled") }),
	z.object({ status: z.literal("needs_auth") }),
	z.object({ status: z.literal("failed"), error: z.string() }),
	z.object({ status: z.literal("needs_client_registration"), error: z.string() }),
]);
export type MarketplaceMcpStatus = z.infer<typeof marketplaceMcpStatusSchema>;

export const marketplaceSnapshotSchema = z.object({
	items: z.array(marketplaceItemSchema),
	targets: z.array(marketplaceTargetSchema),
	installed: z.array(marketplaceInstalledSchema),
	included: z.array(marketplaceIncludedItemSchema),
	mcpStatuses: z.record(z.string(), marketplaceMcpStatusSchema),
	mcpInstallationStatuses: z.record(z.string(), marketplaceMcpStatusSchema).default({}),
	errors: z.array(z.string()),
	stale: z.boolean(),
	fetchedAt: z.number().int().nonnegative().nullable(),
});
export type MarketplaceSnapshot = z.infer<typeof marketplaceSnapshotSchema>;

export const marketplaceListInputSchema = z.object({
	workspaceId: z.string().optional(),
});

export const marketplaceMutationInputSchema = z.object({
	item: marketplaceItemRefSchema,
	scope: marketplaceScopeSchema,
	workspaceId: z.string().optional(),
	method: z.string().optional(),
	parameters: z.record(z.string(), z.string()).optional(),
});
export type MarketplaceMutationInput = z.infer<typeof marketplaceMutationInputSchema>;

export const marketplaceMutationResultSchema = z.object({
	ok: z.literal(true),
	path: z.string().optional(),
});

export const marketplaceMcpAuthenticateInputSchema = z.object({
	id: z.string().min(1),
	workspaceId: z.string().optional(),
});

export const marketplaceContract = defineContract({
	"marketplace.list": defineMethod(marketplaceListInputSchema, marketplaceSnapshotSchema),
	"marketplace.refresh": defineMethod(marketplaceListInputSchema, marketplaceSnapshotSchema),
	"marketplace.install": defineMethod(
		marketplaceMutationInputSchema,
		marketplaceMutationResultSchema,
	),
	"marketplace.remove": defineMethod(
		marketplaceMutationInputSchema.omit({ method: true, parameters: true }),
		marketplaceMutationResultSchema,
	),
	"marketplace.authenticateMcp": defineMethod(
		marketplaceMcpAuthenticateInputSchema,
		marketplaceMutationResultSchema,
	),
});

export type MarketplaceService = InferContract<typeof marketplaceContract>;
