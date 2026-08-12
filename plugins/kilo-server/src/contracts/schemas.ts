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

// ─── Config overlay ─────────────────────────────────────────────────────────────

/**
 * Partial Kilo config injected into the spawned `kilo serve` process via the
 * `KILO_CONFIG_CONTENT` env var — Kilo merges it over the on-disk config at
 * load time. This is how features add managed config (e.g. MCP entries)
 * without ever writing to the user's shared `~/.config/kilo/kilo.jsonc`:
 * no lost-update races with Kilo CLI / VS Code, no residue after uninstall,
 * and the entry is scoped to exactly the server process Desktop spawns.
 *
 * Deliberately restricted to the `mcp` section. Kilo's own `mergeConfig`
 * (in `@kilocode/sdk`'s server module) has per-section semantics — per-entry
 * merge for `agent`/`command`/`mcp`/`mode`, concatenation for
 * `plugin`/`instructions` — that this plugin does not replicate. Widening
 * this type requires implementing those semantics in
 * `ContributedEnvManager.getMergedConfigOverlay` and
 * `composeConfigContent` first.
 */
export interface KiloConfigOverlay {
	readonly mcp?: Readonly<Record<string, unknown>>;
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
 * Contains methods for env contribution, config overlay contribution, and
 * server restart.
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
	readonly configOverlay: {
		/**
		 * Contribute a partial Kilo config, injected into the spawned server
		 * via `KILO_CONFIG_CONTENT` (see {@link KiloConfigOverlay}). Overlays
		 * from multiple sources are merged in recency order (last-write-wins
		 * per section entry). Re-contributing from the same `sourceId`
		 * replaces the previous overlay. Returns a disposer that removes the
		 * contribution; both paths trigger a debounced server restart.
		 */
		contribute(sourceId: string, overlay: KiloConfigOverlay): () => void;
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
 * kilo?.kiloService.configOverlay.contribute("my-plugin", { mcp: { "my-mcp": { ... } } });
 * await kilo?.kiloService.restartServer();
 * ```
 */
export interface KiloServerCapabilities {
	readonly [key: string]: unknown;
	kiloService: KiloServerCapabilityService;
}
