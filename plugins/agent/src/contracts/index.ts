import type { ComponentType } from "react";
import { z } from "zod";

import {
	defineDecisionPoint,
	defineDomain,
	defineExtensionPoint,
	implementation,
	method,
	type PluginDefinitions,
} from "@kilo-desktop/kernel";

import { ChatOwner, Conversations } from "./conversation";

export * from "./conversation";
export * from "./kilo-metadata";

/**
 * kilo.agent's public surface: the Kilo CLI server other plugins talk to, and
 * the points through which they shape how it runs.
 */
export const AGENT_PLUGIN_ID = "kilo.agent";

/** The `kernel/services` key of the Kilo server daemon. */
export const SERVER_SERVICE_KEY = "kilo.agent/server";

const nothing = z.undefined();

export const serverStatusSchema = z.object({
	status: z.enum(["stopped", "starting", "ready", "error"]),
	/** The CLI version, once ready. */
	version: z.string().optional(),
	/** Why the server is not running, when it failed. */
	message: z.string().optional(),
	/** The CLI's own output from a failed start. */
	detail: z.string().optional(),
});
export type ServerStatus = z.output<typeof serverStatusSchema>;

/** How to reach the running server; the password changes when the server is replaced. */
export const serverConnectionSchema = z.object({
	baseUrl: z.string(),
	username: z.string(),
	password: z.string(),
	version: z.string(),
	/** The server's working directory for requests not tied to a workspace. */
	globalDirectory: z.string(),
});
export type ServerConnection = z.output<typeof serverConnectionSchema>;

/** The local Kilo CLI server that runs agents. */
export const AgentServer = defineDomain({
	id: "kilo.agent/server",
	home: "main",
	state: serverStatusSchema,
	methods: {
		/**
		 * Waits until the server is ready, starting it if needed, and says how to
		 * reach it. The password drives every chat, so only the app's own Kilo
		 * clients (kilo.chat, kilo.account, kilo.marketplace) may call it.
		 */
		connect: method(nothing, serverConnectionSchema),
		restart: method(nothing, nothing),
		/**
		 * Releases the server's instance for a directory (its MCP servers, file
		 * watcher and processes), so the directory can be removed. Waits up to
		 * 5 s for the server to confirm; does nothing while the server is not
		 * running.
		 */
		disposeInstance: method(z.object({ directory: z.string().min(1) }), nothing),
	},
});

export const userConfigFileSchema = z.object({
	path: z.string(),
	/** False until the user creates the file. */
	exists: z.boolean(),
});
export type UserConfigFile = z.output<typeof userConfigFileSchema>;

/** Kilo's configuration as the app sees it. */
export const AgentConfig = defineDomain({
	id: "kilo.agent/config",
	home: "main",
	state: z.object({}),
	methods: {
		/** The user's own global Kilo config file, which the app never writes. */
		userConfigFile: method(nothing, userConfigFileSchema),
		/**
		 * A provider's API key stored by Kilo, for kilo.agent's own provider
		 * settings only (other callers are refused). Kilo's own keys are hidden.
		 */
		storedApiKey: method(
			z.object({ providerId: z.string().min(1) }),
			z.object({ key: z.string().nullable() }),
		),
		/** Which of these environment variables are set (kilo.agent only). */
		presentEnv: method(
			z.object({ names: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(32) }),
			z.object({ names: z.array(z.string()) }),
		),
	},
});

/** An entry in Kilo's `mcp` config, in Kilo's own shape. */
export type McpServerEntry = Readonly<Record<string, unknown>>;

/** What one plugin needs from the server process: read when it starts. */
export interface RuntimeConfig {
	/** Environment variables; `PATH`, proxies and `KILO_` / `XDG_` / loader variables are refused. */
	readonly env?: Readonly<Record<string, string>>;
	/** Kilo plugin modules to load, by id (lowercase letters, digits, `.`, `_`, `-`) → absolute path. */
	readonly kiloPlugins?: Readonly<Record<string, string>>;
	/** MCP servers to add to Kilo's config, by id. */
	readonly mcpServers?: Readonly<Record<string, McpServerEntry>>;
}

