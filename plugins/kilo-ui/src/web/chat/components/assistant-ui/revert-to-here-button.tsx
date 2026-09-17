"use client";

import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Loader2Icon, Undo2Icon } from "lucide-react";
import type { FC } from "react";

import { selectOpenCodeExtras } from "../../runtime/use-optional-opencode-runtime-extras.js";
import {
	messageToComposerPrompt,
	restoreToComposer,
	useHasOpenCodeExtras,
	useRevertRangeHasFileChanges,
} from "./checkpoint-revert.js";
import { useRevertPending } from "./revert-pending.js";
import { TooltipIconButton } from "./tooltip-icon-button.js";

export const RevertToHereButton: FC = () => {
	const hasExtras = useHasOpenCodeExtras();
	// Consecutive assistant messages are fused by the projection, so the
	// immediate-next-message check is equivalent to the extension's
	// `turn.assistant.length > 0` answered gating.
	const answered = useAuiState((s) => s.thread.messages[s.message.index + 1]?.role === "assistant");
	const hasFileChanges = useRevertRangeHasFileChanges();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const messageId = useAuiState((s) => s.message.id);
	const { pendingId, setPendingId } = useRevertPending();
	const aui = useAui();

	if (!hasExtras || !answered || !hasFileChanges) return null;

	const reverting = pendingId === messageId;

	const revertNow = async () => {
		const extras = selectOpenCodeExtras(aui.thread.getState().extras);
		const message = aui.message.getState();
		if (!extras) return;
		setPendingId(message.id);
		try {
			await extras.revert(message.id);
			const landed = selectOpenCodeExtras(aui.thread.getState().extras)?.session?.revert?.messageID;
			if (landed !== message.id) {
				// The boundary moved while our request was in flight (e.g. another
				// pane of the same session reverted elsewhere). Our clear-by-match in
				// RevertPendingProvider will never fire — clear manually.
				setPendingId(null);
			}
			// The projected ThreadMessage (not messagesById) is the source here.
			// User-message projections are immutable once created, so the
			// click-time snapshot is safe.  The projected path is deliberate: it
			// retains shadowParts-derived content for retry-emptied messages (whose
			// server-side `parts` were cleared by retryFailedTurn), which the
			// server-side serverMessageToComposerPrompt cannot recover.
			await restoreToComposer(aui, messageToComposerPrompt(message));
		} catch {
			// Clears on revert failure AND on post-revert composer-restore failure.
			// In the latter case the revert already landed; RevertPendingProvider
			// would clear pendingId on the next render anyway — clearing here just
			// removes the spinner slightly earlier, which is harmless.
			setPendingId(null);
			toast.error("Could not revert the conversation.");
		}
	};

	return (
		<TooltipIconButton
			tooltip={reverting ? "Reverting…" : isRunning ? "Wait for agent to finish" : "Revert to here"}
			aria-label="Revert to here"
			data-qa-id="kilo-revert-to-here-button"
			disabled={isRunning || pendingId !== null}
			onClick={() => {
				if (isRunning || pendingId !== null) return;
				void revertNow();
			}}
		>
			{reverting ? (
				<Loader2Icon
					role="status"
					aria-label="Reverting"
					data-qa-id="kilo-revert-spinner"
					className="size-3.5 animate-spin"
				/>
			) : (
				<Undo2Icon className="size-3.5" />
			)}
		</TooltipIconButton>
	);
};
