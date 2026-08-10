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

/**
 * MCP server ID: alphanumeric, hyphens, underscores, dots, and slashes.
 *
 * Rejects `__proto__`, `constructor`, and `prototype` because ids flow into
 * bracket-assignment on plain JSON objects (`config.mcp[id] = entry` in
 * `KiloConfigManager`). Bracket-writing `__proto__` on an object created by
 * `JSON.parse` invokes the Object.prototype `__proto__` setter and mutates
 * the object's prototype (real prototype pollution). Constructor and
 * prototype are not exploitable through the same sink but sit in the same
 * "dangerous property name" bucket and are cheap to reject.
 *
 * A 255-char ceiling caps DoS via ridiculous ids (Kilo also chokes on huge
 * keys downstream).
 */
const RESERVED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);
const mcpIdSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[\w][\w\-./]*$/)
	.refine((value) => !RESERVED_PROPERTY_NAMES.has(value), {
		message: "MCP id must not be a reserved property name (__proto__, constructor, prototype)",
	});

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
	/**
	 * Save an MCP server entry to the global config and reload.
	 * The entry is written to kilo.json under the `mcp` key.
	 *
	 * When `managedBy` is provided, the entry is tagged so future versions
	 * can identify and clean up entries owned by a feature. Recommended for
	 * automatic entries (e.g. `"anaconda-desktop"`).
	 */
	saveMcp(input: {
		id: string;
		transport: McpTransport;
		enabled: boolean;
		managedBy?: string;
	}): Promise<void>;
	/**
	 * Remove an MCP server entry from the global config and reload.
	 */
	removeMcp(input: { id: string }): Promise<void>;
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
