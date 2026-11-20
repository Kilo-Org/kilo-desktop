import { useAui, useAuiState } from "@assistant-ui/react";
import { SplitIcon } from "lucide-react";
import type { FC } from "react";

import { selectOpenCodeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { TooltipIconButton } from "../thread/tooltip-icon-button";
import { useFork } from "./fork-context";

/**
 * Forks the chat at this user message into a new chat (the agent pane's
 * `ForkContext`). Hidden on the first message (nothing to fork) and on
 * messages the server hasn't confirmed yet. Subscribes to booleans only, so
 * streamed tokens never re-render earlier messages; the chat and message ids
 * are read on click.
 *
 * Never fork through the runtime's `extras.fork()`: it calls the server
 * directly, skipping kilo.core, which re-applies the chat's permission rules
 * and keeps the fork out of sight until they are.
 */
/** A message shown before the server has it: a new chat's first send, or a pending send. */
const isUnconfirmed = (messageId: string) =>
	messageId.startsWith("opencode-new-user:") || messageId.startsWith("local:");

export const ForkFromHereButton: FC = () => {
	const fork = useFork();
	const hidden = useAuiState((s) => s.message.index === 0 || isUnconfirmed(s.message.id));
	const aui = useAui();
	if (!fork || hidden) return null;

	const forkHere = () => {
		const thread = aui.thread.getState();
		const chatId = selectOpenCodeExtras(thread.extras)?.state.sessionId;
		if (!chatId) return;
		fork.fork({ chatId, messageId: aui.message.getState().id, midTurn: thread.isRunning });
	};

	return (
		<TooltipIconButton
			tooltip="Fork to new chat"
			aria-label="Fork to new chat"
			data-qa-id="kilo-fork-from-here-button"
			disabled={fork.pending}
			onClick={forkHere}
		>
			<SplitIcon className="size-3.5" />
		</TooltipIconButton>
	);
};
