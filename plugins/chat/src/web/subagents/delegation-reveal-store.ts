import { create } from "zustand";

type RevealRequest = { toolCallId: string; nonce: number };

type DelegationRevealState = {
	request: RevealRequest | null;
	reveal(toolCallId: string): void;
	/** Clears the request once its row has scrolled into view, so remounts do not scroll again. */
	settle(nonce: number): void;
};

/**
 * A one-shot "jump to this delegation" request from outside the transcript.
 * Every layer that could hide the row (the turn's work fold, the delegation
 * group's collapse, its "+N more" cap) opens itself while the request names a
 * delegation it contains; the row scrolls itself into view once it mounts and
 * settles the request.
 */
export const useDelegationRevealStore = create<DelegationRevealState>((set, get) => ({
	request: null,
	reveal: (toolCallId) => set({ request: { toolCallId, nonce: (get().request?.nonce ?? 0) + 1 } }),
	settle: (nonce) => {
		if (get().request?.nonce === nonce) set({ request: null });
	},
}));

/** The pending request's nonce when it targets one of `toolCallIds`, otherwise null. */
export const useDelegationRevealNonce = (toolCallIds: readonly string[]): number | null =>
	useDelegationRevealStore((state) =>
		state.request && toolCallIds.includes(state.request.toolCallId) ? state.request.nonce : null,
	);
