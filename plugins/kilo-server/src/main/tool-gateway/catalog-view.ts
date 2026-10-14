import type { CallToolResult, Tool } from "@modelcontextprotocol/server";

import {
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	signInRequiredToolMessage,
	type SignInRefusalAudience,
	type ToolDescriptor,
} from "@kilo-desktop/feature-sdk";

import { KILO_CALLER_CONTEXT_KEY } from "../kilo-caller-context-plugin.js";
import type { AgentToolSignIn } from "./agent-tool-sign-in.js";
import type { ToolCallContext, ToolCatalog } from "./tool-catalog.js";

/**
 * How one class of MCP consumer sees the catalog: which tools are listed, with
 * what schemas, and how a call's arguments become handler arguments plus
 * trusted caller context. With a sign-in gate, tools that require sign-in are
 * refused while the user is signed out and withdrawn while their feature's
 * scope is declined.
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
 * `desktop_*` call with `__anacondaDesktopKiloCaller` (session and call ids);
 * the schemas advertise that property so Kilo's argument validation keeps it,
 * and calls lift it out of the arguments into the handler's context.
 */
export function createKiloCatalogView(catalog: ToolCatalog, signIn?: AgentToolSignIn): CatalogView {
	return createCatalogView(catalog, signIn, {
		audience: "kilo",
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
		splitArgs: extractKiloCallerContext,
	});
}

/**
 * The view served to paired external AI apps: the same tools Kilo sees, with
 * their own schemas. External callers never get Kilo caller context — a
 * forged envelope is dropped — so session-bound tools refuse their calls
 * instead of acting on some chat.
 */
export function createExternalCatalogView(
	catalog: ToolCatalog,
	signIn?: AgentToolSignIn,
): CatalogView {
	return createCatalogView(catalog, signIn, {
		audience: "external",
		inputSchema: (schema) => schema as Tool["inputSchema"],
		splitArgs: (rawArgs) => {
			const { [KILO_CALLER_CONTEXT_KEY]: _untrusted, ...args } = rawArgs;
			return { args, context: {} };
		},
	});
}

interface ViewPolicy {
	/** Who reads a sign-in refusal: the Kilo agent (chat prompts) or an external app. */
	audience: SignInRefusalAudience;
	inputSchema(schema: Record<string, unknown>): Tool["inputSchema"];
	splitArgs(args: Record<string, unknown>): {
		readonly args: Record<string, unknown>;
		readonly context: ToolCallContext;
	};
}

function createCatalogView(
	catalog: ToolCatalog,
	signIn: AgentToolSignIn | undefined,
	policy: ViewPolicy,
): CatalogView {
	let cachedKey = "";
	let cachedTools: Tool[] = [];
	const isWithdrawn = (tool: ToolDescriptor): boolean =>
		tool.requiresSignIn === true && signIn?.isDeclined(tool.signInScope) === true;
	return {
		listTools() {
			const key = `${catalog.version}:${(signIn?.state.declined ?? []).join(" ")}`;
			if (cachedKey !== key) {
				cachedTools = catalog.tools
					.filter((tool) => !isWithdrawn(tool))
					.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: policy.inputSchema(tool.inputSchema),
						...(tool.annotations ? { annotations: tool.annotations } : {}),
					}));
				cachedKey = key;
			}
			return cachedTools;
		},
		async callTool(name, rawArgs, signal) {
			const refusal = await signInRefusal(name);
			if (refusal) return { isError: true, content: [{ type: "text", text: refusal }] };
			const { args, context } = policy.splitArgs(rawArgs);
			try {
				const result = await catalog.invoke(name, args, context, signal);
				return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: message }] };
			}
		},
		subscribe(listener) {
			const unsubscribeCatalog = catalog.subscribe(listener);
			const unsubscribeSignIn = signIn?.subscribe(listener);
			return () => {
				unsubscribeCatalog();
				unsubscribeSignIn?.();
			};
		},
	};

	async function signInRefusal(name: string): Promise<string | undefined> {
		if (!signIn) return undefined;
		const tool = catalog.tools.find((candidate) => candidate.name === name);
		if (tool?.requiresSignIn !== true) return undefined;
		if (signIn.isDeclined(tool.signInScope)) return SIGN_IN_DECLINED_TOOL_MESSAGE;
		if (await signIn.isSignedIn()) return undefined;
		return signInRequiredToolMessage(policy.audience);
	}
}

function extractKiloCallerContext(rawArgs: Record<string, unknown>): {
	readonly args: Record<string, unknown>;
	readonly context: ToolCallContext;
} {
	const { [KILO_CALLER_CONTEXT_KEY]: envelope, ...args } = rawArgs;
	if (!isRecord(envelope)) return { args, context: {} };
	const { version, sessionId, callId } = envelope;
	if (
		version !== 1 ||
		typeof sessionId !== "string" ||
		sessionId.length === 0 ||
		typeof callId !== "string" ||
		callId.length === 0
	) {
		return { args, context: {} };
	}
	return { args, context: { kiloSessionId: sessionId, kiloCallId: callId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
