import { useOpenCodeThreadState } from "@assistant-ui/react-opencode";

import { projectPlanThread } from "./plan-projection";

/** The chat's plans, projected once per thread state (empty outside a chat runtime). */
export function usePlanThreadProjection() {
	return useOpenCodeThreadState(projectPlanThread);
}
