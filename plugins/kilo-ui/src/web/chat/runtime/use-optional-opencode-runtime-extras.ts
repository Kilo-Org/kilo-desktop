import { useAuiState } from "@assistant-ui/react";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

/**
 * Duck-type OpenCode extras without using `useOpenCodeRuntimeExtras()`, which
 * throws when the active thread is empty/loading (extras undefined) or not
 * OpenCode-backed.
 */
function isOpenCodeRuntimeExtras(extras: unknown): extras is OpenCodeRuntimeExtras {
	if (typeof extras !== "object" || extras === null) return false;
	const candidate = extras as Partial<OpenCodeRuntimeExtras>;
	return (
		typeof candidate.replyToQuestion === "function" &&
		typeof candidate.rejectQuestion === "function" &&
		typeof candidate.replyToPermission === "function"
	);
}

/** OpenCode extras when available; `undefined` for empty/local/non-OpenCode threads. */
export function useOptionalOpenCodeRuntimeExtras(): OpenCodeRuntimeExtras | undefined {
	return useAuiState((s) => {
		const extras = s.thread.extras;
		return isOpenCodeRuntimeExtras(extras) ? extras : undefined;
	});
}
