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
	globalDirectory: z.string().min(1),
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
export type KiloServerStatus = z.infer<typeof kiloServerStatusSchema>;

/** Connection request: absolute working directory for the Kilo session. */
export const kiloGetConnectionInputSchema = z.object({
	directory: z.string().min(1),
});

export type KiloGetConnectionInput = z.infer<typeof kiloGetConnectionInputSchema>;

// ─── MCP configuration schemas ─────────────────────────────────────────────────

export const mcpScopeSchema = z.enum(["global"]);

export const mcpRemoteTransportSchema = z.object({
	type: z.literal("remote"),
	url: z.url(),
	headers: z.record(z.string(), z.string()).optional(),
});

export const mcpStdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
});

export const mcpTransportSchema = z.discriminatedUnion("type", [
	mcpRemoteTransportSchema,
	mcpStdioTransportSchema,
]);

/** MCP server ID: alphanumeric, hyphens, underscores, dots, and slashes. */
const mcpIdSchema = z
	.string()
	.min(1)
	.regex(/^[\w][\w\-./]*$/);

export const mcpServerInfoSchema = z.object({
	id: mcpIdSchema,
	scope: mcpScopeSchema,
	transport: mcpTransportSchema,
	enabled: z.boolean(),
});

export type McpScope = z.infer<typeof mcpScopeSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpServerInfo = z.infer<typeof mcpServerInfoSchema>;

const mcpSaveInputSchema = z.object({
	scope: mcpScopeSchema,
	id: mcpIdSchema,
	transport: mcpTransportSchema,
	enabled: z.boolean(),
});

const mcpRemoveInputSchema = z.object({
	scope: mcpScopeSchema,
	id: mcpIdSchema,
});

const mcpSetEnabledInputSchema = z.object({
	scope: mcpScopeSchema,
	id: mcpIdSchema,
	enabled: z.boolean(),
});

const okSchema = z.object({ ok: z.literal(true) });

// ─── Contract ───────────────────────────────────────────────────────────────────

export const kiloServerContract = defineContract({
	"server.getConnection": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.restart": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.status": defineMethod(z.undefined(), kiloServerStatusSchema),
	"mcps.list": defineMethod(z.undefined(), z.array(mcpServerInfoSchema)),
	"mcps.save": defineMethod(mcpSaveInputSchema, okSchema),
	"mcps.remove": defineMethod(mcpRemoveInputSchema, okSchema),
	"mcps.setEnabled": defineMethod(mcpSetEnabledInputSchema, okSchema),
});

export type KiloServerService = InferContract<typeof kiloServerContract>;

// ─── Main-side capability (consumed by other plugins via plugins.get) ───────────

/**
 * The service object exposed by the kilo-server plugin as a main-side capability.
 * Contains methods for env contribution and server restart.
 */
export interface KiloServerCapabilityService extends Record<string, unknown> {
	readonly serverEnv: {
		/**
		 * Contribute environment variables to the Kilo server spawn.
		 * Returns a disposer that removes the contribution and triggers a server restart.
		 */
		contribute(sourceId: string, env: Record<string, string>): () => void;
	};
	/**
	 * Restart the Kilo server. Resolves when the server is ready again.
	 * Useful after environment or config changes that require a full respawn.
	 */
	restartServer(): Promise<void>;
}

/**
 * Capability type for consumers resolving kilo-server via `mainSdk.plugins.get`.
 *
 * Usage:
 * ```ts
 * const kilo = mainSdk.plugins.get<KiloServerCapabilities>("kilo-server");
 * kilo?.kiloService.serverEnv.contribute("my-plugin", { MY_VAR: "value" });
 * await kilo?.kiloService.restartServer();
 * ```
 */
export interface KiloServerCapabilities extends Record<string, unknown> {
	kiloService: KiloServerCapabilityService;
}
