import { createContext, useContext } from "react";

import type { PlanPaneAnchors } from "../../contracts";

export type OpenPlanPane = (anchors: PlanPaneAnchors) => void;

/** Opens the work session's plan pane on a revision of the chat's plan; provided by the agent pane. */
export const OpenPlanPaneContext = createContext<OpenPlanPane | null>(null);

export function useOpenPlanPane(): OpenPlanPane | null {
	return useContext(OpenPlanPaneContext);
}
