import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useOpenCodePermissions, useOpenCodeQuestions } from "@assistant-ui/react-opencode";

import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { collectPendingInteractions, type PendingInteractions } from "./pending-interactions";
import { useVisiblePermissionRequests } from "./visible-permissions";

const ScopedPendingInteractionsContext = createContext<PendingInteractions | null>(null);

function useSessionFamilyInteractions(scopeSessionId?: string): PendingInteractions {
	const state = useOptionalOpenCodeRuntimeExtras()?.state;
	const { pending: permissions } = useOpenCodePermissions();
	const questions = useOpenCodeQuestions();
	const collected = useMemo(
		() =>
			collectPendingInteractions({
				state,
				scopeSessionId,
				own: { permissions, questions },
			}),
		[permissions, questions, scopeSessionId, state],
	);
	// Auto-approve answers subagent requests too, so the whole family is filtered.
	const visiblePermissions = useVisiblePermissionRequests(collected.permissions);
	return useMemo(
		() =>
			visiblePermissions === collected.permissions
				? collected
				: { ...collected, permissions: visiblePermissions },
		[collected, visiblePermissions],
	);
}

/**
 * Pins prompts to one subagent's subtree. Must sit outside any readonly
 * thread provider: the family is read from the live chat runtime, which a
 * readonly transcript hides.
 */
export function PendingInteractionsScope({
	sessionId,
	children,
}: {
	sessionId: string;
	children: ReactNode;
}) {
	const value = useSessionFamilyInteractions(sessionId);
	return (
		<ScopedPendingInteractionsContext.Provider value={value}>
			{children}
		</ScopedPendingInteractionsContext.Provider>
	);
}

/** Prompts for the enclosing scope: a subagent pane's subtree, else the whole chat family. */
export function usePendingInteractions(): PendingInteractions {
	const scoped = useContext(ScopedPendingInteractionsContext);
	const family = useSessionFamilyInteractions();
	return scoped ?? family;
}
