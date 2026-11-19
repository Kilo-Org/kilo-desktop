import { createContext, useContext } from "react";

/** The chat's Swarm Board: which root chat it shows, and how to open its pane. */
export interface OpenSwarmBoard {
	readonly rootChatId: string;
	open(): void;
}

/** Absent where the transcript can't open panes. */
export const OpenSwarmBoardContext = createContext<OpenSwarmBoard | null>(null);

export function useOpenSwarmBoard(): OpenSwarmBoard | null {
	return useContext(OpenSwarmBoardContext);
}
