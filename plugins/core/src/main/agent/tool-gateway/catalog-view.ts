import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ToolCallContext } from "../../../contracts";
import type { DeclinedSignIns } from "./declined-sign-ins.js";
import { KILO_CALLER_CONTEXT_KEY } from "./kilo-caller-context-plugin.js";
import { SIGN_IN_DECLINED_TOOL_MESSAGE, signInRequiredToolMessage } from "./sign-in-messages.js";
import type { CatalogTool, ToolCatalog } from "./tool-catalog.js";

/**
 * How one class of MCP consumer sees the catalog: which tools are listed, with
 * what schemas, and how a call's arguments become validated tool input plus
 * trusted caller context. Tools that require sign-in are refused while the
 * user is signed out, and withdrawn while their plugin's sign-in is declined.
 */
export interface CatalogView {
	listTools(): Tool[];
	callTool(
		name: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<CallToolResult>;
	subscribe(listener: () => void): () => void;
}

/** What views ask the rest of the app at call time. */
export interface CallerPolicy {
	isSignedIn(): boolean;
	/** The work session and workspace stamped on a Kilo chat (a subagent's are its root's). */
	stampOfChat(chatId: string): ChatStamp;
	/** Plugins whose sign-in tools the person chose to go without. */
	readonly declinedSignIns?: DeclinedSignIns;
}

export interface ChatStamp {
	readonly workSessionId: string | null;
	readonly workspaceId: string | null;
}

type CallerContext = Omit<ToolCallContext, "signal">;

const NO_CALLER: CallerContext = {
	chatId: null,
	workSessionId: null,
	workspaceId: null,
	callId: null,
	external: false,
};
const EXTERNAL_CALLER: CallerContext = { ...NO_CALLER, external: true };

const KILO_CALLER_CONTEXT_SCHEMA = {
	type: "object",
	properties: {
		version: { type: "integer" },
		sessionId: { type: "string", minLength: 1 },
		callId: { type: "string", minLength: 1 },
	},
	required: ["version", "sessionId", "callId"],
};

/**
 * The view served to the bundled Kilo CLI. Desktop's Kilo plugin stamps every
 * `desktop_*` call with `__anacondaDesktopKiloCaller` (chat and call ids);
 * the schemas advertise that property so Kilo's argument validation keeps it,
 * and calls lift it out of the arguments into the tool's context, with the
 * chat's stamp (work session and workspace).
 */
export function createKiloCatalogView(catalog: ToolCatalog, policy: CallerPolicy): CatalogView {
	return createCatalogView(catalog, policy, {
		audience: "kilo",
		lists: () => true,
		inputSchema: (schema) => {
			const { additionalProperties: _ignored, ...rest } = schema;
			return {
				...rest,
				type: "object",
				properties: {
					...(isRecord(schema.properties) ? schema.properties : {}),
					[KILO_CALLER_CONTEXT_KEY]: KILO_CALLER_CONTEXT_SCHEMA,
				},
			};
		},
		splitArgs: (rawArgs) => {
			const { [KILO_CALLER_CONTEXT_KEY]: envelope, ...args } = rawArgs;
			const caller = kiloCaller(envelope);
			if (!caller) return { args, context: NO_CALLER };
			return {
				args,
				context: {
					...NO_CALLER,
					...policy.stampOfChat(caller.chatId),
					chatId: caller.chatId,
					callId: caller.callId,
				},
			};
		},
	});
}

/**
 * The view served to paired external AI apps: the tools offered to them
 * (`external`), with their own schemas. External callers never get Kilo
 * caller context — a forged envelope is dropped — so chat-bound tools
 * refuse their calls instead of acting on some chat.
 */
export function createExternalCatalogView(catalog: ToolCatalog, policy: CallerPolicy): CatalogView {
	return createCatalogView(catalog, policy, {
		audience: "external",
		lists: (tool) => tool.metadata.external,
		inputSchema: (schema) => schema as Tool["inputSchema"],
		splitArgs: (rawArgs) => {
			const { [KILO_CALLER_CONTEXT_KEY]: _untrusted, ...args } = rawArgs;
			return { args, context: EXTERNAL_CALLER };
		},
	});
}

interface ViewPolicy {
	readonly audience: "kilo" | "external";
	lists(tool: CatalogTool): boolean;
	inputSchema(schema: Record<string, unknown>): Tool["inputSchema"];
	splitArgs(args: Record<string, unknown>): {
		readonly args: Record<string, unknown>;
		readonly context: CallerContext;
	};
}

function createCatalogView(
	catalog: ToolCatalog,
	caller: CallerPolicy,
	policy: ViewPolicy,
): CatalogView {
	let cachedKey = "";
	let cachedTools: Tool[] = [];
	const declines = caller.declinedSignIns;
	const withdrawn = (tool: CatalogTool) =>
		tool.metadata.requiresSignIn && declines?.has(tool.pluginId) === true;
	const visible = (name: string) => {
		const tool = catalog.find(name);
		return tool && policy.lists(tool) ? tool : undefined;
	};
	return {
		listTools() {
			const key = `${catalog.version}\n${(declines?.scopes ?? []).join("\n")}`;
			if (cachedKey !== key) {
				cachedTools = catalog.tools
					.filter((tool) => policy.lists(tool) && !withdrawn(tool))
					.map((tool) => ({
						name: tool.name,
						title: tool.metadata.title,
						description: tool.description,
						inputSchema: policy.inputSchema({ ...tool.inputSchema }),
						annotations: {
							title: tool.metadata.title,
							readOnlyHint: tool.metadata.readOnly,
							destructiveHint: tool.metadata.destructive,
						},
					}));
				cachedKey = key;
			}
			return cachedTools;
		},
		async callTool(name, rawArgs, signal) {
			const tool = visible(name);
			if (!tool) return toolError(`Unknown tool "${name}".`);
			if (tool.metadata.requiresSignIn && !caller.isSignedIn()) {
				return toolError(
					withdrawn(tool)
						? SIGN_IN_DECLINED_TOOL_MESSAGE
						: signInRequiredToolMessage(policy.audience),
				);
			}
			const { args, context } = policy.splitArgs(rawArgs);
			const input = tool.implementation.input.safeParse(args);
			if (!input.success) {
				return toolError(`Invalid input for ${name}: ${z.prettifyError(input.error)}`);
			}
			try {
				const result = await tool.implementation.run(input.data, { ...context, signal });
				return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
			} catch (error) {
				return toolError(error instanceof Error ? error.message : String(error));
			}
		},
		subscribe(listener) {
			const unsubscribeCatalog = catalog.subscribe(listener);
			const unsubscribeDeclines = declines?.subscribe(listener);
			return () => {
				unsubscribeCatalog();
				unsubscribeDeclines?.();
			};
		},
	};
}

function toolError(text: string): CallToolResult {
	return { isError: true, content: [{ type: "text", text }] };
}

function kiloCaller(envelope: unknown): { chatId: string; callId: string } | undefined {
	if (!isRecord(envelope)) return undefined;
	const { version, sessionId, callId } = envelope;
	if (
		version !== 1 ||
		typeof sessionId !== "string" ||
		sessionId.length === 0 ||
		typeof callId !== "string" ||
		callId.length === 0
	) {
		return undefined;
	}
	return { chatId: sessionId, callId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
