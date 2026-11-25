/**
 * The slice of Kilo Code v2's Promise plugin API (`@opencode/plugin`'s
 * `promise/{plugin,tool,permission}.ts` and `@opencode/schema/tool`) this
 * plugin uses. Typed locally because `@opencode/plugin` is not published as a
 * dependency; the bundle needs no runtime import from Kilo.
 */
import type { z } from "zod";

export type ToolMetadata = Record<string, unknown>;

export type TextContent = { type: "text"; text: string };
export type FileContent = { type: "file"; uri: string; mime: string; name?: string };
export type ToolContent = TextContent | FileContent;

export type ToolResult = { content: ToolContent[]; metadata: ToolMetadata };

/** Identifies one tool call; a permission request names it as its source. */
export type ToolCall = {
	readonly sessionID: string;
	readonly agent: string;
	readonly messageID: string;
	readonly id: string;
};

export type ToolContext = ToolCall & {
	/**
	 * Reading it opts the tool into a cooperative stop, so only tools that
	 * check it between steps read it (and the context is never spread).
	 */
	readonly signal: AbortSignal;
	progress(update: ToolMetadata): Promise<void>;
};

/** A tool with a zod input; zod 4 schemas are Standard Schemas with JSON Schema conversion. */
export type Tool<Input extends z.ZodObject = z.ZodObject> = {
	readonly name: string;
	readonly description: string;
	readonly input: Input;
	readonly options: { readonly codemode: false };
	execute(input: z.output<Input>, context: ToolContext): Promise<ToolResult>;
};

export type PermissionAssertInput = {
	sessionID: string;
	agent?: string;
	action: string;
	resources: string[];
	save: string[];
	metadata: ToolMetadata;
	source: { type: "tool"; messageID: string; id: string };
};

export type PermissionDomain = {
	/** Resolves when allowed; rejects on a deny rule or the user's rejection, which must propagate. */
	assert(input: PermissionAssertInput): Promise<void>;
};

export type PermissionEffect = "allow" | "deny" | "ask";

export type PermissionRule = { action: string; resource: string; effect: PermissionEffect };

export type KiloEvent = { type: string; data?: unknown };

export type PluginContext = {
	readonly location: { readonly directory: string };
	readonly tool: {
		transform(callback: (editor: { add(tool: Tool): void }) => void): Promise<unknown>;
	};
	readonly agent: {
		transform(
			callback: (editor: {
				list(): readonly { id: string }[];
				update(id: string, update: (agent: { permissions: PermissionRule[] }) => void): void;
			}) => void,
		): Promise<unknown>;
	};
	readonly permission: PermissionDomain;
	readonly event: {
		subscribe(options: { types: string[]; signal?: AbortSignal }): AsyncIterable<KiloEvent>;
	};
};

/** Asks `permission` for `call`, naming the call as the request's source. */
export function assertForCall(
	permission: PermissionDomain,
	call: ToolCall,
	request: Pick<PermissionAssertInput, "action" | "resources" | "save" | "metadata">,
): Promise<void> {
	return permission.assert({
		sessionID: call.sessionID,
		agent: call.agent,
		...request,
		source: { type: "tool", messageID: call.messageID, id: call.id },
	});
}
