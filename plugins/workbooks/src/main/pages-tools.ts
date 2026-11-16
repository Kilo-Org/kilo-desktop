import { KernelError } from "@kilo-desktop/kernel";

/** Calls one tool on the MCP server a workbook lives on, returning its parsed result. */
export interface PagesToolCaller {
	call(tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

interface McpToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: unknown;
	readonly content?: readonly { readonly type: string; readonly text?: string }[];
}

/**
 * The payload of an MCP `tools/call` result: its structured content when
 * present, else its first text part parsed as JSON (or kept as text). A result
 * flagged `isError` becomes a KernelError carrying the tool's own message.
 */
export function toolResultPayload(tool: string, result: unknown): unknown {
	const typed = (result ?? {}) as McpToolResult;
	const text = typed.content?.find((part) => part.type === "text")?.text;
	if (typed.isError) {
		throw new KernelError("UNAVAILABLE", `Pages ${tool} failed: ${errorText(text)}`);
	}
	if (typed.structuredContent !== undefined) return typed.structuredContent;
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function errorText(text: string | undefined): string {
	if (!text) return "no details";
	try {
		const parsed = JSON.parse(text) as { error?: unknown };
		return typeof parsed.error === "string" ? parsed.error : text;
	} catch {
		return text;
	}
}
