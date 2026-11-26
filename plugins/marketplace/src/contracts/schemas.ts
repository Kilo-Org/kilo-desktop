import { z } from "zod";

/**
 * kilo.marketplace's UI model, in the shapes Kilo v2's Marketplace RPC
 * (`kilocode.marketplace`) reports. Desktop offers agents, skills and MCP
 * servers; v2's `plugin` kind is not offered.
 */
export const marketplaceKindSchema = z.enum(["agent", "skill", "mcp"]);
export type MarketplaceKind = z.infer<typeof marketplaceKindSchema>;

/** Where an item is installed: Kilo's global config, or one project (a workspace's primary folder). */
export const marketplaceScopeSchema = z.enum(["global", "project"]);
export type MarketplaceScope = z.infer<typeof marketplaceScopeSchema>;

export const marketplaceParameterSchema = z.object({
	key: z.string().min(1),
	name: z.string().min(1),
	placeholder: z.string().optional(),
	optional: z.boolean(),
	/** Mask entry; Kilo still writes the value into the MCP config in plaintext. */
	secret: z.boolean().optional(),
});
export type MarketplaceParameter = z.infer<typeof marketplaceParameterSchema>;

/** One way to install an MCP server (v2's `InstallOption`); its parameters override the item's. */
export const marketplaceOptionSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	prerequisites: z.array(z.string()),
	parameters: z.array(marketplaceParameterSchema),
});
export type MarketplaceOption = z.infer<typeof marketplaceOptionSchema>;

/** A catalog item (v2's `KiloMarketplaceRpc.Item`, without the agent and plugin payloads). */
export const marketplaceItemSchema = z.object({
	registry: z.string().min(1),
	kind: marketplaceKindSchema,
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	category: z.string().optional(),
	author: z.string().optional(),
	url: z.string().optional(),
	tags: z.array(z.string()),
	prerequisites: z.array(z.string()),
	parameters: z.array(marketplaceParameterSchema),
	options: z.array(marketplaceOptionSchema),
});
export type MarketplaceItem = z.infer<typeof marketplaceItemSchema>;

/** Names a catalog item for install and preview. */
export const marketplaceItemRefSchema = z.object({
	registry: z.string().min(1),
	kind: marketplaceKindSchema,
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

/** An MCP server's state as v2's `mcp.list` reports it. */
export const marketplaceMcpStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("connected") }),
	z.object({ status: z.literal("pending") }),
	z.object({ status: z.literal("disabled") }),
	z.object({ status: z.literal("failed"), error: z.string() }),
	z.object({ status: z.literal("needs_auth"), error: z.string() }),
]);
export type MarketplaceMcpStatus = z.infer<typeof marketplaceMcpStatusSchema>;

/**
 * One place an item is installed from the Marketplace: v2's installation record
 * (`kilocode.marketplace.installed`), placed in a workspace and given its MCP
 * server's state. Agents, skills and MCP servers configured in Kilo by other
 * means are {@link MarketplaceIncludedItem}s.
 */
export const marketplaceInstalledSchema = z.object({
	registry: z.string().min(1),
	kind: marketplaceKindSchema,
	id: z.string().min(1),
	scope: marketplaceScopeSchema,
	/** The workspace a `project` installation belongs to. */
	workspaceId: z.string().optional(),
	option: z.string().optional(),
	/** The `mcp.servers` key an MCP installation wrote. */
	server: z.string().optional(),
	/** The record's health; anything but `ready` (or a `recovering` record) needs a reinstall or removal. */
	status: z.enum(["ready", "missing", "modified", "incomplete"]).optional(),
	recovering: z.boolean().optional(),
	warnings: z.array(z.string()).optional(),
	mcpStatus: marketplaceMcpStatusSchema.optional(),
	/** What Kilo calls the item, for a record whose catalog item is gone. */
	name: z.string().optional(),
	description: z.string().optional(),
});
export type MarketplaceInstalled = z.infer<typeof marketplaceInstalledSchema>;

export const marketplaceIncludedItemSchema = z.object({
	kind: marketplaceKindSchema,
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	category: z.string().min(1),
	installedIn: z.string().min(1),
});
export type MarketplaceIncludedItem = z.infer<typeof marketplaceIncludedItemSchema>;

export const marketplaceSnapshotSchema = z.object({
	items: z.array(marketplaceItemSchema),
	targets: z.array(marketplaceTargetSchema),
	installed: z.array(marketplaceInstalledSchema),
	included: z.array(marketplaceIncludedItemSchema),
	errors: z.array(z.string()),
	/** The catalog is Kilo's saved copy because a registry couldn't be reached. */
	stale: z.boolean(),
	fetchedAt: z.number().int().nonnegative().nullable(),
});
export type MarketplaceSnapshot = z.infer<typeof marketplaceSnapshotSchema>;

export const marketplaceListInputSchema = z.object({
	workspaceId: z.string().optional(),
});

const destination = {
	scope: marketplaceScopeSchema,
	/** The workspace a `project` install or removal targets. */
	workspaceId: z.string().optional(),
};

export const marketplacePreviewInputSchema = z.object({
	item: marketplaceItemRefSchema,
	...destination,
	option: z.string().optional(),
	params: z.record(z.string(), z.string()).optional(),
});
export type MarketplacePreviewInput = z.infer<typeof marketplacePreviewInputSchema>;

/** What an MCP install will write (v2's `preview`), secrets redacted. */
export const marketplacePreviewSchema = z.object({
	/** The `mcp.servers` entry, as JSON. */
	server: z.string(),
	/** The config file it is written to. */
	config: z.string(),
	/** Names of supplied secret parameters that will be stored in plaintext. */
	secrets: z.array(z.string()),
});
export type MarketplacePreview = z.infer<typeof marketplacePreviewSchema>;

export const marketplaceInstallInputSchema = marketplacePreviewInputSchema.extend({
	/**
	 * The MCP entry (`preview.server`) shown to the user when they confirmed. Required for MCP
	 * installs: main refuses to install if Kilo would now write anything else.
	 */
	reviewed: z.string().optional(),
});
export type MarketplaceInstallInput = z.infer<typeof marketplaceInstallInputSchema>;

export const marketplaceRemoveInputSchema = z.object({
	item: marketplaceItemRefSchema,
	...destination,
});
export type MarketplaceRemoveInput = z.infer<typeof marketplaceRemoveInputSchema>;

export const marketplaceMutationResultSchema = z.object({
	ok: z.literal(true),
});

export const marketplaceMcpAuthenticateInputSchema = z.object({
	/** The `mcp.servers` key. */
	server: z.string().min(1),
	workspaceId: z.string().optional(),
});

/** A bare executable name resolved through PATH; paths and templates are never probed. */
export const mcpCommandSchema = z.string().regex(/^[\w.+-]+$/);

export const marketplaceCheckCommandsInputSchema = z.object({
	commands: z.array(mcpCommandSchema).max(16),
});

export const missingMcpCommandSchema = z.object({
	command: mcpCommandSchema,
	/** Commands that install the runtime providing `command` on this OS; empty when there is no safe one-liner. */
	installCommands: z.array(z.string()),
});
export type MissingMcpCommand = z.infer<typeof missingMcpCommandSchema>;

export const marketplaceCheckCommandsResultSchema = z.object({
	missing: z.array(missingMcpCommandSchema),
});
