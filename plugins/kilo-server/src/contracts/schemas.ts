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
export type KiloOwnedMcpEntry = {
	readonly id: string;
	readonly sourceId: string | undefined;
};

export interface KiloConfigurationState {
	readonly mcpEntries: Readonly<Record<string, KiloMcpEntry>>;
	readonly plugins: Readonly<Record<string, string>>;
}

// ─── External AI apps (paired MCP clients) ──────────────────────────────────────

/** A paired external MCP client. Its token is shown once and stored only as a hash. */
export const externalClientSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.string().min(1),
	lastUsedAt: z.string().min(1).optional(),
});

export const externalClientsStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("stopped") }),
	z.object({ status: z.literal("running"), url: z.url() }),
	z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);

export const externalClientsStateSchema = z.object({
	/** Whether paired external AI apps may connect. Off by default. */
	enabled: z.boolean(),
	/** The loopback port the endpoint listens on while enabled. */
	port: z.number().int(),
	/** The channel's default port, used when the user has not chosen one. */
	defaultPort: z.number().int(),
	status: externalClientsStatusSchema,
	clients: z.array(externalClientSchema),
});

export const EXTERNAL_CLIENT_NAME_MAX_LENGTH = 64;
export const externalClientPortSchema = z.number().int().min(1024).max(65535);

export type ExternalClient = z.infer<typeof externalClientSchema>;
export type ExternalClientsStatus = z.infer<typeof externalClientsStatusSchema>;
export type ExternalClientsState = z.infer<typeof externalClientsStateSchema>;

/**
 * LaunchDarkly flag gating External AI apps: the settings section
 * (`plugin.json`) and, in main, starting, enabling and pairing.
 */
export const EXTERNAL_AI_APPS_FEATURE_FLAG = "external-api-apps-settings";

/** Emitted (qualified as `kilo-server.external-clients-changed`) with the new state. */
export const EXTERNAL_CLIENTS_CHANGED_EVENT = "external-clients-changed";

// ─── Agent tools that require sign-in ───────────────────────────────────────────

/**
 * Sign-in gating state for agent tools that declare `requiresSignIn`, owned by
 * main. `declined`: the user chose not to sign in, so those tools are withdrawn
 * from agents until they sign in or the app restarts.
 */
export const agentToolSignInStateSchema = z.object({ declined: z.boolean() });

export type AgentToolSignInState = z.infer<typeof agentToolSignInStateSchema>;

/** Emitted (qualified as `kilo-server.agent-tool-sign-in-changed`) with the new state. */
export const AGENT_TOOL_SIGN_IN_CHANGED_EVENT = "agent-tool-sign-in-changed";

/**
 * Renderer-side capability for other plugins (chat) to read and change the
 * main-owned sign-in gating state:
 * `sdk.plugins.get<KiloServerWebCapabilities>("kilo-server")?.agentToolSignIn`.
 */
export interface AgentToolSignInCapability {
	getState(): Promise<AgentToolSignInState>;
	/** The user chose not to sign in. */
	decline(): Promise<AgentToolSignInState>;
	/** Hears every change, from any window. */
	subscribe(listener: (state: AgentToolSignInState) => void): () => void;
}

export interface KiloServerWebCapabilities {
	readonly [key: string]: unknown;
	readonly agentToolSignIn: AgentToolSignInCapability;
}

// ─── Contract ───────────────────────────────────────────────────────────────────

export const kiloServerContract = defineContract({
	"server.getConnection": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.restart": defineMethod(z.undefined(), kiloServerConnectionSchema),
	"server.status": defineMethod(z.undefined(), kiloServerStatusSchema),
	"externalClients.getState": defineMethod(z.undefined(), externalClientsStateSchema),
	"externalClients.setEnabled": defineMethod(
		z.object({ enabled: z.boolean() }),
		externalClientsStateSchema,
	),
	/** `null` returns to the channel's default port. */
	"externalClients.setPort": defineMethod(
		z.object({ port: externalClientPortSchema.nullable() }),
		externalClientsStateSchema,
	),
	"externalClients.createClient": defineMethod(
		z.object({ name: z.string().trim().min(1).max(EXTERNAL_CLIENT_NAME_MAX_LENGTH) }),
		z.object({
			client: externalClientSchema,
			/** Shown once; Desktop keeps only its hash. */
			token: z.string().min(1),
			state: externalClientsStateSchema,
		}),
	),
	"externalClients.revokeClient": defineMethod(
		z.object({ id: z.string().min(1) }),
		externalClientsStateSchema,
	),
	"agentToolSignIn.getState": defineMethod(z.undefined(), agentToolSignInStateSchema),
	/** The user chose not to sign in: withdraw sign-in tools from agents until they do. */
	"agentToolSignIn.decline": defineMethod(z.undefined(), agentToolSignInStateSchema),
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
	readonly mcpConfig: {
		/** List MCP entries contributed and owned by Desktop features. */
		list?(): Promise<KiloOwnedMcpEntry[]>;
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
	/**
	 * Reload config after a Marketplace mutation. A workspace directory
	 * invalidates only that Kilo instance; no directory restarts the shared
	 * server so app-global agents, skills, and MCPs are rediscovered.
	 */
	reloadConfig(directory?: string): Promise<void>;
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
