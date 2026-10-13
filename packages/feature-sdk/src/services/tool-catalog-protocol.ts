import { z } from "zod";

/**
 * Wire protocol between the app renderer, which owns the `ToolRegistry`, and
 * the main process, which serves those tools to MCP consumers.
 *
 * The renderer transfers a MessagePort to the `kilo-server` feature on
 * {@link TOOL_CATALOG_PORT_CHANNEL}. Over it the renderer (producer) sends full
 * catalog snapshots and call results; main (consumer) sends calls and
 * cancellations. Lives in feature-sdk because both the shell and the
 * `kilo-server` plugin speak it.
 */

export const TOOL_CATALOG_FEATURE_ID = "kilo-server";
export const TOOL_CATALOG_PORT_CHANNEL = "tool-catalog";
export const TOOL_CATALOG_PROTOCOL_VERSION = 1;

/** Upper bound on tools in one snapshot; far above what the app registers. */
export const MAX_CATALOG_TOOLS = 1000;

/** MCP tool names allow only `[A-Za-z0-9_]`, up to 128 characters. */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_]{1,128}$/;

export const toolCatalogPortArgsSchema = z.object({
	version: z.literal(TOOL_CATALOG_PROTOCOL_VERSION),
});

export const toolDescriptorSchema = z.object({
	name: z.string().regex(TOOL_NAME_PATTERN),
	description: z.string(),
	inputSchema: z.looseObject({ type: z.literal("object") }),
	annotations: z
		.object({
			title: z.string().optional(),
			readOnlyHint: z.boolean().optional(),
			destructiveHint: z.boolean().optional(),
			idempotentHint: z.boolean().optional(),
			openWorldHint: z.boolean().optional(),
		})
		.optional(),
	/** Agents may call it only while the user is signed in; main enforces it. */
	requiresSignIn: z.boolean().optional(),
});

export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

const catalogMessageSchema = z.object({
	type: z.literal("catalog"),
	revision: z.number().int().nonnegative(),
	// Descriptors are validated one by one so a single bad tool cannot hide the rest.
	tools: z.array(z.unknown()).max(MAX_CATALOG_TOOLS),
});

const resultMessageSchema = z.union([
	z.object({ type: z.literal("result"), id: z.string(), ok: z.literal(true), result: z.unknown() }),
	z.object({
		type: z.literal("result"),
		id: z.string(),
		ok: z.literal(false),
		error: z.object({ message: z.string() }),
	}),
]);

/** Messages the renderer sends to main. */
export const toolCatalogProducerMessageSchema = z.union([
	catalogMessageSchema,
	resultMessageSchema,
]);
export type ToolCatalogProducerMessage = z.infer<typeof toolCatalogProducerMessageSchema>;

export const toolCallContextSchema = z.object({
	kiloSessionId: z.string().min(1).optional(),
	kiloCallId: z.string().min(1).optional(),
});

/** Messages main sends to the renderer. */
export const toolCatalogConsumerMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("call"),
		id: z.string(),
		name: z.string(),
		args: z.record(z.string(), z.unknown()),
		context: toolCallContextSchema,
	}),
	z.object({ type: z.literal("cancel"), id: z.string() }),
]);
export type ToolCatalogConsumerMessage = z.infer<typeof toolCatalogConsumerMessageSchema>;
