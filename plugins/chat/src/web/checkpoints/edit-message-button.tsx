import { useAui, useAuiState } from "@assistant-ui/react";
import { PencilIcon } from "lucide-react";
import type { FC } from "react";

import { TooltipIconButton } from "../thread/tooltip-icon-button";
import {
	messageToComposerPrompt,
	restoreToComposer,
	useHasOpenCodeExtras,
	useIsAnsweredPrompt,
} from "./checkpoint-revert";
import { useRevertPending } from "./revert-pending";

/**
 * Edits an answered prompt in place. Saving the edit reverts to the prompt
 * and sends the edit (the runtime's `onEdit`), so it is offered wherever a
 * prompt was answered, whether or not its turn changed files.
 */
export const EditMessageButton: FC = () => {
	const aui = useAui();
	const hasExtras = useHasOpenCodeExtras();
	const canEdit = useAuiState((s) => s.thread.capabilities.edit);
	const answered = useIsAnsweredPrompt();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const isEditing = useAuiState((s) => s.composer.isEditing);
	const { pendingId } = useRevertPending();

	if (!hasExtras || !canEdit || !answered) return null;

	const disabled = isEditing || isRunning || pendingId !== null;

	const startEditing = () => {
		const message = aui.message.getState();
		aui.composer.beginEdit();
		// The editor starts from what Revert would put back in the composer,
		// rather than assistant-ui's own seeding (which also lifts file parts
		// out of the content, so attachments could show twice).
		void restoreToComposer(aui.composer, messageToComposerPrompt(message));
	};

	return (
		<TooltipIconButton
			tooltip={isRunning ? "Wait for agent to finish" : "Edit"}
			aria-label="Edit message"
			data-qa-id="kilo-edit-message-button"
			disabled={disabled}
			onClick={() => {
				if (!disabled) startEditing();
			}}
		>
			<PencilIcon className="size-3.5" />
		</TooltipIconButton>
	);
};
