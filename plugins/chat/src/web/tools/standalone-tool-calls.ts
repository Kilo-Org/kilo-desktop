import type { PartState } from "@assistant-ui/react";

import type { ToolCallProps, ToolCallStatus } from "../../contracts";

/** A tool renderer's `isStandalone`: which of the tool's calls stand alone. */
export type StandaloneToolCall = (call: ToolCallProps) => boolean;

let standaloneCalls: ReadonlyMap<string, StandaloneToolCall> = new Map();

/**
 * The window's per-call standalone questions by tool name (as Kilo calls the
 * tools), from `kilo.chat/tool-renderer` implementations. Window-wide like
 * the contributed categories, since the pure grouping helpers read them.
 */
export function setStandaloneToolCalls(calls: ReadonlyMap<string, StandaloneToolCall>): void {
	standaloneCalls = calls;
}

/**
 * Whether the tool's renderer keeps this call out of activity groups and the
 * turn's fold. A renderer whose question throws leaves the call where it
 * would be: one plugin's bug must not break the transcript's grouping.
 */
export function isStandaloneToolCallPart(part: PartState): boolean {
	if (part.type !== "tool-call") return false;
	const isStandalone = standaloneCalls.get(part.toolName);
	if (!isStandalone) return false;
	try {
		return isStandalone({
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			args: part.args,
			argsText: part.argsText,
			...(part.result === undefined ? {} : { result: part.result }),
			...(part.isError === undefined ? {} : { isError: part.isError }),
			status: part.status as ToolCallStatus,
		});
	} catch {
		return false;
	}
}
