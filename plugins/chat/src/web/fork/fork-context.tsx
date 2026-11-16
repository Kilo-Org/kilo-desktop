import { createContext, useContext } from "react";

export interface ForkRequest {
	readonly chatId: string;
	/** The user message the fork stops before. */
	readonly messageId: string;
	/** The chat was working when the person asked. */
	readonly midTurn: boolean;
}

export interface ForkValue {
	/** Forks the chat; ignored while a fork from this pane is in flight. */
	readonly fork: (request: ForkRequest) => void;
	readonly pending: boolean;
}

/**
 * The agent pane's fork, for its transcript's user messages. Only the agent
 * pane provides it, so transcripts elsewhere (subagent panes, isolated
 * renders) offer no fork.
 */
const ForkContext = createContext<ForkValue | null>(null);

export const ForkProvider = ForkContext.Provider;

export const useFork = (): ForkValue | null => useContext(ForkContext);
