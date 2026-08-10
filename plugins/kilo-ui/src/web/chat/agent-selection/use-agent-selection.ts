import { useCallback, useState } from "react";

import { DEFAULT_AGENT } from "./agent-catalog.js";

/**
 * Ephemeral agent for the active draft/session.
 * Always starts (and resets) to Code; never persisted.
 */
export function useAgentSelection() {
	const [agent, setAgent] = useState(DEFAULT_AGENT);

	const resetAgent = useCallback(() => {
		setAgent(DEFAULT_AGENT);
	}, []);

	return {
		agent,
		setAgent,
		resetAgent,
	};
}
