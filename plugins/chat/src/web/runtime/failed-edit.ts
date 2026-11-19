import { OpenCodeEditError } from "@assistant-ui/react-opencode";

import { toast } from "@kilo-desktop/ui/components/sonner";

/**
 * Reports an edit of a sent prompt that failed (see the runtime's `onEdit`).
 * A failed revert leaves the prompt shown, and assistant-ui reopens its edit
 * with the draft. A prompt that failed after the revert landed only reports
 * the failure: the thread's composer belongs to the person's own draft, so
 * the edit is not moved there. Returns whether `error` was a failed edit.
 */
export function handleFailedEdit(error: unknown): boolean {
	if (!(error instanceof OpenCodeEditError)) return false;
	toast.error("Could not edit the message.");
	return true;
}
