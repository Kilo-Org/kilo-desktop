import { useAuiState } from "@assistant-ui/react";
import type { OpenCodeRuntimeExtras } from "@assistant-ui/react-opencode";

/**
 * Duck-type OpenCode extras without using `useOpenCodeRuntimeExtras()`, which
 * throws when the active thread is empty/loading (extras undefined) or not
 * OpenCode-backed. Works on raw `thread.extras` values, not just state, so
 * imperative click-time reads can share the same guard as the hook.
 */
export function selectOpenCodeExtras(extras: unknown): OpenCodeRuntimeExtras | undefined {
	if (typeof extras !== "object" || extras === null) return undefined;
	const candidate = extras as Partial<OpenCodeRuntimeExtras>;
	if (
		typeof candidate.replyToQuestion === "function" &&
		typeof candidate.rejectQuestion === "function" &&
		typeof candidate.replyToPermission === "function"
	) {
		return candidate as OpenCodeRuntimeExtras;
	}
	return undefined;
}

/** OpenCode extras when available; `undefined` for empty/local/non-OpenCode threads. */
export function useOptionalOpenCodeRuntimeExtras(): OpenCodeRuntimeExtras | undefined {
	return useAuiState((s) => selectOpenCodeExtras(s.thread.extras));
}
