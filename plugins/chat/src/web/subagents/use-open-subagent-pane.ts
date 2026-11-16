import { createContext, useContext } from "react";

export type OpenSubagentPane = (childSessionId: string, title: string) => void;

/** Opens a subagent's transcript in its own pane; delegation rows aren't clickable without it. */
export const OpenSubagentPaneContext = createContext<OpenSubagentPane | null>(null);

export function useOpenSubagentPane(): OpenSubagentPane | null {
	return useContext(OpenSubagentPaneContext);
}
