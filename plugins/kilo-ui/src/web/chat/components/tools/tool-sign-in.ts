import type { PartState } from "@assistant-ui/react";

import {
	agentToolName,
	isSignInDeclinedToolResult,
	isSignInRequiredToolResult,
	type AuthSession,
	type RegisteredTool,
	type ToolSignInPrompt,
} from "@kilo-desktop/feature-sdk";

/** Kilo serves Desktop's tools from its "desktop" MCP server, prefixing their names. */
const KILO_DESKTOP_TOOL_PREFIX = "desktop_";

export type SignInRefusal = "required" | "declined";

/**
 * How the tool gateway refused a tool call for sign-in, if it did. Only a
 * failed call to a Desktop tool counts: any other tool's output (a shell
 * grepping this code, a file read) may merely contain the marker text.
 */
export function signInRefusalOf(call: {
	readonly toolName: string;
	readonly result?: unknown;
	readonly isError?: boolean | undefined;
}): SignInRefusal | undefined {
	if (call.isError !== true || !call.toolName.startsWith(KILO_DESKTOP_TOOL_PREFIX)) {
		return undefined;
	}
	if (isSignInDeclinedToolResult(call.result)) return "declined";
	if (isSignInRequiredToolResult(call.result)) return "required";
	return undefined;
}

/**
 * True for a tool call the tool gateway refused because the user is signed out
 * (or declined to sign in). Chat renders these as a standalone sign-in card or
 * note in place of the tool row.
 */
export const isSignInRefusedToolPart = (part: PartState): boolean =>
	part.type === "tool-call" && signInRefusalOf(part) !== undefined;

/** Neutral wording for a tool that requires sign-in without supplying its own prompt. */
export const DEFAULT_TOOL_SIGN_IN_PROMPT: ToolSignInPrompt = {
	title: "Sign in to let the agent use this tool?",
	body: "This Desktop tool needs you to be signed in to a Kilo account. Do you want to sign in?",
	toolsLabel: "Desktop's tools that need sign-in",
};

/**
 * The registered tool that requires sign-in, by the name Kilo called it under,
 * among the tools registered in this window (every window registers the
 * plugins' tools). Only these can be refused by the gateway for sign-in.
 */
export function findSignInTool(
	tools: readonly RegisteredTool[],
	kiloToolName: string,
): RegisteredTool | undefined {
	return tools.find(
		(candidate) =>
			candidate.requiresSignIn &&
			`${KILO_DESKTOP_TOOL_PREFIX}${agentToolName(candidate)}` === kiloToolName,
	);
}

/** The sign-in prompt for a sign-in tool, falling back to neutral wording. */
export function toolSignInPrompt(tool: RegisteredTool | undefined): ToolSignInPrompt {
	return tool?.signInPrompt ?? DEFAULT_TOOL_SIGN_IN_PROMPT;
}

/**
 * Whether the tool gateway will refuse a call to this Kilo tool for sign-in:
 * it is a registered sign-in tool and the session main checks is not signed
 * in. `getSession` must read that same session (`sdk.auth.getSession()`).
 */
export async function isRefusedForSignIn(
	kiloToolName: string,
	{
		tools,
		getSession,
	}: { tools: readonly RegisteredTool[]; getSession: () => Promise<AuthSession> },
): Promise<boolean> {
	if (!findSignInTool(tools, kiloToolName)) return false;
	return (await getSession()).status !== "authenticated";
}
