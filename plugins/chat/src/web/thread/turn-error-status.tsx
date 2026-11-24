import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";
import type { FC } from "react";

import { useOpenCodeExtrasSlice } from "../runtime/use-optional-opencode-runtime-extras";
import { displayChatError, turnErrorText } from "./chat-error";

type ThreadState = OpenCodeRuntimeExtras["state"];

/** Whether a reply since the latest prompt already carries the error, shown on that reply. */
function replyShowsError({ messageOrder, messagesById }: ThreadState): boolean {
	for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
		const info = messagesById[messageOrder[index]!]?.info;
		if (!info || info.role === "user") return false;
		if (info.error) return true;
	}
	return false;
}

const selectTurnError = ({ state }: OpenCodeRuntimeExtras) =>
	state.turnError && !replyShowsError(state) ? state.turnError : undefined;

/**
 * Under the transcript when the latest turn failed with no reply to show the
 * error on: Kilo refused the prompt, or reported a `session.error` before
 * the turn produced one (no model to run it with, say).
 */
export const TurnErrorStatus: FC = () => {
	const turnError = useOpenCodeExtrasSlice(selectTurnError);
	if (!turnError) return null;

	return (
		<div
			role="alert"
			className="aui-message-error-root border-border bg-background mt-2 flex items-center gap-3 rounded-md border p-3 text-sm"
			data-qa-id="chat-message-error"
		>
			<span className="aui-message-error-message text-destructive line-clamp-2 min-w-0 flex-1">
				{displayChatError(turnErrorText(turnError.error))}
			</span>
		</div>
	);
};
