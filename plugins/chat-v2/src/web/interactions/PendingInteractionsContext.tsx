import { createContext, useContext, type ReactNode } from "react";
import { useOpenCodePermissions, useOpenCodeForms } from "@kilo-desktop/react-opencode-v2";

import { useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

import { useOptionalOpenCodeRuntimeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import {
	collectPendingInteractions,
	EMPTY_PENDING_INTERACTIONS,
	samePendingInteractions,
	type PendingInteractions,
} from "./pending-interactions";
import { useVisiblePermissionRequests } from "./visible-permissions";

const ScopedPendingInteractionsContext = createContext<PendingInteractions | null>(null);
const FamilyPendingInteractionsContext = createContext<PendingInteractions | null>(null);

function useSessionFamilyInteractions(scopeSessionId?: string): PendingInteractions {
	const state = useOptionalOpenCodeRuntimeExtras()?.state;
	const { pending: permissions } = useOpenCodePermissions();
	const forms = useOpenCodeForms();
	const collected = collectPendingInteractions({
		state,
		scopeSessionId,
		own: { permissions, forms },
	});
	// Auto-approve answers subagent requests too, so the whole family is filtered.
	const visiblePermissions = useVisiblePermissionRequests(collected.permissions);
	const value =
		visiblePermissions === collected.permissions
			? collected
			: { ...collected, permissions: visiblePermissions };
	return useStableValue(value, samePendingInteractions);
}

/**
 * The chat family's prompts, read once for the whole transcript. Every
 * message and activity group asks for them; reading the runtime's extras in
 * each would re-render every message on every streamed token, as extras
 * change with the thread state. The value only changes when a prompt does.
 */
export function PendingInteractionsProvider({ children }: { children: ReactNode }) {
	const value = useSessionFamilyInteractions();
	return (
		<FamilyPendingInteractionsContext.Provider value={value}>
			{children}
		</FamilyPendingInteractionsContext.Provider>
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
	const family = useContext(FamilyPendingInteractionsContext);
	return scoped ?? family ?? EMPTY_PENDING_INTERACTIONS;
}
