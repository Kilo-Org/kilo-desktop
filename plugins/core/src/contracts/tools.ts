import { z } from "zod";

import {
	defineDecisionExtensionPoint,
	defineExtensionPoint,
	implementation,
} from "@kilo-desktop/kernel";

import type { PermissionRule } from "./chats";
import { modelRefSchema } from "./models";

// --- Desktop tools ---

/** Who is calling a tool: a Kilo chat (with its stamp, when known) or a paired external app. */
export interface ToolCallContext {
	/** The calling Kilo chat; null for external apps. */
	readonly chatId: string | null;
	/** From the calling chat's stamp; null for external apps and chats without one. */
	readonly workSessionId: string | null;
	readonly workspaceId: string | null;
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

/** Types a tool's `run` input by its schema (input is validated against it before `run`). */
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
 * A desktop tool the agent can call. Its contribution id is its snake_case
 * name (`open_file`); Kilo sees it as {@link toolWireName}.
 */
export const Tool = defineExtensionPoint({
	id: "kilo.core/tool",
	kind: "additive",
	description: "A desktop tool the agent can call.",
	metadata: z.object({
		/** Shown on the tool call ("Open terminal"). */
		title: z.string().min(1),
		/** `ask` makes the chat ask before each call (applied when chats are created). */
		approval: z.enum(["auto", "ask"]).default("auto"),
		/** Refused while signed out of Kilo. */
		requiresSignIn: z.boolean().default(false),
		/** What the chat's sign-in card says when a signed-out call is refused. */
		signInPrompt: toolSignInPromptSchema.optional(),
		readOnly: z.boolean().default(false),
		destructive: z.boolean().default(false),
		/** Offered to paired external AI apps too. */
		external: z.boolean().default(false),
	}),
	implementation: implementation<ToolImplementation>("main"),
});

/**
 * The name Kilo knows a tool by: `desktop_<plugin>_<id>`, with the `kilo.`
 * publisher dropped (`kilo.terminal/open_terminal` → `desktop_terminal_open_terminal`).
 */
export function toolWireName(contributionKey: string): string {
	const slash = contributionKey.indexOf("/");
	const owner = contributionKey.slice(0, slash).replace(/^kilo\./, "");
	const id = contributionKey.slice(slash + 1);
	return `desktop_${owner}_${id}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/** The rules that make a chat ask before each call to a tool contributed with `approval: "ask"`. */
export function toolPermissionRules(
	tools: readonly { readonly key: string; readonly metadata: { readonly approval: string } }[],
): PermissionRule[] {
	return tools
		.filter((tool) => tool.metadata.approval === "ask")
		.map((tool) => ({ permission: toolWireName(tool.key), pattern: "*", action: "ask" }));
}

/** Marks a refused call to a `requiresSignIn` tool, so the chat can show a sign-in prompt. */
export const SIGN_IN_REQUIRED_TOOL_ERROR_CODE = "[desktop:sign-in-required]";

/** Marks a refused call to a sign-in tool the person chose to go without. */
export const SIGN_IN_DECLINED_TOOL_ERROR_CODE = "[desktop:sign-in-declined]";

export const toolApprovalInputSchema = z.object({
	/** The tool's contribution key. */
	tool: z.string(),
	input: z.unknown(),
	chatId: z.string().nullable(),
	workSessionId: z.string().nullable(),
	external: z.boolean(),
});
export type ToolApprovalInput = z.output<typeof toolApprovalInputSchema>;

/**
 * Whether a tool may be called: proceed, ask the user, or reject. Asked once
 * per tool when a chat is created (`input` is undefined then): `ask` becomes
 * a rule that prompts before each call and `reject` one that denies it.
 */
export const ToolApproval = defineDecisionExtensionPoint({
	id: "kilo.core/tool-approval",
	process: "main",
	description: "Proceed, ask or reject a tool call.",
	input: toolApprovalInputSchema,
	failMode: "closed",
	timeoutMs: 2_000,
});

// --- What plugins add to Kilo itself ---

/** An entry in Kilo's `mcp` config, in Kilo's own shape. */
export type McpServerEntry = Readonly<Record<string, unknown>>;

export interface McpServerSource {
	/** Undefined removes the server. */
	read(): McpServerEntry | undefined;
	subscribe?(onChange: () => void): () => void;
}

/**
 * An MCP server added to Kilo's config. A static server is all metadata:
 * `command`, `args` and `env`, where `${resources}` is the contributing
 * plugin's own `resources/` folder (the kernel resolves it). A dynamic one
 * implements {@link McpServerSource} instead. Owned per contributor.
 */
export const McpServer = defineExtensionPoint({
	id: "kilo.core/mcp-server",
	kind: "additive",
	description: "An MCP server added to Kilo's config.",
	resources: true,
	metadata: z.object({
		command: z.string().min(1).optional(),
		args: z.array(z.string()).default([]),
		env: z.record(z.string(), z.string()).optional(),
	}),
	implementation: implementation<McpServerSource>("main", { required: false }),
});

export const AGENT_EXTENSION_TYPES = ["kilo-plugin", "skill", "agent", "command"] as const;

/** `${resources}` is the contributing plugin's own `resources/` folder; the kernel resolves it. */
const resourcePathSchema = z.string().min(1);

export const agentExtensionSchema = z.discriminatedUnion("type", [
	/** A Kilo plugin module, e.g. `${resources}/notebook-plugin.js`. */
	z.object({ type: z.literal("kilo-plugin"), path: resourcePathSchema }),
	/** A skill: a folder holding `SKILL.md` and its supporting files. */
	z.object({ type: z.literal("skill"), path: resourcePathSchema }),
	/** An agent, invoked by its contribution id. */
	z.object({
		type: z.literal("agent"),
		description: z.string().min(1),
		/** Its system prompt. */
		prompt: z.string().min(1),
		mode: z.enum(["primary", "subagent", "all"]).default("subagent"),
		model: modelRefSchema.optional(),
	}),
	/** A slash command, invoked by its contribution id. */
	z.object({
		type: z.literal("command"),
		description: z.string().optional(),
		/** The prompt it sends; `$ARGUMENTS` is what follows the command. */
		template: z.string().min(1),
		/** The agent that runs it. */
		agent: z.string().min(1).optional(),
		model: modelRefSchema.optional(),
		/** Runs as a subagent, keeping the chat's context clean. */
		subtask: z.boolean().optional(),
	}),
]);
export type AgentExtensionConfig = z.output<typeof agentExtensionSchema>;

/**
 * Something the contributing plugin adds to Kilo itself, as data: an agent
 * or a command is written into Kilo's config as it is; a Kilo plugin module
 * or a skill folder, which have to be files, is given by its path in the
 * plugin's own `resources/`. Owned per contributor. No code.
 */
export const AgentExtension = defineExtensionPoint({
	id: "kilo.core/agent-extension",
	kind: "additive",
	description: "An agent, command, skill or Kilo plugin added to Kilo.",
	resources: true,
	metadata: agentExtensionSchema,
});

/** Environment variables for the Kilo server process, read in main. */
export interface ServerEnvSource {
	read(): Readonly<Record<string, string>>;
	subscribe?(onChange: () => void): () => void;
}

/**
 * Environment variables the contributing plugin gives the Kilo server process
 * (e.g. where a Kilo plugin it adds finds its native module), merged into the
 * server's spawn environment per contribution. The server's own refusal rules
 * apply (`PATH`, proxies, `KILO_`/`XDG_`/loader variables are never taken);
 * a change restarts a running server whose environment differs.
 */
export const ServerEnv = defineExtensionPoint({
	id: "kilo.core/server-env",
	kind: "additive",
	description: "Environment variables for the Kilo server process.",
	implementation: implementation<ServerEnvSource>("main"),
});
