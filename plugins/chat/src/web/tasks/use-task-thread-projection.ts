import { useOpenCodeThreadState } from "@assistant-ui/react-opencode";

import { projectTaskThread } from "./task-projection";

export function useTaskThreadProjection() {
	return useOpenCodeThreadState(projectTaskThread);
}
