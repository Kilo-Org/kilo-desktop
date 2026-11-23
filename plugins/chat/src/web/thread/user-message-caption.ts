import { createContext, useContext } from "react";

/**
 * A caption shown over the transcript's first user message: the subagent
 * pane's "From the main agent", since a subagent's first prompt is its task.
 * Null (no caption) everywhere else.
 */
export const FirstUserMessageCaptionContext = createContext<string | null>(null);

export function useFirstUserMessageCaption(): string | null {
	return useContext(FirstUserMessageCaptionContext);
}
