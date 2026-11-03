import type { PartState } from "@assistant-ui/react";

import {
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	type ToolSignInPrompt,
} from "@kilo-desktop/plugin-agent/contracts";

export type { ToolSignInPrompt };

/** Kilo serves the app's agent tools from its "desktop" MCP server, prefixing their names. */
const KILO_DESKTOP_TOOL_PREFIX = "desktop_";

function resultText(result: unknown): string {
	if (result === undefined || result === null) return "";
	if (typeof result === "string") return result;
	try {
		return JSON.stringify(result) ?? "";
	} catch {
		return "";
	}
}

interface ToolCallOutcome {
	readonly toolName: string;
	readonly result?: unknown;
	readonly isError?: boolean | undefined;
}

/**
 * Why kilo.agent's tool gateway refused this call: the person is signed out
 * (`required`), or they already chose to go without the tool (`declined`).
 * Only a failed call to one of the app's tools counts: any other tool's
 * output (a shell grepping this code, a file read) may merely contain the
 * marker text.
 */
export function signInRefusalKind(call: ToolCallOutcome): "required" | "declined" | undefined {
	if (call.isError !== true || !call.toolName.startsWith(KILO_DESKTOP_TOOL_PREFIX)) {
		return undefined;
	}
	const text = resultText(call.result);
	if (text.includes(SIGN_IN_REQUIRED_TOOL_ERROR_CODE)) return "required";
	if (text.includes(SIGN_IN_DECLINED_TOOL_ERROR_CODE)) return "declined";
	return undefined;
}

export function isSignInRefusal(call: ToolCallOutcome): boolean {
	return signInRefusalKind(call) !== undefined;
}

/** A refused call renders as a sign-in card in place of its row, outside activity groups. */
export const isSignInRefusedToolPart = (part: PartState): boolean =>
	part.type === "tool-call" && isSignInRefusal(part);

export const DEFAULT_TOOL_SIGN_IN_PROMPT: ToolSignInPrompt = {
	title: "Sign in to let the agent use this tool?",
	body: "This Desktop tool needs you to be signed in to a Kilo account. Do you want to sign in?",
	toolsLabel: "Desktop's tools that need sign-in",
};
