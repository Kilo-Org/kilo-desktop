import { z } from "zod";

import { defineContract, defineMethod, type InferContract } from "@kilo-desktop/feature-sdk";

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
	z.object({
		status: z.literal("error"),
		message: z.string().min(1),
		/** Diagnostic detail from stderr when the server exits early. */
		detail: z.string().min(1).optional(),
	}),
	z.object({ status: z.literal("unavailable"), message: z.string().min(1) }),
]);

export type KiloServerConnection = z.infer<typeof kiloServerConnectionSchema>;
export type KiloServerStatus = z.infer<typeof kiloServerStatusSchema>;

/** Connection request: absolute working directory for the Kilo session. */
export const kiloGetConnectionInputSchema = z.object({
	directory: z.string().min(1),
});

export type KiloGetConnectionInput = z.infer<typeof kiloGetConnectionInputSchema>;

export type KiloMcpEntry = Readonly<Record<string, unknown>>;
export type KiloProviderEntry = Readonly<Record<string, unknown>>;

export interface KiloConfigurationState {
	readonly mcpEntries: Readonly<Record<string, KiloMcpEntry>>;
	readonly plugins: Readonly<Record<string, string>>;
}

// ─── Contract ───────────────────────────────────────────────────────────────────

export const kiloServerContract = defineContract({
	"server.getConnection": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.restart": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.status": defineMethod(z.undefined(), kiloServerStatusSchema),
});

export type KiloServerService = InferContract<typeof kiloServerContract>;

// ─── Main-side capability (consumed by other plugins via plugins.get) ───────────

/**
 * The service object exposed by the kilo-server plugin as a main-side capability.
 * Contains methods for env contribution, managed Kilo configuration, owned
 * provider config persistence, and server restart.
 */
export interface KiloServerCapabilityService {
	readonly [key: string]: unknown;
	readonly serverEnv: {
		/**
		 * Contribute environment variables to the Kilo server spawn.
		 * Returns a disposer that removes the contribution and triggers a server restart.
		 */
		contribute(sourceId: string, env: Record<string, string>): () => void;
	};
	readonly configuration: {
		/** Reconcile one source's complete desired state across Kilo's managed config files. */
		set(sourceId: string, desired: KiloConfigurationState): Promise<void>;
	};
	readonly providerConfig: {
		/**
		 * Persist a Desktop-owned provider in the app-owned Kilo config while
		 * preserving user entries and JSONC. A running server is restarted
		 * through the shared debouncer only when the provider changes.
		 */
		set(sourceId: string, entryId: string, entry: KiloProviderEntry): Promise<void>;
		/** Replace a reserved legacy Desktop provider ID with its current ID. */
		replace(sourceId: string, entryId: string, entry: KiloProviderEntry): Promise<void>;
		/** Remove a provider only when this source owns its section-qualified entry. */
		remove(sourceId: string, entryId: string): Promise<void>;
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
 * await kilo?.kiloService.configuration.set("my-plugin", {
 *   mcpEntries: {
 *     "my-mcp": { type: "remote", url: "https://..." },
 *   },
 *   plugins: {},
 * });
 * await kilo?.kiloService.providerConfig.set("my-plugin", "my-provider", {
 *   name: "My provider",
 * });
 * await kilo?.kiloService.restartServer();
 * ```
 */
export interface KiloServerCapabilities {
	readonly [key: string]: unknown;
	kiloService: KiloServerCapabilityService;
}