/**
 * A source of runtime config. `read` is called whenever the server's config is
 * reconciled; `subscribe` lets a source say it changed. A change to env
 * restarts a running server; config changes are written to Kilo's config.
 */
export interface RuntimeConfigSource {
	read(): RuntimeConfig;
	subscribe?(onChange: () => void): () => void;
}

export const RuntimeConfigPoint = defineExtensionPoint({
	id: "kilo.agent/runtime-config",
	kind: "additive",
	description: "Environment, Kilo plugins and MCP servers for the Kilo server.",
	implementation: implementation<RuntimeConfigSource>("main"),
});

/** A model provider's entry in Kilo's `provider` config, in Kilo's own shape; undefined removes it. */
export type ModelProviderEntry = Readonly<Record<string, unknown>>;

export interface ModelProviderSource {
	read(): ModelProviderEntry | undefined;
	subscribe?(onChange: () => void): () => void;
}

export const ModelProvider = defineExtensionPoint({
	id: "kilo.agent/model-provider",
	kind: "additive",
	description: "A model provider added to Kilo's config.",
	metadata: z.object({
		/** The provider's id in Kilo's config. */
		providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
	}),
	implementation: implementation<ModelProviderSource>("main"),
});

/**
 * A featured row in Settings → AI Providers for one provider, contributed by
 * the plugin that owns its account (Kilo Gateway, from kilo.account). The page
 * shows these above the provider list and leaves those providers out of it.
 */
export const ProviderPanel = defineExtensionPoint({
	id: "kilo.agent/provider-panel",
	kind: "additive",
	description: "A featured provider row in AI Providers.",
	metadata: z.object({ providerId: z.string().min(1) }),
	implementation: implementation<ComponentType>("renderer"),
});

// --- Agent tools ---

/** Who is calling a tool: a Kilo chat (with its Work Session, when known) or an external app. */
export interface ToolCallContext {
	/** The Work Session of the calling chat; null for external apps and unknown chats. */
	readonly sessionId: string | null;
	/** The calling Kilo chat (its server session id); null for external apps. */
	readonly chatId: string | null;
	readonly callId: string | null;
	readonly external: boolean;
	readonly signal: AbortSignal;
}

/** A tool's behaviour, in main. Its input is validated against `input` before `run`. */
export interface ToolImplementation<TInput = unknown> {
	/** What the model reads to decide when to call it. */
	readonly description: string;
	readonly input: z.ZodType<TInput>;
	run(input: TInput, context: ToolCallContext): unknown;
}

/** Types a tool's `run` input by its schema (the gateway validates input against it before `run`). */
export function defineTool<TInput>(tool: ToolImplementation<TInput>): ToolImplementation {
	return tool as unknown as ToolImplementation;
}

export const toolSignInPromptSchema = z.object({
	title: z.string().min(1),
	body: z.string().min(1),
	/** Names the tools in the chat's follow-ups: "…continue without {toolsLabel}". */
	toolsLabel: z.string().min(1),
});
export type ToolSignInPrompt = z.output<typeof toolSignInPromptSchema>;

/**
 * An agent tool. Kilo sees it as `desktop_<plugin>_<id>` (`kilo.` dropped:
 * `kilo.terminal/open` → `desktop_terminal_open`), as origin named them.
 */
export const AgentTool = defineExtensionPoint({
	id: "kilo.agent/tool",
	kind: "additive",
	description: "A tool the agent (and paired external AI apps) can call.",
	metadata: z.object({
		/** Shown on the tool call ("Open terminal"). */
		title: z.string().min(1),
		/** `ask` makes the chat ask before each call (applied when chats are created). */
		approval: z.enum(["auto", "ask"]).default("auto"),
		/** Refused while signed out of Kilo. */
		requiresSignIn: z.boolean().default(false),
		/** What the chat's sign-in card says when a signed-out call is refused (else generic wording). */
		signInPrompt: toolSignInPromptSchema.optional(),
		readOnly: z.boolean().default(false),
		destructive: z.boolean().default(false),
		/** Offered to paired external AI apps too. */
		external: z.boolean().default(true),
	}),
	implementation: implementation<ToolImplementation>("main"),
});

