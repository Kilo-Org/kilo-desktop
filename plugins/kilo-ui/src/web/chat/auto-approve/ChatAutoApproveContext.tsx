import type { OpenCodePermissionRequest } from "@assistant-ui/react-opencode";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { AUTO_APPROVE_REVEAL_MS, needsPerson, type RequestIdsStore } from "./auto-approver.js";

type ChatAutoApproveState = {
	enabled: boolean;
	setEnabled?: (enabled: boolean) => void;
	revealedIds?: RequestIdsStore;
	/** Requests being checked for a sign-in refusal; hidden in any mode. */
	checkingIds?: RequestIdsStore;
};

const noRequestIds: RequestIdsStore = createStore(() => ({
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
 * unanswered prompt can never stay invisible. In any mode, requests being
 * checked for a sign-in refusal (`checkingIds`) are hidden too; the approver
 * releases them within its reveal timeout. Returns `pending` itself when
 * nothing is hidden.
 */
export function useVisiblePermissionRequests(
	pending: readonly OpenCodePermissionRequest[],
): readonly OpenCodePermissionRequest[] {
	const { enabled, revealedIds, checkingIds } = useContext(ChatAutoApproveContext);
	const revealed = useStore(revealedIds ?? noRequestIds, (state) => state.ids);
	const checking = useStore(checkingIds ?? noRequestIds, (state) => state.ids);
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
	const beingChecked = useMemo(
		() => pending.filter((request) => checking.has(request.id)),
		[pending, checking],
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
		if (hidden.length === 0 && beingChecked.length === 0) return pending;
		const hiddenIds = new Set([...hidden, ...beingChecked].map((request) => request.id));
		return pending.filter((request) => !hiddenIds.has(request.id));
	}, [pending, hidden, beingChecked]);
}
