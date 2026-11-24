import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import type { FunctionComponent } from "react";

import type { ToolCallProps } from "../../contracts";

export type { ToolCallProps };

/**
 * What kilo.chat's own renderers read of a call: kilo.chat's tool-call shape,
 * loose enough that the transcript's tool-call part can be handed over as it
 * is too (its optional fields may be present but undefined).
 */
export interface ToolCallView extends Omit<ToolCallProps, "result" | "isError"> {
	readonly result?: unknown;
	readonly isError?: boolean | undefined;
}

/** One of kilo.chat's tool-call renderers. */
export type ToolCallComponent = FunctionComponent<ToolCallView>;

/** The transcript's tool-call part as renderers see it: kilo.chat's shape, nothing of assistant-ui's runtime. */
export function toToolCallProps(part: ToolCallMessagePartProps): ToolCallProps {
	return {
		toolCallId: part.toolCallId,
		toolName: part.toolName,
		args: part.args,
		argsText: part.argsText,
		...(part.result === undefined ? {} : { result: part.result }),
		...(part.isError === undefined ? {} : { isError: part.isError }),
		status: part.status,
	};
}
