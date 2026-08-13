import { useOpenCodeThreadState } from "@assistant-ui/react-opencode";

import { projectPlanThread } from "./plan-projection.js";

export function usePlanThreadProjection() {
	return useOpenCodeThreadState(projectPlanThread);
}
