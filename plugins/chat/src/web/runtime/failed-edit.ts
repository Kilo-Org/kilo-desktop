import { OpenCodeEditError } from "@assistant-ui/react-opencode";

import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	messageToComposerPrompt,
	restoreToComposer,
	type RestorableComposer,
} from "../checkpoints/checkpoint-revert";

/**
 * Recovers from an edit of a sent prompt that failed (see the runtime's
 * `onEdit`). A failed revert leaves the prompt shown, and assistant-ui
 * reopens its edit with the draft. A prompt that failed after the revert
 * landed has nothing left to reopen — the revert hid the edited prompt — so
 * the draft moves to the thread's composer, where the revert's Undo is too.
 * Returns whether `error` was a failed edit.
 */
export function handleFailedEdit(
	error: unknown,
	composer: RestorableComposer | undefined,
): boolean {
	if (!(error instanceof OpenCodeEditError)) return false;
	toast.error("Could not edit the message.");
	if (error.stage === "send" && composer) {
		void restoreToComposer(composer, messageToComposerPrompt(error.draft));
	}
	return true;
}
