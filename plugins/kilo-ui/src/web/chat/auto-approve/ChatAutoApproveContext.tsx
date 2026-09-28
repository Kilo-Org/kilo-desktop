import type { OpenCodePermissionRequest } from "@assistant-ui/react-opencode";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { AUTO_APPROVE_REVEAL_MS, needsPerson, type RevealedIdsStore } from "./auto-approver.js";

type ChatAutoApproveState = {
	enabled: boolean;
	setEnabled?: (enabled: boolean) => void;
	revealedIds?: RevealedIdsStore;
};

const noRevealedIds: RevealedIdsStore = createStore(() => ({
	ids: new Set<string>() as ReadonlySet<string>,
}));

const ChatAutoApproveContext = createContext<ChatAutoApproveState>({
	enabled: false,
});

export function ChatAutoApproveProvider({
	value,
	children,
}: {
	value: ChatAutoApproveState;
	children: ReactNode;
}) {
	return (
		<ChatAutoApproveContext.Provider value={value}>{children}</ChatAutoApproveContext.Provider>
	);
}

export function useChatAutoApprove(): ChatAutoApproveState {
	return useContext(ChatAutoApproveContext);
}

/**
 * Pending permissions as the UI should show them. While Auto is on, requests
 * auto-approve can answer are not shown at all — unless it reported a failure
 * (`revealedIds`) or the request has waited `AUTO_APPROVE_REVEAL_MS`, so an
 * unanswered prompt can never stay invisible. Returns `pending` itself when
 * nothing is hidden.
 */
export function useVisiblePermissionRequests(
	pending: readonly OpenCodePermissionRequest[],
): readonly OpenCodePermissionRequest[] {
	const { enabled, revealedIds } = useContext(ChatAutoApproveContext);
	const revealed = useStore(revealedIds ?? noRevealedIds, (state) => state.ids);
	const [now, setNow] = useState(() => Date.now());

	const hidden = useMemo(
		() =>
			enabled
				? pending.filter(
						(request) =>
							!needsPerson(request.metadata) &&
							!revealed.has(request.id) &&
							now - request.askedAt < AUTO_APPROVE_REVEAL_MS,
					)
				: [],
		[enabled, pending, revealed, now],
	);

	const nextRevealAt = hidden.length
		? Math.min(...hidden.map((request) => request.askedAt)) + AUTO_APPROVE_REVEAL_MS
		: undefined;
	useEffect(() => {
		if (nextRevealAt === undefined) return;
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextRevealAt - Date.now()));
		return () => clearTimeout(timer);
	}, [nextRevealAt]);

	return useMemo(() => {
		if (hidden.length === 0) return pending;
		const hiddenIds = new Set(hidden.map((request) => request.id));
		return pending.filter((request) => !hiddenIds.has(request.id));
	}, [pending, hidden]);
}