/** The name Kilo knows a tool by. */
export function toolWireName(contributionKey: string): string {
	const slash = contributionKey.indexOf("/");
	const owner = contributionKey.slice(0, slash).replace(/^kilo\./, "");
	const id = contributionKey.slice(slash + 1);
	return `desktop_${owner}_${id}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/** A Kilo permission rule (`permission` in Kilo's config), as chats are created with. */
export interface ToolPermissionRule {
	readonly permission: string;
	readonly pattern: string;
	readonly action: "allow" | "ask" | "deny";
}

/**
 * The rules that make a chat ask before each call to a tool contributed with
 * `approval: "ask"`; applied when a chat is created.
 */
export function toolPermissionRules(
	tools: readonly { readonly key: string; readonly metadata: { readonly approval: string } }[],
): ToolPermissionRule[] {
	return tools
		.filter((tool) => tool.metadata.approval === "ask")
		.map((tool) => ({ permission: toolWireName(tool.key), pattern: "*", action: "ask" }));
}

/**
 * Marks a refused call to a `requiresSignIn` tool, so the chat can show a
 * sign-in prompt in place of the tool call (errors reach it only as text).
 */
export const SIGN_IN_REQUIRED_TOOL_ERROR_CODE = "[desktop:sign-in-required]";

const NO_WORKAROUND =
	"Do not try to get the same result another way, such as running the equivalent command in a shell.";

/** What a signed-out caller is told: the bundled Kilo agent (the chat prompts) or an external app. */
export function signInRequiredToolMessage(audience: "kilo" | "external"): string {
	if (audience === "external") {
		return (
			`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} This Kilo Desktop tool needs the user to be signed in ` +
			"to Kilo. Ask them to sign in to Kilo in Kilo Desktop, then retry."
		);
	}
	return (
		`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The user is not signed in to Kilo, so this tool did not ` +
		"run. Desktop is already asking them in the chat whether to sign in, so do not ask them " +
		"yourself: say briefly that you will continue once they answer, then stop. " +
		`${NO_WORKAROUND} If they sign in, they will ask you to continue: call this tool ` +
		"again. If they decline, these tools are turned off until they sign in. If they sign in " +
		"later, the tools reappear in your tool list: from then on, use them again instead of " +
		"running the equivalent commands yourself."
	);
}

/** Marks a refused call to a sign-in tool the person chose to go without. */
export const SIGN_IN_DECLINED_TOOL_ERROR_CODE = "[desktop:sign-in-declined]";

/** What a caller of a withdrawn sign-in tool is told (it stays callable by a stale tool list). */
export const SIGN_IN_DECLINED_TOOL_MESSAGE =
	`${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in, so this tool and the related ` +
	"Desktop tools that need sign-in are turned off until they sign in. Do not call them while " +
	"they are off. If the user signs in later, the tools reappear in your tool list: from then on, " +
	"use them again instead of running the equivalent commands yourself.";

/**
 * The plugins whose sign-in tools the person chose to go without
 * (`declined`, plugin ids): their `requiresSignIn` tools are withdrawn from
 * every agent's tool list until the person signs in, which clears it. Kept
 * in memory, so it lasts until sign-in or the app restarts.
 */
export const AgentToolSignIn = defineDomain({
	id: "kilo.agent/tool-sign-in",
	home: "main",
	state: z.object({ declined: z.array(z.string()) }),
	methods: {
		/**
		 * Withdraws `scope`'s sign-in tools (the id of the plugin contributing the
		 * refused tool). Does nothing while signed in.
		 */
		decline: method(z.object({ scope: z.string().min(1) }), nothing),
	},
});

export const toolApprovalInput = z.object({
	tool: z.string(),
	input: z.unknown(),
	sessionId: z.string().nullable(),
	external: z.boolean(),
});

/**
 * Whether a tool may be called: proceed, ask the user, or reject. Asked once
 * per tool when a chat is created (`input` is undefined then): `ask` becomes a
 * rule that prompts before each call and `reject` one that denies it.
 */
export const ToolApproval = defineDecisionPoint({
	id: "kilo.agent/tool-approval",
	process: "main",
	description: "Proceed, ask or reject an agent tool call.",
	input: toolApprovalInput,
	failMode: "closed",
	timeoutMs: 2_000,
});

export interface SessionConfigContext {
	/** The Work Session the chat is created for; null when it has none yet. */
	readonly sessionId: string | null;
	readonly workspaceId: string | null;
	readonly directory: string | null;
}

export interface SessionConfig {
	/** Tool wire names this session should not offer. */
	readonly disableTools?: readonly string[];
	/** Extra system instructions. */
	readonly instructions?: readonly string[];
	/**
	 * Kilo permission rules for the session's chats (`bash` commands that must
	 * ask, folders to allow). Applied after the workspace's folders and before
	 * the tools' ask and deny rules, so a tool that asks or is turned off
	 * still does whatever these say.
	 */
	readonly permissions?: readonly ToolPermissionRule[];
}

/**
 * Per-session tools, permissions and instructions: `disableTools` become deny
 * rules and `permissions` are added when a chat is created; `instructions` are
 * read through `Conversations.sessionConfig`.
 */
export const SessionConfigPoint = defineExtensionPoint({
	id: "kilo.agent/session-config",
	kind: "additive",
	description: "Tools, permission rules and instructions for a session's chats.",
	implementation: implementation<{ configure(context: SessionConfigContext): SessionConfig }>(
		"main",
	),
});

// --- External AI apps ---

/** The LaunchDarkly flag behind External AI apps: its settings section, and starting, enabling and pairing. */
export const EXTERNAL_AI_APPS_FLAG = "external-api-apps-settings";

export const EXTERNAL_CLIENT_NAME_MAX_LENGTH = 64;

/** A paired external MCP client. Its token is shown once and stored only as a hash. */
export const externalClientSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.string().min(1),
	lastUsedAt: z.string().min(1).optional(),
});
export type ExternalClient = z.output<typeof externalClientSchema>;

export const externalClientsStatusSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("stopped") }),
	z.object({ status: z.literal("running"), url: z.url() }),
	z.object({ status: z.literal("error"), message: z.string().min(1) }),
]);
export type ExternalClientsStatus = z.output<typeof externalClientsStatusSchema>;

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
export type ExternalClientsState = z.output<typeof externalClientsStateSchema>;

export const externalClientPortSchema = z.number().int().min(1024).max(65535);

/**
 * Apps such as Cursor or Claude Code using the agent tools over MCP on a
 * loopback port. Only kilo.agent's own settings may change it: pairing hands
 * out a token.
 */
export const ExternalClients = defineDomain({
	id: "kilo.agent/external-clients",
	home: "main",
	state: externalClientsStateSchema,
	methods: {
		setEnabled: method(z.object({ enabled: z.boolean() }), nothing),
		/** `null` returns to the channel's default port. */
		setPort: method(z.object({ port: externalClientPortSchema.nullable() }), nothing),
		pair: method(
			z.object({ name: z.string().trim().min(1).max(EXTERNAL_CLIENT_NAME_MAX_LENGTH) }),
			/** The token is returned only here; Desktop keeps its hash. */
			z.object({ client: externalClientSchema, token: z.string().min(1) }),
		),
		/** Disconnects the app at once; its token stops working. */
		revoke: method(z.object({ id: z.string().min(1) }), nothing),
	},
});

/**
 * The work-style onboarding step in the main window: that it was shown and
 * what the person chose. kilo.telemetry reports these, so kilo.agent need not
 * depend on it.
 */
export const WorkStyleOnboarding = defineDomain({
	id: "kilo.agent/work-style-onboarding",
	home: "renderer",
	state: z.object({}),
	methods: {},
	events: {
		shown: z.object({}),
		selected: z.object({ style: z.enum(["human-in-the-loop", "autonomous"]) }),
	},
});

export const AGENT_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		RuntimeConfigPoint,
		ModelProvider,
		ProviderPanel,
		AgentTool,
		ToolApproval,
		SessionConfigPoint,
		ChatOwner,
	],
	domains: [
		AgentServer,
		AgentConfig,
		ExternalClients,
		Conversations,
		AgentToolSignIn,
		WorkStyleOnboarding,
	],
};
