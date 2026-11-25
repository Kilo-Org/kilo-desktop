import { useAuiState } from "@assistant-ui/react";
import type { OpenCodeRuntimeExtras } from "@kilo-desktop/react-opencode";

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

/**
 * One slice of the OpenCode extras; `undefined` for empty/local/non-OpenCode
 * threads. Extras are rebuilt with the thread state on every streamed token,
 * so a component that reads only the session, say, selects it here and
 * renders only when it changes. `select` must return a value that keeps its
 * identity while unchanged (a state object, a primitive).
 */
export function useOpenCodeExtrasSlice<T>(
	select: (extras: OpenCodeRuntimeExtras) => T,
): T | undefined {
	return useAuiState((s) => {
		const extras = selectOpenCodeExtras(s.thread.extras);
		return extras ? select(extras) : undefined;
	});
}

const selectSession = (extras: OpenCodeRuntimeExtras) => extras.session;

/** The OpenCode session the thread shows, re-rendering only when it changes. */
export const useOptionalOpenCodeSession = () => useOpenCodeExtrasSlice(selectSession);

const selectQuestions = (extras: OpenCodeRuntimeExtras) => extras.questions;
const NO_QUESTIONS: readonly PendingQuestion[] = [];

type PendingQuestion = OpenCodeRuntimeExtras["questions"][string];

/**
 * The chat's pending questions, re-rendering only when they change.
 * react-opencode's `useOpenCodeQuestions` subscribes to the whole extras,
 * which change with every streamed token.
 */
export function usePendingQuestions(): readonly PendingQuestion[] {
	const questions = useOpenCodeExtrasSlice(selectQuestions);
	return questions ? Object.values(questions) : NO_QUESTIONS;
}

type OlderHistoryStatus = "complete" | "loading" | "failed";

const selectOlderHistory = (extras: OpenCodeRuntimeExtras): OlderHistoryStatus => {
	const older = extras.state.olderHistory;
	if (!older || older.type === "complete") return "complete";
	return older.type === "failed" ? "failed" : "loading";
};

/**
 * Whether the thread still waits for its older messages: a session shows its
 * newest page first and the rest after (`available` until their read starts,
 * so loading too). Complete for threads without extras.
 */
export const useOlderHistoryStatus = (): OlderHistoryStatus =>
	useOpenCodeExtrasSlice(selectOlderHistory) ?? "complete";

/**
 * OpenCode extras when available; `undefined` for empty/local/non-OpenCode
 * threads. Re-renders on every streamed token: prefer
 * `useOpenCodeExtrasSlice` unless the whole thread state is needed.
 */
export function useOptionalOpenCodeRuntimeExtras(): OpenCodeRuntimeExtras | undefined {
	return useAuiState((s) => selectOpenCodeExtras(s.thread.extras));
}
