import { create } from "zustand";

type RevealContributedPaneState = {
	request: { sessionId: string; paneId: string; nonce: number } | null;
	reveal: (sessionId: string, paneId: string) => void;
};

/**
 * Asks the canvas to focus and scroll to a contributed pane. Opening a new
 * pane already activates it while the layout merges it in; this covers
 * re-opening a pane that is already in the layout, which otherwise changes
 * nothing on screen.
 */
export const useRevealContributedPane = create<RevealContributedPaneState>((set) => ({
	request: null,
	reveal: (sessionId, paneId) =>
		set((state) => ({
			request: { sessionId, paneId, nonce: (state.request?.nonce ?? 0) + 1 },
		})),
}));
